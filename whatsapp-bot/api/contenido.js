// Newave — buscador de contenido para el Learning Spot de la comunidad.
//
// Trae lo nuevo de las fuentes que ya seguimos (podcasts, ensayos, blogs) y
// arma un borrador de post con la estructura que Jaime y Santiago ya usan:
// título, qué es, por qué vale la pena, y una pregunta a la comunidad.
//
// El borrador es un punto de partida, NO el post final. Estos posts funcionan
// porque se nota que alguien de verdad consumió el contenido; el texto
// definitivo lo escribe una persona con su propia reacción.

const FUENTES_COMUNIDAD = [
  // ── Founders y mentalidad emprendedora ──
  { nombre: 'Founders', tipo: 'podcast', tema: 'founders',
    url: 'https://feeds.megaphone.fm/DSLLC6297708582' },
  { nombre: 'Acquired', tipo: 'podcast', tema: 'founders',
    url: 'https://feeds.transistor.fm/acquired' },
  { nombre: 'My First Million', tipo: 'podcast', tema: 'founders',
    url: 'https://feeds.megaphone.fm/HS2300184645' },
  { nombre: 'Invest Like the Best', tipo: 'podcast', tema: 'founders',
    url: 'https://feeds.megaphone.fm/investlikethebest' },

  // ── Filosofía práctica y forma de pensar ──
  { nombre: 'Naval', tipo: 'ensayo', tema: 'mentalidad',
    url: 'https://nav.al/feed' },
  { nombre: 'Modern Wisdom', tipo: 'podcast', tema: 'mentalidad',
    url: 'https://feeds.megaphone.fm/SIXMSB5088139739' },
  { nombre: 'Farnam Street', tipo: 'ensayo', tema: 'mentalidad',
    url: 'https://fs.blog/feed/' },
  { nombre: 'The Knowledge Project', tipo: 'podcast', tema: 'mentalidad',
    url: 'https://theknowledgeproject.libsyn.com/rss' },

  // ── Carrera, trabajo y soft skills ──
  { nombre: "Lenny's Newsletter", tipo: 'ensayo', tema: 'carrera',
    url: 'https://www.lennysnewsletter.com/feed' },
  { nombre: "Lenny's Podcast", tipo: 'podcast', tema: 'carrera',
    url: 'https://api.substack.com/feed/podcast/10845.rss' },
  { nombre: 'A Smart Bear', tipo: 'ensayo', tema: 'carrera',
    url: 'https://longform.asmartbear.com/index.xml' },
  { nombre: 'Paul Graham', tipo: 'ensayo', tema: 'mentalidad',
    url: 'http://www.aaronsw.com/2002/feeds/pgessays.rss' },

  // ── Trabajo remoto ──
  { nombre: 'Remote.co', tipo: 'artículo', tema: 'remoto',
    url: 'https://remote.co/feed' },
];


// Fuentes para Santiago, distintas a las de la comunidad: liderazgo,
// crecimiento de comunidades y growth, para mejorar Newave como negocio.
const FUENTES_SANTIAGO = [
  { nombre: "Lenny's Newsletter", tipo: 'ensayo', tema: 'growth',
    url: 'https://www.lennysnewsletter.com/feed' },
  { nombre: 'Andrew Chen', tipo: 'ensayo', tema: 'growth',
    url: 'https://andrewchen.com/feed/' },
  { nombre: 'Creator Science', tipo: 'ensayo', tema: 'comunidad',
    url: 'https://creatorscience.com/feed' },
  { nombre: "Seth Godin", tipo: 'ensayo', tema: 'liderazgo',
    url: 'https://seths.blog/feed/' },
  { nombre: 'Derek Sivers', tipo: 'ensayo', tema: 'liderazgo',
    url: 'https://sive.rs/en.atom' },
  { nombre: 'A Smart Bear', tipo: 'ensayo', tema: 'growth',
    url: 'https://longform.asmartbear.com/index.xml' },
  { nombre: 'Farnam Street', tipo: 'ensayo', tema: 'liderazgo',
    url: 'https://fs.blog/feed/' },
  { nombre: 'My First Million', tipo: 'podcast', tema: 'growth',
    url: 'https://feeds.megaphone.fm/HS2300184645' },
];

// Lo que le sirve a Santiago para crecer Newave
const RELEVANTE_SANTIAGO = {
  alto: [
    'community', 'comunidad', 'membership', 'retention', 'churn',
    'onboarding', 'engagement', 'cohort', 'creator', 'audience',
    'growth loop', 'referral', 'word of mouth', 'pricing',
    'leadership', 'managing', 'team', 'culture', 'hiring',
    'course', 'cohort-based', 'newsletter growth', 'funnel',
  ],
  medio: [
    'growth', 'marketing', 'customer', 'user', 'product',
    'strategy', 'business', 'revenue', 'saas', 'subscription',
    'brand', 'content', 'distribution', 'acquisition',
  ],
};

