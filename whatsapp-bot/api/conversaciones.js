// Newave — API del dashboard: lista de conversaciones o detalle de una.
const { listarConversaciones, obtenerConversacion } = require('./db');

const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD;

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const clave = req.query.clave;
  if (!DASHBOARD_PASSWORD || clave !== DASHBOARD_PASSWORD) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  try {
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
