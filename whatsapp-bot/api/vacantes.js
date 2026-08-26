// Newave — buscador de vacantes remotas para publicar en la comunidad.
//
// Trae las vacantes abiertas de las empresas que ya conocemos (SaaS
// internacional que contrata fuera de USA) y filtra las que alguien desde
// México podría tomar de verdad.
//
// El filtro tiene tres capas porque "Remote" en el título no significa nada:
//   1. El título/ubicación no debe nombrar un país fuera de LATAM
//   2. El puesto debe ir con el perfil de la comunidad (no ingeniería)
//   3. La DESCRIPCIÓN no debe exigir permiso de trabajo en otro país
// La capa 3 es la que de verdad decide: muchas dicen "Remote" arriba y
// "must be authorized to work in the US" abajo.

const { vacantesPublicadas, marcarVacantesPublicadas } = require('./db');

const GREENHOUSE = [
  'gitlab', 'canonical', 'sezzle', 'twilio', 'customerio', 'cloudbeds',
  'varicent', 'remotecom', 'alpaca', 'stackblitz', 'consensys',
  'deel', 'sourcegraph', 'grafanalabs', 'airbyte', 'dbtlabs',
  'clipboardhealth', 'mercury', 'vercel', 'cabify', 'nubank',
  // Con pocas empresas el post repite las mismas marcas cada semana aunque
  // cambien las vacantes. Estas son del mismo perfil: SaaS internacional
  // que contrata fuera de USA.
  'automattic', 'zapier', 'hotjar', 'toptal', 'elastic',
  'hashicorp', 'confluent', 'datadog', 'mongodb', 'doximity',
  'thoughtworks', 'coinbase', 'kraken', 'bitso', 'rappi',
  'konfio', 'clip', 'clara', 'lodgify', 'jobber',
];

const ASHBY = [
  'supabase', 'oyster', 'hopper', 'linear', 'ramp', 'clerk',
  'replit', 'posthog', 'browserbase', 'openphone',
  'multiverse', 'runway', 'notion', 'vanta', 'deepgram',
  'astronomer', 'tailscale', 'railway', 'render', 'neon',
];

const PISTAS_REMOTO = ['remote', 'remoto', 'anywhere', 'distributed', 'global'];

// Países fuera de LATAM. Se comparan como palabra completa.
const EXCLUIR_UBICACION = [
  'italy', 'canada', 'germany', 'france', 'spain', 'portugal',
  'netherlands', 'belgium', 'ireland', 'poland', 'romania', 'ukraine',
  'india', 'philippines', 'vietnam', 'indonesia', 'malaysia',
  'japan', 'china', 'korea', 'singapore', 'australia', 'new zealand',
  'united kingdom', 'switzerland', 'sweden', 'norway', 'denmark',
  'finland', 'austria', 'greece', 'turkey', 'israel', 'egypt',
  'south africa', 'nigeria', 'kenya', 'emea', 'apac', 'benelux',
  'dach', 'nordics',
];

// Roles que no van con el perfil de la comunidad
const EXCLUIR_PUESTO = [
  'engineer', 'developer', 'devops', 'sre ', 'architect',
  'data scientist', 'security', 'qa ',
  'intern', 'internship', 'trainee', 'practicante', 'becari',
  'vice president', 'vp ', 'chief ', 'head of', 'senior director',
];

const PISTAS_LATAM = [
  'latam', 'latin america', 'south america', 'mexico', 'méxico',
  'brazil', 'brasil', 'colombia', 'argentina', 'chile', 'americas',
  'north america', 'global', 'anywhere', 'worldwide',
];

// Lo que aparece cuando la vacante EXIGE estar en otro país
const BLOQUEA_ELEGIBILIDAD = [
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
];

const CATEGORIAS = [
  ['💼 Ventas y Desarrollo de Negocio', [
    'account executive', 'sales', 'business development', 'bdr', 'sdr',
    'partnerships', 'solutions consultant', 'revenue', 'commercial',
    'account manager',
  ]],
  ['🤝 Customer Success', [
    'customer success', 'customer support', 'customer experience',
    'client success', 'retention', 'renewals', 'implementation',
    'onboarding specialist', 'customer operations',
  ]],
  ['📋 Project / Program Management', [
    'project manager', 'program manager', 'product manager',
    'technical program', 'delivery manager', 'project coordinator',
    'scrum master', 'product operations',
  ]],
  ['📣 Marketing y Growth', [
    'marketing', 'growth', 'content', 'social media', 'seo',
    'brand ', 'lifecycle', 'demand generation', 'communications',
    'community manager', 'paid media',
  ]],
  ['⚙️ Operaciones', [
    'operations', 'ops', 'business analyst', 'process',
    'supply chain', 'logistics', 'people ', 'recruiter', 'talent',
    'compliance', 'administrative',
  ]],
  ['💰 Finanzas', [
    'finance', 'accounting', 'accountant', 'controller',
    'financial', 'payroll', 'treasury', 'fp&a', 'billing',
  ]],
];

