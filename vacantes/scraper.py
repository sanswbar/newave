#!/usr/bin/env python3
"""
Busca vacantes remotas abiertas a LATAM en las bolsas donde publican las
empresas que ya conocemos.

Por qué existe: buscarlas a mano una por una es lento y caro. Greenhouse y
Ashby exponen su listado completo en una sola llamada por empresa, así que
esto trae cientos de vacantes en segundos y filtra las que sirven.

Uso:
    python3 scraper.py                 # busca y escribe el post
    python3 scraper.py --json          # saca el JSON crudo para revisar
"""

import html
import json
import re
import sys
import urllib.request
import urllib.error
from collections import defaultdict

# Empresas que ya han publicado vacantes remotas para LATAM. Las de la lista
# del post anterior más otras del mismo perfil: SaaS internacional, contratan
# fuera de USA, usan Greenhouse o Ashby.
GREENHOUSE = [
    'gitlab', 'canonical', 'sezzle', 'twilio', 'customerio', 'cloudbeds',
    'varicent', 'remotecom', 'alpaca', 'stackblitz', 'consensys',
    'deel', 'sourcegraph', 'grafanalabs', 'airbyte', 'dbtlabs',
    'clipboardhealth', 'mercury', 'vercel', 'cabify', 'nubank',
]

ASHBY = [
    'supabase', 'oyster', 'hopper', 'linear', 'ramp', 'clerk',
    'replit', 'posthog', 'browserbase', 'openphone',
]

# Una vacante sirve si es remota Y no está restringida a un solo país que no
# sea de LATAM. El primer filtro es el título/ubicación; el segundo descarta
# lo que claramente pide estar en otro lado.
PISTAS_REMOTO = ['remote', 'remoto', 'anywhere', 'distributed', 'global']

EXCLUIR_UBICACION = [
    # Países fuera de LATAM. Si aparecen en el título o la ubicación, la
    # vacante pide estar ahí aunque diga "remote" — nadie de la comunidad
    # puede aplicar. Se comparan como palabra completa para no descartar
    # "Colombia" por contener "Colomb" ni cosas así.
    'italy', 'canada', 'germany', 'france', 'spain', 'portugal',
    'netherlands', 'belgium', 'ireland', 'poland', 'romania', 'ukraine',
    'india', 'philippines', 'vietnam', 'indonesia', 'malaysia',
    'japan', 'china', 'korea', 'singapore', 'australia', 'new zealand',
    'united kingdom', 'switzerland', 'sweden', 'norway', 'denmark',
    'finland', 'austria', 'greece', 'turkey', 'israel', 'egypt',
    'south africa', 'nigeria', 'kenya', 'emea', 'apac', 'benelux',
    'dach', 'nordics', 'united states only', 'us only', 'usa only',
]

# Puestos que no aplican al perfil de la comunidad: son roles muy técnicos
# de ingeniería, o de entrada sin sueldo real.
EXCLUIR_PUESTO = [
    'engineer', 'developer', 'devops', 'sre ', 'architect',
    'data scientist', 'machine learning', 'security', 'qa ',
    'intern', 'internship', 'becari', 'trainee',
    'vice president', 'vp ', 'chief ', 'head of',
]

# Señales de que la vacante SÍ está abierta a la región
PISTAS_LATAM = [
    'latam', 'latin america', 'south america', 'mexico', 'méxico',
    'brazil', 'brasil', 'colombia', 'argentina', 'chile', 'americas',
    'north america', 'global', 'anywhere', 'worldwide',
]