// Palabras que hacen que un contenido valga para esta comunidad. Se puntúa
// por coincidencias: mientras más señales, más arriba aparece.
const RELEVANTE = {
  // Lo que de verdad le sirve a alguien buscando trabajo remoto
  alto: [
    'career', 'carrera', 'remote work', 'trabajo remoto', 'hiring',
    'interview', 'entrevista', 'resume', 'job search', 'get a job',
    'agency', 'high agency', 'discipline', 'obsession', 'ambition',
    'work ethic', 'craft', 'mastery', 'how to get better',
    'first principles', 'leverage', 'compounding',
    'negotiation', 'communication skills', 'personal brand',
    'standing out', 'talent density', 'what makes someone',
  ],
  medio: [
    'founder', 'lessons', 'mindset', 'habits', 'focus',
    'decision', 'thinking', 'learning', 'skill', 'work',
    'success', 'failure', 'risk', 'leadership', 'management',
    'productivity', 'motivation', 'purpose', 'meaning',
  ],
};

// Lo que NO va: demasiado técnico, política, o temas que no conectan con
// alguien buscando trabajo remoto.
const DESCARTA = [
  // Inversión y mercados: la comunidad busca empleo, no invertir
  'invest', 'investing', 'investor', 'portfolio', 'venture capital',
  'stock', 'equity market', 'valuation', 'fund', 'lp ', 'ipo',
  'crypto price', 'bitcoin', 'nft', 'token',
  // Herramientas y reviews de software
  'best tools', 'best social media', 'scheduling tools', 'top 10 tools',
  'review of', 'vs.', 'alternatives to',
  // Fuera de tema
  'election', 'politics', 'president', 'war in',
  'sponsored', 'ad-free feed', 'live show', 'tour dates',
];

function limpiar(t) {
  if (!t) return '';
  return t
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    // Entidades numéricas (&#124; = |, &#8217; = ', etc.): los feeds las
    // usan bastante y sin esto salen crudas en el título.
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/\s+/g, ' ')
    .trim();
}

function extraer(xml, etiqueta) {
  const m = xml.match(new RegExp(`<${etiqueta}[^>]*>([\\s\\S]*?)</${etiqueta}>`, 'i'));
  return m ? limpiar(m[1]) : '';
}

async function traerFeed(fuente) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(fuente.url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NewaveBot/1.0)' },
    });
    if (!r.ok) return [];
    const xml = await r.text();

    // RSS usa <item>, Atom usa <entry>
    const bloques = xml.match(/<item>[\s\S]*?<\/item>/gi)
                 || xml.match(/<entry>[\s\S]*?<\/entry>/gi)
                 || [];

    return bloques.slice(0, 12).map(b => {
      // El link puede venir como <link>url</link> o <link href="url"/>
      let url = extraer(b, 'link');
      if (!url) {
        const m = b.match(/<link[^>]*href="([^"]+)"/i);
        url = m ? m[1] : '';
      }
      const fecha = extraer(b, 'pubDate') || extraer(b, 'published') || extraer(b, 'updated');
      const desc = extraer(b, 'content:encoded') || extraer(b, 'description')
                || extraer(b, 'summary') || extraer(b, 'content');

      return {
        fuente: fuente.nombre,
        tipo: fuente.tipo,
        tema: fuente.tema,
        titulo: extraer(b, 'title'),
        url,
        fecha,
        resumen: desc.slice(0, 2500),
      };
    }).filter(x => x.titulo && x.url);
  } catch (err) {
    console.error(`[contenido] ${fuente.nombre}: ${err.message}`);
    return [];
  } finally {
    clearTimeout(t);
  }
}

function puntuar(item, palabras = RELEVANTE) {
  const texto = `${item.titulo} ${item.resumen}`.toLowerCase();

  for (const d of DESCARTA) {
    if (texto.includes(d)) return -1;
  }

  // La relevancia manda. Antes la fecha pesaba tanto que subía episodios
  // recientes de inversión por encima de un ensayo bueno sobre carrera.
  let p = 0;
  for (const k of palabras.alto)  if (texto.includes(k)) p += 5;
  for (const k of palabras.medio) if (texto.includes(k)) p += 2;

  // Sin ninguna señal de relevancia no entra, por muy reciente que sea
  if (p === 0) return -1;

  // La fecha solo desempata
  const d = new Date(item.fecha);
  if (!isNaN(d)) {
    const dias = (Date.now() - d.getTime()) / 86400000;
    if (dias <= 14) p += 2;
    else if (dias <= 45) p += 1;
    else if (dias > 400) p -= 2;
  }

  // Los ensayos envejecen mejor que un episodio suelto y son más fáciles de
  // consumir para alguien que está buscando trabajo
  if (item.tipo === 'ensayo') p += 2;

  return p;
}


