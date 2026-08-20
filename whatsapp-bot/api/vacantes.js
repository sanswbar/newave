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

const GREENHOUSE = [
  'gitlab', 'canonical', 'sezzle', 'twilio', 'customerio', 'cloudbeds',
  'varicent', 'remotecom', 'alpaca', 'stackblitz', 'consensys',
  'deel', 'sourcegraph', 'grafanalabs', 'airbyte', 'dbtlabs',
  'clipboardhealth', 'mercury', 'vercel', 'cabify', 'nubank',
];

const ASHBY = [
  'supabase', 'oyster', 'hopper', 'linear', 'ramp', 'clerk',
  'replit', 'posthog', 'browserbase', 'openphone',
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
      if (c) porCategoria[c].push({ ...v, puntaje: puntuar(v) });
    }
    for (const c of Object.keys(porCategoria)) {
      porCategoria[c].sort((a, b) => b.puntaje - a.puntaje);
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

    return res.status(200).json({
      ok: true,
      revisadas: todas.length,
      candidatas: filtradas.length,
      total: n,
      categorias: salida,
    });
  } catch (err) {
    console.error('[vacantes] Error:', err);
    return res.status(500).json({ error: err.message });
  }
};