# Las categorías del post, con las palabras que las identifican en el título.
# El orden importa: la primera que coincide se lleva la vacante.
CATEGORIAS = [
    ('📋 Project / Program Management', [
        'project manager', 'program manager', 'product manager',
        'technical program', 'delivery manager', 'scrum master',
    ]),
    ('🤝 Customer Success', [
        'customer success', 'customer support', 'customer experience',
        'account manager', 'client success', 'support engineer',
        'implementation', 'onboarding specialist',
    ]),
    ('💼 Account Management / Sales', [
        'account executive', 'sales', 'business development', 'bdr', 'sdr',
        'revenue', 'partnerships', 'solutions consultant',
    ]),
    ('🎨 Graphic Design / UX-UI', [
        'designer', 'design ', 'ux', 'ui ', 'creative', 'brand ',
    ]),
    ('📣 Digital Marketing', [
        'marketing manager', 'marketing specialist', 'marketing analyst',
        'growth', 'content', 'social media', 'seo', 'brand marketing',
        'demand generation', 'lifecycle', 'communications',
    ]),
    ('⚙️ Operations', [
        'operations', 'ops', 'business analyst', 'process',
        'supply chain', 'logistics', 'people ', 'recruiter', 'talent',
    ]),
    ('💰 Finance', [
        'finance', 'accounting', 'accountant', 'controller',
        'financial', 'payroll', 'treasury', 'fp&a',
    ]),
]



def limpiar_html(texto):
    """Quita etiquetas y entidades para poder buscar frases en el texto."""
    if not texto:
        return ''
    t = re.sub(r'<[^>]+>', ' ', texto)
    t = html.unescape(t)
    return re.sub(r'\s+', ' ', t).lower()


# Frases que aparecen cuando la vacante EXIGE estar en un país que no es el
# nuestro. Esto es lo que de verdad decide si alguien de México puede aplicar:
# el título dice "Remote" pero la letra chica dice "US only".
BLOQUEA_ELEGIBILIDAD = [
    'must be authorized to work in the united states',
    'must be legally authorized to work in the u',
    'authorized to work in the us without sponsorship',
    'must reside in the united states', 'must be located in the united states',
    'must be based in the united states', 'us-based candidates only',
    'only considering candidates located in the united states',
    'must be a us citizen', 'u.s. work authorization',
    'must be located within the united states',
    'must reside in canada', 'must be located in canada',
    'must be based in the uk', 'must reside in the uk',
    'must be located in europe', 'must be based in europe',
    'right to work in the uk', 'eligible to work in the eu',
]

# Frases que confirman que SÍ está abierta a la región o al mundo
CONFIRMA_ABIERTA = [
    'anywhere in the world', 'work from anywhere', 'fully remote, globally',
    'hire in any country', 'countries around the world',
    'latin america', 'latam', 'mexico', 'méxico', 'americas',
    'any time zone', 'globally distributed', 'all countries',
]


def elegibilidad_ok(v):
    """
    Decide si alguien desde México podría aplicar de verdad.

    Lee la descripción, no solo el título: "Remote" en el título no significa
    nada si abajo dice "must be authorized to work in the US".
    """
    desc = v.get('descripcion', '')
    if not desc:
        return True  # sin datos, no la descartamos aquí; el filtro de país ya corrió

    for f in BLOQUEA_ELEGIBILIDAD:
        if f in desc:
            return False

    return True


def traer(url, timeout=20):
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode())
    except Exception as e:
        print(f'  ! {url.split("/")[-1]}: {e}', file=sys.stderr)
        return None


def de_greenhouse(empresa):
    d = traer(f'https://boards-api.greenhouse.io/v1/boards/{empresa}/jobs?content=true', timeout=35)
    if not d:
        return []
    out = []
    for j in d.get('jobs', []):
        out.append({
            'empresa': j.get('company_name') or empresa.title(),
            'titulo': j.get('title', '').strip(),
            'ubicacion': (j.get('location') or {}).get('name', ''),
            'url': j.get('absolute_url', ''),
            'descripcion': limpiar_html(j.get('content', '')),
            'fuente': 'greenhouse',
        })
    return out