// Cuántas vacantes lleva el post. Se reparten entre las categorías que
// tengan resultados, priorizando siempre las que mencionan México o LATAM
// explícitamente: son las que la gente puede tomar con más certeza.
const TOTAL_POST = 10;

// Días que una empresa descansa antes de volver a salir. No es que repetir
// esté mal —si la vacante sigue abierta, sirve— es que el post no se sienta
// el mismo cada semana.
const DIAS_DESCANSO_EMPRESA = 14;
// Después de esto una vacante puede repetirse.
const DIAS_REPETIR_VACANTE = 90;

// Piso de elegibilidad. Abajo de esto la vacante no dice de dónde contrata
// o dice un lugar que no es el nuestro ("Remote - Cyprus", "San Francisco
// HQ"). Es mejor un post de 6 vacantes que alguien puede tomar que uno de
// 10 con cuatro que no.
const PUNTAJE_MINIMO = 55;

function limpiarHtml(texto) {
  if (!texto) return '';
  return texto
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

async function traer(url, ms = 25000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!r.ok) return null;
    return await r.json();
  } catch (err) {
    console.error(`[vacantes] ${url.split('/').slice(-2).join('/')}: ${err.message}`);
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function deGreenhouse(empresa) {
  const d = await traer(`https://boards-api.greenhouse.io/v1/boards/${empresa}/jobs?content=true`);
  if (!d?.jobs) return [];
  return d.jobs.map(j => ({
    empresa: (j.company_name || empresa).trim(),
    titulo: (j.title || '').trim(),
    ubicacion: j.location?.name || '',
    url: j.absolute_url || '',
    descripcion: limpiarHtml(j.content || ''),
  }));
}

async function deAshby(empresa) {
  const d = await traer(`https://api.ashbyhq.com/posting-api/job-board/${empresa}`);
  if (!d?.jobs) return [];
  return d.jobs
    .filter(j => j.isListed !== false)
    .map(j => ({
      empresa: empresa.charAt(0).toUpperCase() + empresa.slice(1),
      titulo: (j.title || '').trim(),
      ubicacion: j.location || '',
      url: j.jobUrl || '',
      remotoDeclarado: !!j.isRemote,
      descripcion: limpiarHtml(j.descriptionPlain || j.descriptionHtml || ''),
    }));
}

function esRemotaLatam(v) {
  const texto = `${v.titulo} ${v.ubicacion}`.toLowerCase();

  for (const x of EXCLUIR_UBICACION) {
    if (new RegExp(`\\b${x}\\b`).test(texto)) return false;
  }
  const titulo = v.titulo.toLowerCase();
  for (const x of EXCLUIR_PUESTO) {
    if (titulo.includes(x)) return false;
  }

  const remota = v.remotoDeclarado || PISTAS_REMOTO.some(p => texto.includes(p));
  if (!remota) return false;

  const mencionaRegion = ['united states', 'usa', 'europe', 'uk']
    .some(r => new RegExp(`\\b${r}\\b`).test(texto));
  if (mencionaRegion && !PISTAS_LATAM.some(p => texto.includes(p))) return false;

  return true;
}

function elegibilidadOk(v) {
  if (!v.descripcion) return true;
  return !BLOQUEA_ELEGIBILIDAD.some(f => v.descripcion.includes(f));
}


// Qué tan segura es la vacante para alguien en México. Las que lo dicen
// explícitamente van primero: son las que puede tomar sin dudas.
function puntuar(v) {
  const texto = `${v.titulo} ${v.ubicacion}`.toLowerCase();
  const desc = v.descripcion || '';

  // Lo dice en el título o la ubicación: máxima certeza
  if (/\b(mexico|méxico|latam|latin america)\b/.test(texto)) return 100;
  // Abierta a las Américas
  if (/\b(americas|north america)\b/.test(texto)) return 80;
  // Lo dice en la descripción
  if (/\b(mexico|méxico|latam|latin america)\b/.test(desc)) return 70;
  // Global o desde cualquier lado
  if (/\b(worldwide|anywhere|globally|global)\b/.test(texto)) return 60;
  if (desc.includes('countries around the world') || desc.includes('anywhere in the world')) return 55;
  // Remota sin restricción detectada
  return 30;
}

function categorizar(titulo) {
  const t = titulo.toLowerCase();
  for (const [nombre, claves] of CATEGORIAS) {
    if (claves.some(c => t.includes(c))) return nombre;
  }
  return null;
}

module.exports = async function handler(req, res) {
  const clave = req.query?.clave;
  if (!clave || clave !== process.env.DASHBOARD_PASSWORD) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  try {
    // En paralelo: son ~30 llamadas y en serie tardarían minutos
    const listas = await Promise.all([
      ...GREENHOUSE.map(deGreenhouse),
      ...ASHBY.map(deAshby),
    ]);
    const todas = listas.flat();

    const filtradas = todas.filter(v =>
      v.titulo && v.url && esRemotaLatam(v) && elegibilidadOk(v)
    );

    // Agrupa por categoría y ordena cada una por qué tan claro está que
    // contratan en México/LATAM.
    const porCategoria = {};
    for (const [nombre] of CATEGORIAS) porCategoria[nombre] = [];
    for (const v of filtradas) {
      const c = categorizar(v.titulo);
      if (!c) continue;
      const puntaje = puntuar(v);
      if (puntaje < PUNTAJE_MINIMO) continue;  // no la puede tomar nadie de acá
      porCategoria[c].push({ ...v, puntaje });
    }
    // Historial: qué ya se propuso y qué empresas salieron hace poco.
    // Si la base falla, seguimos sin historial en vez de tronar el buscador.
    let urlsVistas = new Set();
    let empresasRecientes = new Set();
    try {
      const previas = await vacantesPublicadas(DIAS_REPETIR_VACANTE);
      urlsVistas = new Set(previas.map(p => p.url));
      const corte = Date.now() - DIAS_DESCANSO_EMPRESA * 86400000;
      empresasRecientes = new Set(
        previas.filter(p => new Date(p.publicada_en).getTime() > corte)
               .map(p => p.empresa)
      );
    } catch (err) {
      console.error('[vacantes] historial no disponible:', err.message);
    }

    // El puntaje manda: lo que importa es que la persona pueda aplicar de
    // verdad desde México. Una vacante que dice "Mexico" o "LATAM" vale más
    // que una variada pero que no la puede tomar nadie.
    //
    // La rotación solo desempata entre vacantes igual de buenas: dentro del
    // mismo nivel de certeza, primero las que no se han propuesto y las de
    // empresas que no salieron hace poco. Así el post cambia sin perder
    // elegibilidad.
    //
    // Los puntajes se agrupan en niveles porque 100 vs 80 sí es una
    // diferencia real (lo dice vs se infiere), pero dentro de cada nivel
    // podemos rotar libremente.
    const nivel = (p) => (p >= 100 ? 3 : p >= 70 ? 2 : p >= 55 ? 1 : 0);

    for (const c of Object.keys(porCategoria)) {
      porCategoria[c].sort((a, b) => {
        const la = nivel(a.puntaje), lb = nivel(b.puntaje);
        if (la !== lb) return lb - la;             // certeza primero
        const na = urlsVistas.has(a.url) ? 1 : 0;
        const nb = urlsVistas.has(b.url) ? 1 : 0;
        if (na !== nb) return na - nb;             // luego lo no propuesto
        const ra = empresasRecientes.has(a.empresa) ? 1 : 0;
        const rb = empresasRecientes.has(b.empresa) ? 1 : 0;
        if (ra !== rb) return ra - rb;             // luego rotación de marca
        return b.puntaje - a.puntaje;
      });
    }

    // Reparte TOTAL_POST entre las categorías con resultados: una vuelta
    // dando la mejor de cada una, luego otra, hasta llegar al total. Así el
    // post sale variado en vez de diez vacantes de la misma categoría.
    const conResultados = Object.keys(porCategoria).filter(c => porCategoria[c].length);
    const elegidas = {};
    for (const c of conResultados) elegidas[c] = [];
    const empresasUsadas = new Set();
    let n = 0, vuelta = 0;

    while (n < TOTAL_POST && vuelta < 20) {
      let agregoAlgo = false;
      for (const c of conResultados) {
        if (n >= TOTAL_POST) break;
        // Una vacante por empresa en todo el post, para no repetir compañía
        const cand = porCategoria[c].find(v =>
          !empresasUsadas.has(v.empresa) && !elegidas[c].includes(v)
        );
        if (cand) {
          elegidas[c].push(cand);
          empresasUsadas.add(cand.empresa);
          n++;
          agregoAlgo = true;
        }
      }
      if (!agregoAlgo) break; // ya no hay de dónde sacar
      vuelta++;
    }

    // Limpia la descripción antes de mandar al front (pesa mucho)
    const salida = {};
    for (const [c, vs] of Object.entries(elegidas)) {
      if (!vs.length) continue;
      salida[c] = vs.map(({ descripcion, ...resto }) => resto);
    }

    // Guarda lo propuesto para no repetirlo la próxima. Si falla, el post
    // igual se entrega: perder el historial de una semana no vale un error.
    try {
      await marcarVacantesPublicadas(
        Object.values(elegidas).flat().map(v => ({
          url: v.url, empresa: v.empresa, titulo: v.titulo,
        }))
      );
    } catch (err) {
      console.error('[vacantes] no se pudo guardar el historial:', err.message);
    }

    return res.status(200).json({
      ok: true,
      revisadas: todas.length,
      candidatas: filtradas.length,
      elegibles: Object.values(porCategoria).reduce((n, vs) => n + vs.length, 0),
      total: n,
      categorias: salida,
    });
  } catch (err) {
    console.error('[vacantes] Error:', err);
    return res.status(500).json({ error: err.message });
  }
};