// Baja el artículo y saca el texto. El resumen del feed suele ser un párrafo
// de marketing; para escribir puntos concretos hace falta el contenido real.
async function traerTexto(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NewaveBot/1.0)' },
    });
    if (!r.ok) return '';
    const html = await r.text();

    // Fuera lo que no es contenido
    let t = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
      .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
      .replace(/<header[\s\S]*?<\/header>/gi, ' ');

    // Si hay <article> o <main>, quedarse solo con eso
    const art = t.match(/<article[\s\S]*?<\/article>/i) || t.match(/<main[\s\S]*?<\/main>/i);
    if (art) t = art[0];

    return limpiar(t).slice(0, 14000);
  } catch (err) {
    console.error(`[contenido] no se pudo leer ${url}: ${err.message}`);
    return '';
  } finally {
    clearTimeout(t);
  }
}



// Le pide al modelo que lo deje en 5 bloques, conservando el hilo. Se hace
// en una segunda llamada porque en la primera, escribiendo, no logra
// respetar el límite: se entusiasma con las ideas.
async function reescribirCorto(texto, key) {
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 1500,
        messages: [{
          role: 'user',
          content: `Este post quedó largo. Déjalo en 5 bloques como máximo, contando todo lo que va separado por línea en blanco.

Reglas:
- Conserva el link y la pregunta final tal cual.
- Quédate con la idea más interesante y desarróllala bien. Si caben dos, mejor, pero no las metas a la fuerza.
- Si citas una frase, el contexto tiene que quedar en el mismo bloque o en el de junto. No dejes párrafos colgando que empiecen con "Lo dice porque" sin decir qué dice.
- No cambies el tono ni el estilo. Solo acorta.
- Devuelve SOLO el post, sin explicaciones.

POST:
${texto}`,
        }],
      }),
    });
    const d = await r.json();
    if (!r.ok) return null;
    const b = Array.isArray(d.content) ? d.content.find(x => x.type === 'text') : null;
    return b?.text?.trim() || null;
  } catch (err) {
    console.error('[contenido] reescribirCorto falló:', err);
    return null;
  }
}