def de_ashby(empresa):
    d = traer(f'https://api.ashbyhq.com/posting-api/job-board/{empresa}?includeCompensation=true', timeout=35)
    if not d:
        return []
    out = []
    for j in d.get('jobs', []):
        if not j.get('isListed', True):
            continue
        out.append({
            'empresa': empresa.title(),
            'titulo': j.get('title', '').strip(),
            'ubicacion': j.get('location', '') or '',
            'url': j.get('jobUrl', ''),
            'remoto_declarado': j.get('isRemote', False),
            'descripcion': limpiar_html(j.get('descriptionPlain') or j.get('descriptionHtml') or ''),
            'fuente': 'ashby',
        })
    return out


def es_remota_latam(v):
    texto = f"{v['titulo']} {v['ubicacion']}".lower()

    # Descarta lo que pide estar en otro país. Se busca como palabra completa
    # para evitar falsos positivos (ej. "india" dentro de otra palabra).
    for x in EXCLUIR_UBICACION:
        if re.search(r'\b' + re.escape(x) + r'\b', texto):
            return False

    # Descarta puestos que no van con el perfil de la comunidad
    titulo = v['titulo'].lower()
    for x in EXCLUIR_PUESTO:
        if x in titulo:
            return False

    remota = v.get('remoto_declarado') or any(p in texto for p in PISTAS_REMOTO)
    if not remota:
        return False

    # Si nombra una región concreta, tiene que incluir la nuestra
    menciona_region = any(
        re.search(r'\b' + r + r'\b', texto) for r in
        ['united states', 'usa', 'u.s.', 'europe', 'uk']
    )
    if menciona_region and not any(p in texto for p in PISTAS_LATAM):
        return False

    return True


def categorizar(titulo):
    t = titulo.lower()
    for nombre, claves in CATEGORIAS:
        if any(c in t for c in claves):
            return nombre
    return None  # fuera de las categorías del post


def buscar():
    todas = []
    print(f'Buscando en {len(GREENHOUSE)} empresas de Greenhouse...', file=sys.stderr)
    for e in GREENHOUSE:
        todas += de_greenhouse(e)
    print(f'Buscando en {len(ASHBY)} empresas de Ashby...', file=sys.stderr)
    for e in ASHBY:
        todas += de_ashby(e)

    print(f'  {len(todas)} vacantes en total', file=sys.stderr)

    filtradas = [v for v in todas
                 if v['titulo'] and v['url']
                 and es_remota_latam(v) and elegibilidad_ok(v)]
    print(f'  {len(filtradas)} remotas abiertas a LATAM', file=sys.stderr)

    por_cat = defaultdict(list)
    for v in filtradas:
        c = categorizar(v['titulo'])
        if c:
            por_cat[c].append(v)

    total = sum(len(v) for v in por_cat.values())
    print(f'  {total} en las categorías del post', file=sys.stderr)
    return por_cat


def escribir_post(por_cat, max_por_cat=4):
    lineas = []
    total = 0
    # Respeta el orden de CATEGORIAS, no el de aparición
    for nombre, _ in CATEGORIAS:
        vs = por_cat.get(nombre, [])
        if not vs:
            continue
        # Una vacante por empresa dentro de cada categoría, para que la lista
        # no se llene de la misma compañía
        vistas, elegidas = set(), []
        for v in vs:
            if v['empresa'] in vistas:
                continue
            vistas.add(v['empresa'])
            elegidas.append(v)
            if len(elegidas) >= max_por_cat:
                break

        lineas.append(f'\n{nombre}')
        for v in elegidas:
            lineas.append(f"{v['empresa']} - {v['titulo']}")
            lineas.append(v['url'])
            total += 1

    return '\n'.join(lineas).strip(), total


if __name__ == '__main__':
    por_cat = buscar()
    if '--json' in sys.argv:
        print(json.dumps(por_cat, indent=2, ensure_ascii=False))
    else:
        cuerpo, total = escribir_post(por_cat)
        print(f'\n{"="*60}')
        print(f'{total} VACANTES LISTAS PARA PUBLICAR')
        print('='*60)
        print(cuerpo)
