// Newave — métricas del embudo (leads → click → trial) para el dashboard.
// Los datos viven en el Google Sheet, así que esto es un proxy a Apps Script:
// evita exponer su URL en el HTML y reusa la misma contraseña del dashboard.

const { numerosConConversacion, estadisticasBot } = require('./db');

const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD;
const APPSCRIPT_URL = process.env.APPSCRIPT_METRICAS_URL;

// El sheet cambia despacio y la consulta recorre miles de filas; cachear un
// par de minutos evita castigar a Apps Script en cada refresh del dashboard.
const CACHE_MS = 2 * 60 * 1000;
let cache = null;
let cacheAt = 0;

module.exports = async function handler(req, res) {
  if (!DASHBOARD_PASSWORD || req.query.clave !== DASHBOARD_PASSWORD) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  if (!APPSCRIPT_URL) {
    return res.status(503).json({ error: 'Falta configurar APPSCRIPT_METRICAS_URL' });
  }

  const ahora = Date.now();
  if (cache && ahora - cacheAt < CACHE_MS && !req.query.fresh) {
    return res.status(200).json({ ...cache, cacheado: true });
  }

  try {
    const url = APPSCRIPT_URL +
      (APPSCRIPT_URL.includes('?') ? '&' : '?') +
      'action=metricas&clave=' + encodeURIComponent(DASHBOARD_PASSWORD);

    const resp = await fetch(url, { redirect: 'follow' });
    const texto = await resp.text();

    let data;
    try {
      data = JSON.parse(texto);
    } catch (err) {
      // Apps Script devuelve HTML cuando la implementación no es pública o
      // la URL quedó mal — sin esto el error real se pierde.
      console.error('[metricas] Respuesta no-JSON de Apps Script:', texto.slice(0, 300));
      return res.status(502).json({ error: 'Apps Script no devolvió JSON. Revisa que la implementación esté publicada.' });
    }

    if (data.status === 'error') {
      return res.status(502).json({ error: data.message || 'Error en Apps Script' });
    }

    // Cruce con el bot: de los que convirtieron, cuántos habían hablado con
    // él. Es la pregunta que ni el sheet ni la DB responden por separado.
    const numerosTrial = data.numerosTrial || [];
    delete data.numerosTrial; // no mandarlos al navegador, no hacen falta ahí

    try {
      const [conConversacion, bot] = await Promise.all([
        numerosConConversacion(),
        estadisticasBot(),
      ]);
      const set = new Set(conConversacion);
      const conBot = numerosTrial.filter(n => set.has(n)).length;

      data.bot = bot;
      data.cruce = {
        trialsConNumero: numerosTrial.length,
        trialsQueHablaronConBot: conBot,
        trialsSinBot: numerosTrial.length - conBot,
      };
    } catch (err) {
      // Si falla la DB, se devuelven las métricas del sheet igual: media
      // respuesta útil es mejor que un error completo.
      console.error('[metricas] No se pudo cruzar con el bot:', err);
    }

    cache = data;
    cacheAt = ahora;
    return res.status(200).json(data);
  } catch (err) {
    console.error('[metricas] Error:', err);
    return res.status(500).json({ error: 'Error consultando métricas' });
  }
};
