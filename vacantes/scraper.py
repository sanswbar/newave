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
import os
import random
import re
import sys
import urllib.request
import urllib.error
from collections import defaultdict
from datetime import datetime

# Empresas que ya han publicado vacantes remotas para LATAM. Las de la lista
# del post anterior más otras del mismo perfil: SaaS internacional, contratan
# fuera de USA, usan Greenhouse o Ashby.
GREENHOUSE = [
    # Verificadas: responden y publican vacantes. Las que daban 404 se
    # quitaron (cambiaron de plataforma o de slug) — dejarlas solo achicaba
    # el pool sin que se notara.
    'gitlab', 'canonical', 'sezzle', 'twilio', 'customerio', 'cloudbeds',
    'varicent', 'remotecom', 'alpaca', 'stackblitz', 'consensys',
    'grafanalabs', 'mercury', 'vercel', 'cabify',
    'elastic', 'datadog', 'mongodb', 'doximity', 'thoughtworks',
    'coinbase', 'bitso', 'clara',
    # LATAM: contratan en la región
    'quintoandar', 'ebanx', 'vtex', 'wizeline', 'cobre',
]

ASHBY = [
    'supabase', 'oyster', 'hopper', 'linear', 'ramp', 'clerk',
    'replit', 'posthog', 'browserbase',
    'multiverse', 'runway', 'notion', 'vanta', 'deepgram',
    'astronomer', 'railway', 'render', 'neon',
    # LATAM
    'nubank', 'modus', 'gorilla', 'swap', 'simetrik',
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
    'global', 'anywhere', 'worldwide',
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


# Historial de lo ya publicado. Sin esto el scraper vuelve a proponer las
# mismas vacantes cada semana: siguen abiertas y siguen saliendo primero en
# la respuesta de la API.
HISTORIAL = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'publicadas.json')

# Después de este tiempo una vacante puede repetirse (por si el post anterior
# se perdió o la persona no alcanzó a verla).
DIAS_PARA_REPETIR = 90


def leer_historial():
    if not os.path.exists(HISTORIAL):
        return {}
    try:
        with open(HISTORIAL, encoding='utf-8') as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        # Historial corrupto: mejor empezar de cero que tronar el post
        print('  ! historial ilegible, se empieza de cero', file=sys.stderr)
        return {}


# Cuántas semanas descansa una empresa antes de volver a salir. No es que
# repetir esté mal —si la vacante sigue abierta, sirve— es que el post no se
# sienta el mismo cada semana. Con 2 semanas una empresa nunca sale dos
# semanas seguidas, pero puede volver pronto si tiene algo bueno.
SEMANAS_DESCANSO_EMPRESA = 2


def empresas_recientes(hist, semanas=SEMANAS_DESCANSO_EMPRESA):
    """Empresas publicadas en los últimos N*7 días."""
    limite = datetime.now().toordinal() - (semanas * 7)
    out = set()
    for dato in hist.values():
        if not isinstance(dato, dict):
            continue  # formato viejo: solo fecha, sin empresa
        try:
            if datetime.strptime(dato['fecha'], '%Y-%m-%d').toordinal() >= limite:
                out.add(dato['empresa'])
        except (KeyError, ValueError):
            continue
    return out


def guardar_historial(hist, publicadas):
    hoy = datetime.now().strftime('%Y-%m-%d')
    for v in publicadas:
        hist[v['url']] = {'fecha': hoy, 'empresa': v['empresa']}
    # Suelta las viejas para que el archivo no crezca sin fin
    limite = (datetime.now().toordinal() - DIAS_PARA_REPETIR)
    def vigente(d):
        fecha = d['fecha'] if isinstance(d, dict) else d
        try:
            return datetime.strptime(fecha, '%Y-%m-%d').toordinal() >= limite
        except ValueError:
            return False
    hist = {u: d for u, d in hist.items() if vigente(d)}
    try:
        with open(HISTORIAL, 'w', encoding='utf-8') as f:
            json.dump(hist, f, indent=2, ensure_ascii=False)
    except OSError as e:
        print(f'  ! no se pudo guardar el historial: {e}', file=sys.stderr)
    return hist


def escribir_post(por_cat, max_por_cat=4, hist=None, semilla=None):
    hist = hist if hist is not None else {}
    recientes = empresas_recientes(hist)
    # La semilla cambia cada semana: dentro de la misma semana el post se puede
    # regenerar igual, pero la siguiente rota a otras empresas.
    rnd = random.Random(semilla if semilla is not None
                        else datetime.now().strftime('%Y-%W'))

    lineas = []
    total = 0
    nuevas = []
    repetidas_usadas = 0
    # Respeta el orden de CATEGORIAS, no el de aparición
    for nombre, _ in CATEGORIAS:
        vs = por_cat.get(nombre, [])
        if not vs:
            continue

        # Tres niveles de prioridad, de mejor a peor:
        #   1. vacante nueva de empresa que no ha salido hace semanas
        #   2. vacante nueva de empresa que sí salió hace poco
        #   3. vacante ya publicada (último recurso)
        frescas_nuevas = [v for v in vs
                          if v['url'] not in hist and v['empresa'] not in recientes]
        frescas_repes = [v for v in vs
                         if v['url'] not in hist and v['empresa'] in recientes]
        vistas_antes = [v for v in vs if v['url'] in hist]
        for grupo in (frescas_nuevas, frescas_repes, vistas_antes):
            rnd.shuffle(grupo)
        candidatas = frescas_nuevas + frescas_repes + vistas_antes

        # Una vacante por empresa dentro de cada categoría, para que la lista
        # no se llene de la misma compañía
        vistas, elegidas = set(), []
        for v in candidatas:
            if v['empresa'] in vistas:
                continue
            vistas.add(v['empresa'])
            elegidas.append(v)
            if v['url'] in hist:
                repetidas_usadas += 1
            else:
                nuevas.append({'url': v['url'], 'empresa': v['empresa']})
            if len(elegidas) >= max_por_cat:
                break

        lineas.append(f'\n{nombre}')
        for v in elegidas:
            lineas.append(f"{v['empresa']} - {v['titulo']}")
            lineas.append(v['url'])
            total += 1

    if repetidas_usadas:
        print(f'  {repetidas_usadas} ya se habían publicado (no había suficientes nuevas)',
              file=sys.stderr)
    if recientes:
        print(f'  {len(recientes)} empresas en descanso ({SEMANAS_DESCANSO_EMPRESA} semanas)',
              file=sys.stderr)
    return '\n'.join(lineas).strip(), total, nuevas


if __name__ == '__main__':
    por_cat = buscar()
    if '--json' in sys.argv:
        print(json.dumps(por_cat, indent=2, ensure_ascii=False))
    else:
        hist = leer_historial()
        print(f'  {len(hist)} vacantes en el historial', file=sys.stderr)
        cuerpo, total, nuevas = escribir_post(por_cat, hist=hist)
        print(f'\n{"="*60}')
        print(f'{total} VACANTES LISTAS PARA PUBLICAR')
        print('='*60)
        print(cuerpo)
        if '--no-guardar' not in sys.argv:
            guardar_historial(hist, nuevas)
            print(f'\n({len(nuevas)} nuevas guardadas en el historial)', file=sys.stderr)
