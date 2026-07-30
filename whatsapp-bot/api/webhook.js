// Newave — WhatsApp AI Bot (Vercel Function)
// Recibe mensajes de WhatsApp (Meta Cloud API), los pasa a Claude con el
// cerebro de Newave, y responde automáticamente por WhatsApp.

const fs = require('fs');
const path = require('path');
const { guardarMensaje, obtenerConversacion } = require('./db');

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

      // Sin mensaje real (es un status: "leído", "entregado", etc.), ignora
      if (!message) {
        return res.status(200).send('ok');
      }

      const from = normalizarNumeroMx(message.from);
      const name = change.value?.contacts?.[0]?.profile?.name || '';

      // No podemos procesar audio/imagen/etc. — avisamos en vez de quedarnos callados
      if (message.type !== 'text') {
        await marcarComoLeido(message.id);
        const avisoNoTexto = mensajeParaTipoNoSoportado(message.type);
        await enviarWhatsApp(from, avisoNoTexto);
        return res.status(200).send('ok');
      }

      const text = message.text.body;

      // Marca como leído y muestra "escribiendo..." mientras se genera la respuesta
      await marcarComoLeido(message.id);

      const reply = await generarRespuesta(from, text, name);
      await esperarComoHumano(reply);
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
  // Recupera o crea el historial de esta persona. La memoria en RAM se
  // pierde cada vez que Vercel reinicia la función (cold start), así que si
  // no hay nada en memoria pero sí hubo conversación antes, la reconstruimos
  // desde Postgres para no re-saludar a alguien a medio de una conversación.
  if (!conversations[from]) {
    conversations[from] = await recuperarHistorialDeDb(from);
  }
  const history = conversations[from];

  // Agrega el mensaje del usuario
  history.push({ role: 'user', content: text });
  guardarMensaje(from, name, 'user', text).catch(err => console.error('[DB] Error guardando mensaje user:', err));

  // Limita el historial para no gastar de más
  const trimmed = history.slice(-MAX_TURNS);

  const nombreUsable = esNombreReal(name) ? name.trim().split(/\s+/)[0] : null;
  const systemFull = SYSTEM_PROMPT +
    (nombreUsable ? `\n\nEl nombre de esta persona es: ${nombreUsable}. Úsalo con naturalidad y con moderación (no en cada mensaje, no en cada saludo si ya la saludaste antes en esta conversación) — nunca uses el apellido, solo el primer nombre.` : '\n\nNo uses ningún nombre para dirigirte a esta persona (el que tenemos guardado son iniciales o no es un nombre real) — salúdala sin nombre, ej. "¡Hola! ¿Qué duda tienes?" en vez de "¡Hola X!".') +
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
      max_tokens: 800,
      system: systemFull,
      messages: trimmed,
    }),
  });

  const data = await resp.json();

  if (!resp.ok) {
    console.error('[Claude] ERROR', resp.status, JSON.stringify(data));
  }

  // El modelo a veces manda un bloque "thinking" antes del bloque "text"
  // (extended thinking). Buscamos el bloque de texto real, no asumimos [0].
  const textBlock = Array.isArray(data?.content)
    ? data.content.find(block => block.type === 'text')
    : null;

  if (resp.ok && !textBlock) {
    console.error('[Claude] Respuesta sin bloque de texto:', JSON.stringify(data));
  }

  const reply = textBlock?.text?.trim()
    || 'Perdón, tuve un problemita. ¿Me lo repites? 🙏';

  // Guarda la respuesta del bot en el historial
  history.push({ role: 'assistant', content: reply });
  guardarMensaje(from, name, 'assistant', reply).catch(err => console.error('[DB] Error guardando mensaje assistant:', err));

  return reply;
}

// Reconstruye el historial de esta persona desde Postgres cuando la
// instancia serverless arranca en frío y perdió la memoria en RAM.
async function recuperarHistorialDeDb(from) {
  try {
    const filas = await obtenerConversacion(from);
    return filas
      .slice(-MAX_TURNS)
      .map(fila => ({ role: fila.rol, content: fila.contenido }));
  } catch (err) {
    console.error('[recuperarHistorialDeDb] Error:', err);
    return [];
  }
}

