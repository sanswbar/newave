// Newave — recibe los datos del formulario desde Apps Script y los guarda,
// para que el bot sepa con quién está hablando antes de que se lo cuenten.

const { guardarLead } = require('./db');

const LEAD_SECRET = process.env.LEAD_SECRET;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Sin este chequeo cualquiera podría inyectar datos falsos de leads.
  if (!LEAD_SECRET || req.headers['x-lead-secret'] !== LEAD_SECRET) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  try {
    const { nombre, whatsapp, trabajo, razon, ingles, compromiso } = req.body || {};

    const numero = normalizarNumero(whatsapp);
    if (!numero) {
      return res.status(400).json({ error: 'Falta whatsapp' });
    }

    await guardarLead({
      numero,
      nombre: nombre || '',
      trabajo: trabajo || '',
      razon: razon || '',
      ingles: ingles || '',
      compromiso: compromiso || '',
    });

    return res.status(200).json({ ok: true, numero });
  } catch (err) {
    console.error('[lead] Error guardando lead:', err);
    return res.status(500).json({ error: 'Error interno' });
  }
};

// Deja el número en el mismo formato que usa el webhook al recibir mensajes,
// si no, el cruce nunca encuentra al lead. Ver normalizarNumeroMx() en
// webhook.js: WhatsApp manda los mexicanos como 521XXXXXXXXXX (13 dígitos)
// y ahí se les quita ese "1", así que aquí hay que llegar al mismo resultado.
function normalizarNumero(numero) {
  if (!numero) return '';
  let digits = numero.toString().replace(/\D/g, '');

  if (digits.length === 10) digits = '52' + digits;      // 10 dígitos pelones: mexicano sin lada
  if (digits.startsWith('521') && digits.length === 13) {  // 521 + 10 dígitos: quitar el "1"
    digits = '52' + digits.slice(3);
  }
  return digits;
}
