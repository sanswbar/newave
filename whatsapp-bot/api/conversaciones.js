// Newave — API del dashboard: lista de conversaciones, detalle de una, o borrado.
const { listarConversaciones, obtenerConversacion, borrarConversacion } = require('./db');

const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD;

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

    if (req.method !== 'GET') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const numero = req.query.numero;
    if (numero) {
      const mensajes = await obtenerConversacion(numero);
      return res.status(200).json({ numero, mensajes });
    }

    const conversaciones = await listarConversaciones();
    return res.status(200).json({ conversaciones });
  } catch (err) {
    console.error('[conversaciones] Error:', err);
    return res.status(500).json({ error: 'Error interno' });
  }
};