// El "nombre" que manda WhatsApp a veces son iniciales (ej. "DF", "SSW")
// en vez de un nombre real — usar eso como saludo suena raro/impersonal.
// Heurística: nombres reales tienen vocales y normalmente más de 3-4
// letras por palabra; las iniciales son cortas, todo mayúsculas, sin vocal
// suficiente para ser una palabra pronunciable.
function esNombreReal(name) {
  if (!name) return false;
  const limpio = name.trim();
  if (!limpio) return false;

  const primeraPalabra = limpio.split(/\s+/)[0];

  // Todo mayúsculas y 4 letras o menos: casi siempre iniciales (DF, SSW, FDR)
  if (primeraPalabra.length <= 4 && primeraPalabra === primeraPalabra.toUpperCase() && /^[A-ZÁÉÍÓÚÑ]+$/.test(primeraPalabra)) {
    return false;
  }

  // Sin ninguna vocal: no es una palabra pronunciable como nombre
  if (!/[aeiouáéíóúAEIOUÁÉÍÓÚ]/.test(primeraPalabra)) {
    return false;
  }

  return true;
}

// El bot todavía no puede "escuchar" audios ni "ver" imágenes — en vez de
// quedarse callado (lo cual parece que está roto), avisa qué sí puede leer.
function mensajeParaTipoNoSoportado(tipo) {
  if (tipo === 'audio') {
    return 'Por ahora no puedo escuchar notas de voz, ¿me lo escribes por texto? 🙏';
  }
  if (tipo === 'image' || tipo === 'sticker') {
    return 'Por ahora no puedo ver imágenes, ¿me lo escribes por texto? 🙏';
  }
  return 'Por ahora solo puedo leer mensajes de texto, ¿me lo escribes así? 🙏';
}

// WhatsApp a veces manda números mexicanos con un "1" extra después del 52
// (ej. 5215541454466), pero la API para ENVIAR espera sin ese "1"
// (5541454466... con 52). Lo quitamos si detectamos ese patrón.
function normalizarNumeroMx(numero) {
  if (numero && numero.startsWith('521') && numero.length === 13) {
    return '52' + numero.slice(3);
  }
  return numero;
}

// ─── MARCAR COMO LEÍDO + MOSTRAR "ESCRIBIENDO..." ──────────────────────────
async function marcarComoLeido(messageId) {
  try {
    const resp = await fetch(`https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
        typing_indicator: { type: 'text' },
      }),
    });
    if (!resp.ok) {
      console.error('[marcarComoLeido] ERROR', resp.status, JSON.stringify(await resp.json().catch(() => ({}))));
    }
  } catch (err) {
    console.error('[marcarComoLeido] ERROR', err);
  }
}

// Simula el tiempo que tardaría una persona en escribir la respuesta.
// Un humano no contesta un mensaje largo en medio segundo.
async function esperarComoHumano(texto) {
  const base = 1200; // arranque mínimo, siempre hay algo de pausa
  const porCaracter = 20; // ms extra por cada caracter del mensaje
  const maximo = 6000; // nunca más de 6s, no queremos que se sienta lento
  const delay = Math.min(base + texto.length * porCaracter, maximo);
  await new Promise(resolve => setTimeout(resolve, delay));
}

// ─── ENVIAR MENSAJE POR WHATSAPP ───────────────────────────────────────────
async function enviarWhatsApp(to, body) {
  console.log('[enviarWhatsApp] to=', JSON.stringify(to), 'PHONE_NUMBER_ID=', PHONE_NUMBER_ID);

  const resp = await fetch(`https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`, {
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

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    console.error('[enviarWhatsApp] ERROR', resp.status, JSON.stringify(data));
  } else {
    console.log('[enviarWhatsApp] OK', JSON.stringify(data));
  }
}
