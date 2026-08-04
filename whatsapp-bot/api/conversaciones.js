// Newave — API del dashboard: lista de conversaciones, detalle de una,
// etiquetado y borrado.
const {
  listarConversaciones,
  obtenerConversacion,
  borrarConversacion,
  obtenerLead,
  guardarEtiqueta,
} = require('./db');

const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD;

// Las que puede poner el dashboard. Cerrado a propósito: si el día de mañana
// se agregan más, que sea aquí y no aceptando cualquier texto del cliente.
const ETIQUETAS_VALIDAS = ['buena', 'revisar', 'convirtio'];

module.exports = async function handler(req, res) {
  const clave = req.query.clave;
  if (!DASHBOARD_PASSWORD || clave !== DASHBOARD_PASSWORD) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  try {
    if (req.method === 'DELETE') {
      const numero = req.query.numero;
      if (!numero) return res.status(400).json({ error: 'Falta numero' });
      await borrarConversacion(numero);
      return res.status(200).json({ ok: true });
    }

    // Marcar cómo salió una conversación
    if (req.method === 'POST') {
      const { numero, etiqueta } = req.body || {};
      if (!numero) return res.status(400).json({ error: 'Falta numero' });
      if (etiqueta && !ETIQUETAS_VALIDAS.includes(etiqueta)) {
        return res.status(400).json({ error: 'Etiqueta no válida' });
      }
      await guardarEtiqueta(numero, etiqueta || null);
      return res.status(200).json({ ok: true, numero, etiqueta: etiqueta || null });
    }

    if (req.method !== 'GET') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const numero = req.query.numero;
    if (numero) {
      // El lead va junto con los mensajes para poder leer la conversación
      // sabiendo con quién habla el bot, sin ir al sheet.
      const [mensajes, lead] = await Promise.all([
        obtenerConversacion(numero),
        obtenerLead(numero),
      ]);
      return res.status(200).json({ numero, mensajes, lead });
    }

    const conversaciones = await listarConversaciones(req.query.q);
    return res.status(200).json({ conversaciones });
  } catch (err) {
    console.error('[conversaciones] Error:', err);
    return res.status(500).json({ error: 'Error interno' });
  }
};