// Escribe los puntos del post con Claude, en la voz del Learning Spot.
async function generarPuntos(item) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;

  // El artículo completo si se puede bajar; si no, lo que traiga el feed
  const cuerpo = await traerTexto(item.url) || item.resumen || '';
  if (cuerpo.length < 200) return null;

  const prompt = `Vas a escribir un post para la comunidad de Newave Academy, un programa que ayuda a profesionales de México y LATAM a conseguir trabajo remoto con empresas internacionales.

Escribes como Santiago, uno de los fundadores.

Este es el contenido:

FUENTE: ${item.fuente} (${item.tipo})
TÍTULO: ${item.titulo}
LINK: ${item.url}

CONTENIDO:
${cuerpo.slice(0, 12000)}

Convierte esto en un post escrito como si Santiago lo hubiera consumido y estuviera compartiendo con la comunidad las ideas que más le llamaron la atención.

NO quieres un resumen del contenido.

Quieres que se sienta como: "Escuché esto, hubo un par de cosas que me dejaron pensando y se las quiero compartir."

TONO:
- Casual, humano y directo.
- Como si estuviera escribiendo rápido algo que genuinamente le gustó.
- Nada académico. Nada de frases motivacionales genéricas. Nada de lenguaje corporativo. Nada que suene a IA.
- No intentes meter todas las ideas. Escoge las 2 o 3 que de verdad valga la pena compartir.
- Puedes usar frases como "una que me gustó mucho", "esto me dejó pensando", "otra que me llamó la atención", siempre que se sientan naturales.
- **CORTO: máximo 2 ideas y 200 palabras en total.** Es una recomendación rápida que le mandas a unos amigos, no un ensayo. Si dudas entre incluir una tercera idea o no, déjala fuera.
- Párrafos cortos, pero NO pongas cada oración en un renglón diferente.
- **Español mexicano NEUTRO.** Nada de modismos ni expresiones de novela. Prohibidas por sonar forzadas: "se me quedó rondando en la cabeza", "me pegó fuerte", "me quedó picando", "se me quedó grabado", "me voló la cabeza", "me dejó helado", "no pude no compartirlo". Di las cosas de forma simple: "me pareció interesante", "me hizo pensar", "me llamó la atención", "me gustó".
- Si hay una frase corta y potente del invitado o del autor, puedes destacarla en su propia línea.
- No exageres ni conviertas cada aprendizaje en una gran lección de vida.

ESTRUCTURA:
1. Abre diciendo que es una recomendación y qué escuchó, leyó o vio.
2. Cuenta brevemente quién participa o de qué trata.
3. Comparte 2 o 3 ideas que le hayan parecido interesantes.
4. Explica con sus palabras por qué le llamaron la atención.
5. Si hace sentido, conecta una de esas ideas con trabajar remoto, crecer profesionalmente o trabajar en empresas internacionales. NO fuerces esta conexión: si el contenido no da para eso, déjalo fuera.
6. Comparte el link.
7. Termina con una pregunta sencilla para generar conversación.

REGLAS DE ESCRITURA:
- Español de México. Nada de "vosotros", "ordenador", "vale", ni voseo argentino.
- Cercano pero no coloquial. Prohibidas: "chamba", "la neta", "chido", "ahorita", "te late", "órale".
- Sin guiones largos. Usa punto y seguido o coma.
- Un solo signo de interrogación o exclamación, el de cierre, sin el de apertura. Así: "Por qué?" y "Qué tal!".
- Sin markdown. Nada de asteriscos, títulos ni listas con guiones.
- Cuando cites algo textual, usa comillas normales.

LO MÁS IMPORTANTE: tiene que parecer una recomendación personal que Santiago le mandaría a un grupo de amigos o colegas. No un resumen de contenido ni un post de LinkedIn.

Devuelve SOLO el post, desde la primera línea hasta la pregunta final. Sin encabezados, sin explicaciones tuyas, sin comillas alrededor del post.`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const d = await r.json();
    if (!r.ok) {
      console.error('[contenido] Claude:', r.status, JSON.stringify(d).slice(0, 300));
      return null;
    }
    const bloque = Array.isArray(d.content) ? d.content.find(b => b.type === 'text') : null;
    // El prompt pide separar con "---" para que el modelo distinga las dos
    // partes, pero en el post no debe aparecer.
    const texto = bloque?.text?.trim();
    return texto ? texto.replace(/\n*---+\n*/g, '\n\n') : null;
  } catch (err) {
    console.error('[contenido] generarPuntos falló:', err);
    return null;
  }
}

module.exports = async function handler(req, res) {
  const clave = req.query?.clave;
  if (!clave || clave !== process.env.DASHBOARD_PASSWORD) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  // Modo "escribe los puntos de este": recibe el item elegido y devuelve
  // el texto listo, en vez de buscar contenido nuevo.
  if (req.method === 'POST') {
    try {
      const item = req.body;
      if (!item?.url || !item?.titulo) {
        return res.status(400).json({ error: 'Falta el item' });
      }
      const puntos = await generarPuntos(item);
      return res.status(200).json({ ok: !!puntos, puntos });
    } catch (err) {
      console.error('[contenido] POST:', err);
      return res.status(200).json({ ok: false, error: err.message });
    }
  }

  // ?para=santiago trae liderazgo/comunidad/growth en vez de contenido para
  // publicar. Son audiencias distintas y por eso son fuentes distintas.
  const paraSantiago = req.query?.para === 'santiago';
  const fuentes  = paraSantiago ? FUENTES_SANTIAGO : FUENTES_COMUNIDAD;
  const palabras = paraSantiago ? RELEVANTE_SANTIAGO : RELEVANTE;
  const tope     = Number(req.query?.tope) || 20;

  try {
    const listas = await Promise.all(fuentes.map(traerFeed));
    const todos = listas.flat();

    const conPuntaje = todos
      .map(i => ({ ...i, puntaje: puntuar(i, palabras) }))
      .filter(i => i.puntaje > 0)
      .sort((a, b) => b.puntaje - a.puntaje);

    // Máximo 2 por fuente, para que la lista no la domine un solo podcast
    const porFuente = {};
    const seleccion = [];
    for (const i of conPuntaje) {
      porFuente[i.fuente] = (porFuente[i.fuente] || 0) + 1;
      if (porFuente[i.fuente] <= 2) seleccion.push(i);
      if (seleccion.length >= tope) break;
    }

    return res.status(200).json({
      ok: true,
      revisados: todos.length,
      total: seleccion.length,
      items: seleccion,
    });
  } catch (err) {
    console.error('[contenido] Error:', err);
    return res.status(500).json({ error: err.message });
  }
};
