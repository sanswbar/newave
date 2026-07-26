// Newave — WhatsApp AI Bot (Vercel Function)
// Recibe mensajes de WhatsApp (Meta Cloud API), los pasa a Claude con el
// cerebro de Newave, y responde automáticamente por WhatsApp.

const fs = require('fs');
const path = require('path');

// ─── CONFIG (todo vive en variables de entorno de Vercel, NO en el código) ───
const VERIFY_TOKEN   = process.env.VERIFY_TOKEN;          // el que tú inventes para verificar el webhook
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;        // token de la Cloud API de Meta
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;      // ID del número de WhatsApp (de Meta)
const ANTHROPIC_KEY  = process.env.ANTHROPIC_API_KEY;     // API key de Claude
const SKOOL_LINK     = 'https://www.skool.com/newave/plans';

// El cerebro (system prompt). Busca el archivo en varias rutas posibles
// según cómo se despliegue (carpeta whatsapp-bot o raíz del proyecto).
function cargarCerebro() {
  const rutas = [
    path.join(process.cwd(), 'system-prompt.md'),
    path.join(process.cwd(), 'whatsapp-bot', 'system-prompt.md'),
    path.join(__dirname, '..', 'system-prompt.md'),
  ];
  for (const r of rutas) {
    try { return fs.readFileSync(r, 'utf8'); } catch (e) { /* siguiente */ }
  }
  throw new Error('No se encontró system-prompt.md');
}
const SYSTEM_PROMPT = cargarCerebro();

// Memoria de conversación en memoria (por número). Para producción real se
// recomienda una DB, pero esto funciona para arrancar y validar.
const conversations = {};
const MAX_TURNS = 12; // cuántos mensajes recordar por persona

// ─── HANDLER PRINCIPAL ───────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  // 1) Verificación del webhook (Meta lo llama una vez al configurar)
  if (req.method === 'GET') {
    const mode      = req.query['hub.mode'];
    const token     = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send('Forbidden');
  }

  // 2) Mensaje entrante de WhatsApp
  if (req.method === 'POST') {
    try {
      const entry   = req.body?.entry?.[0];
      const change  = entry?.changes?.[0];
      const message = change?.value?.messages?.[0];

      // Si no es un mensaje de texto (status, etc.), ignora
      if (!message || message.type !== 'text') {
        return res.status(200).send('ok');
      }

      const from = message.from;              // número del usuario
      const text = message.text.body;          // lo que escribió
      const name = change.value?.contacts?.[0]?.profile?.name || '';

      const reply = await generarRespuesta(from, text, name);
      await enviarWhatsApp(from, reply);

      return res.status(200).send('ok');
    } catch (err) {
      console.error('Error procesando mensaje:', err);
      return res.status(200).send('ok'); // siempre 200 para que Meta no reintente en loop
    }
  }

  return res.status(405).send('Method not allowed');
};

// ─── GENERAR RESPUESTA CON CLAUDE ──────────────────────────────────────────
async function generarRespuesta(from, text, name) {
  // Recupera o crea el historial de esta persona
  if (!conversations[from]) conversations[from] = [];
  const history = conversations[from];

  // Agrega el mensaje del usuario
  history.push({ role: 'user', content: text });

  // Limita el historial para no gastar de más
  const trimmed = history.slice(-MAX_TURNS);

  const systemFull = SYSTEM_PROMPT +
    (name ? `\n\nEl nombre de esta persona es: ${name}. Úsalo con naturalidad.` : '') +
    `\n\nLink para empezar el trial: ${SKOOL_LINK}`;

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 500,
      system: systemFull,
      messages: trimmed,
    }),
  });

  const data = await resp.json();
  const reply = data?.content?.[0]?.text?.trim()
    || 'Perdón, tuve un problemita. ¿Me lo repites? 🙏';

  // Guarda la respuesta del bot en el historial
  history.push({ role: 'assistant', content: reply });

  return reply;
}

// ─── ENVIAR MENSAJE POR WHATSAPP ───────────────────────────────────────────
async function enviarWhatsApp(to, body) {
  await fetch(`https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: to,
      type: 'text',
      text: { body: body },
    }),
  });
}
