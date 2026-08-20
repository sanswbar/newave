// Newave — buscador de contenido para el Learning Spot de la comunidad.
//
// Trae lo nuevo de las fuentes que ya seguimos (podcasts, ensayos, blogs) y
// arma un borrador de post con la estructura que Jaime y Santiago ya usan:
// título, qué es, por qué vale la pena, y una pregunta a la comunidad.
//
// El borrador es un punto de partida, NO el post final. Estos posts funcionan
// porque se nota que alguien de verdad consumió el contenido; el texto
// definitivo lo escribe una persona con su propia reacción.

const FUENTES = [
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
      const desc = extraer(b, 'description') || extraer(b, 'summary') || extraer(b, 'content');

      return {
        fuente: fuente.nombre,
        tipo: fuente.tipo,
        tema: fuente.tema,
        titulo: extraer(b, 'title'),
        url,
        fecha,
        resumen: desc.slice(0, 600),
      };
    }).filter(x => x.titulo && x.url);
  } catch (err) {
    console.error(`[contenido] ${fuente.nombre}: ${err.message}`);
    return [];
  } finally {
    clearTimeout(t);
  }
}

function puntuar(item) {
  const texto = `${item.titulo} ${item.resumen}`.toLowerCase();

  for (const d of DESCARTA) {
    if (texto.includes(d)) return -1;
  }

  // La relevancia manda. Antes la fecha pesaba tanto que subía episodios
  // recientes de inversión por encima de un ensayo bueno sobre carrera.
  let p = 0;
  for (const k of RELEVANTE.alto)  if (texto.includes(k)) p += 5;
  for (const k of RELEVANTE.medio) if (texto.includes(k)) p += 2;

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

module.exports = async function handler(req, res) {
  const clave = req.query?.clave;
  if (!clave || clave !== process.env.DASHBOARD_PASSWORD) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  try {
    const listas = await Promise.all(FUENTES.map(traerFeed));
    const todos = listas.flat();

    const conPuntaje = todos
      .map(i => ({ ...i, puntaje: puntuar(i) }))
      .filter(i => i.puntaje > 0)
      .sort((a, b) => b.puntaje - a.puntaje);

    // Máximo 2 por fuente, para que la lista no la domine un solo podcast
    const porFuente = {};
    const seleccion = [];
    for (const i of conPuntaje) {
      porFuente[i.fuente] = (porFuente[i.fuente] || 0) + 1;
      if (porFuente[i.fuente] <= 2) seleccion.push(i);
      if (seleccion.length >= 20) break;
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
