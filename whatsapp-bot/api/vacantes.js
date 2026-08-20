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
  'data scientist', 'machine learning', 'security', 'qa ',
  'intern', 'internship', 'trainee',
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
  ['📋 Project / Program Management', [
    'project manager', 'program manager', 'product manager',
    'technical program', 'delivery manager', 'scrum master',
  ]],
  ['🤝 Customer Success', [
    'customer success', 'customer support', 'customer experience',
    'account manager', 'client success', 'implementation',
    'onboarding specialist',
  ]],
  ['💼 Account Management / Sales', [
    'account executive', 'sales', 'business development', 'bdr', 'sdr',
    'revenue', 'partnerships', 'solutions consultant',
  ]],
  ['🎨 Graphic Design / UX-UI', [
    'designer', 'design ', 'ux', 'ui ', 'creative', 'brand ',
  ]],
  ['📣 Digital Marketing', [
    'marketing manager', 'marketing specialist', 'marketing analyst',
    'growth', 'content', 'social media', 'seo', 'brand marketing',
    'lifecycle', 'demand generation', 'communications',
  ]],
  ['⚙️ Operations', [
    'operations', 'ops', 'business analyst', 'process',
    'supply chain', 'logistics', 'people ', 'recruiter', 'talent',
  ]],
  ['💰 Finance', [
    'finance', 'accounting', 'accountant', 'controller',
    'financial', 'payroll', 'treasury', 'fp&a',
  ]],
];

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

    // Agrupa por categoría, respetando el orden de CATEGORIAS
    const porCategoria = {};
    for (const [nombre] of CATEGORIAS) porCategoria[nombre] = [];
    for (const v of filtradas) {
      const c = categorizar(v.titulo);
      if (c) {
        // La descripción pesa mucho y no se usa en el front
        const { descripcion, ...resto } = v;
        porCategoria[c].push(resto);
      }
    }

    const total = Object.values(porCategoria).reduce((n, a) => n + a.length, 0);

    return res.status(200).json({
      ok: true,
      revisadas: todas.length,
      total,
      categorias: porCategoria,
    });
  } catch (err) {
    console.error('[vacantes] Error:', err);
    return res.status(500).json({ error: err.message });
  }
};
