// Newave — WhatsApp AI Bot (Vercel Function)
// Recibe mensajes de WhatsApp (Meta Cloud API), los pasa a Claude con el
// cerebro de Newave, y responde automáticamente por WhatsApp.

const fs = require('fs');
const path = require('path');
const { guardarMensaje, obtenerConversacion, obtenerLead, intentarLockConversacion, liberarLockConversacion } = require('./db');

// ─── CONFIG (todo vive en variables de entorno de Vercel, NO en el código) ───
const VERIFY_TOKEN   = process.env.VERIFY_TOKEN;          // el que tú inventes para verificar el webhook
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;        // token de la Cloud API de Meta
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;      // ID del número de WhatsApp (de Meta)
const ANTHROPIC_KEY  = process.env.ANTHROPIC_API_KEY;     // API key de Claude

// Interruptor del bot. En true, el webhook guarda los mensajes pero no
// contesta. Se apagó el 30 ago 2026 porque la llamada a Claude fallaba y
// todos recibían el mensaje de error.
const BOT_APAGADO = true;
const SKOOL_LINK     = 'https://www.skool.com/newave/plans';

// El cerebro (system prompt). Busca el archivo en varias rutas posibles
// según cómo se despliegue (carpeta whatsapp-bot o raíz del proyecto).
// Si no lo encuentra, usa un prompt mínimo de emergencia en vez de tumbar
// toda la función — sin esto, un solo archivo faltante dejaba el bot
// 100% inoperante (ni siquiera respondía la verificación del webhook).
function cargarCerebro() {
  const rutas = [
    path.join(process.cwd(), 'system-prompt.md'),
    path.join(process.cwd(), 'whatsapp-bot', 'system-prompt.md'),
    path.join(__dirname, '..', 'system-prompt.md'),
  ];
  for (const r of rutas) {
    try { return fs.readFileSync(r, 'utf8'); } catch (e) { /* siguiente */ }
  }
  console.error('[cargarCerebro] No se encontró system-prompt.md, usando prompt de emergencia');
  return 'Eres el asistente de Newave Academy por WhatsApp. Responde con calidez y honestidad, invitando a probar el programa gratis 7 días. Si no sabes algo específico, dilo con honestidad.';
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

      // BOT APAGADO (30 ago 2026). Estaba contestando "Perdón, tuve un
      // problemita" a todos: la llamada a Claude fallaba y caía al mensaje de
      // error en cada conversación. Peor que no contestar, porque la persona
      // escribe con una duda y recibe eso.
      //
      // Los mensajes se siguen guardando para no perder el historial ni el
      // contexto de quien escribió. Para reactivarlo: quitar este bloque
      // después de verificar que la API responde.
      if (BOT_APAGADO) {
        console.log(`[bot apagado] mensaje de ${from} guardado sin responder`);
        await guardarMensaje(from, name, 'user', text)
          .catch(err => console.error('[DB] Error guardando mensaje:', err));
        return res.status(200).send('ok');
      }

      // Un solo mensaje a la vez por conversación. Si la persona manda dos
      // seguidos rápido, la segunda invocación no contesta: guarda el mensaje
      // para que quede en el historial y deja que la primera responda a todo
      // junto. Sin esto el bot contesta dos veces sin verse a sí mismo.
      const tengoElLock = await intentarLockConversacion(from);
      if (!tengoElLock) {
        console.log(`[lock] ${from} ya tiene una respuesta en curso, solo se guarda el mensaje`);
        await guardarMensaje(from, name, 'user', text)
          .catch(err => console.error('[DB] Error guardando mensaje en paralelo:', err));
        return res.status(200).send('ok');
      }

      try {
        const reply = await generarRespuesta(from, text, name);
        await esperarComoHumano(reply);
        await enviarWhatsApp(from, reply);
      } finally {
        await liberarLockConversacion(from);
      }

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
    await contextoDelLead(from) +
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
      // 1200 y no 800: con 800 se truncaron respuestas reales a media frase.
      // No hace que los mensajes sean más largos (de eso se encarga el
      // prompt, que pide mensajes de 1-3 líneas), solo evita el corte cuando
      // alguien manda varias preguntas juntas y la respuesta legítima crece.
      max_tokens: 1200,
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

  let reply = textBlock?.text?.trim()
    || 'Perdón, tuve un problemita. ¿Me lo repites? 🙏';

  // Respuesta cortada a media frase por el límite de tokens. Pasó dos veces
  // en producción y las dos se cortaron JUSTO antes del link ("...los 7 días
  // son gratis, puedes entrar y"). Una de esas personas nunca volvió a
  // escribir: el mensaje incompleto mata la conversación.
  //
  // Se recorta a la última frase completa y, si el modelo ya venía hablando
  // del trial, se cierra con el link para no dejarla sin siguiente paso.
  if (data?.stop_reason === 'max_tokens') {
    console.error('[Claude] Respuesta truncada por max_tokens. Original:', reply);
    reply = recortarAFraseCompleta(reply);
    if (!reply.includes(SKOOL_LINK)) {
      reply += `\n\nAquí puedes entrar a los 7 días gratis: ${SKOOL_LINK}`;
    }
  }

  // Guarda la respuesta del bot en el historial
  history.push({ role: 'assistant', content: reply });
  guardarMensaje(from, name, 'assistant', reply).catch(err => console.error('[DB] Error guardando mensaje assistant:', err));

  return reply;
}

// Corta el texto en la última frase que quedó completa. Si no encuentra
// ningún cierre de frase, devuelve el original: es mejor mandar algo cortado
// que mandar vacío.
function recortarAFraseCompleta(texto) {
  const cierres = ['. ', '! ', '? ', '.\n', '!\n', '?\n'];
  let corte = -1;
  for (const c of cierres) {
    corte = Math.max(corte, texto.lastIndexOf(c));
  }
  // También considera el caso de que termine justo en el signo, sin espacio
  const ultimoChar = texto.trimEnd().slice(-1);
  if ('.!?'.includes(ultimoChar)) return texto.trimEnd();

  if (corte === -1) return texto;
  return texto.slice(0, corte + 1).trim();
}

// Lo que la persona escribió en el formulario, para que el bot no pregunte
// de cero algo que ya contestó. Se le pasa a Claude como contexto de fondo,
// NO como un guion que deba recitar (ver instrucciones abajo).
async function contextoDelLead(from) {
  let lead;
  try {
    lead = await obtenerLead(from);
  } catch (err) {
    console.error('[contextoDelLead] Error:', err);
    return ''; // sin contexto el bot sigue funcionando igual que antes
  }

  if (!lead) return '';

  const campos = [
    lead.trabajo    && `A qué se dedica: ${lead.trabajo}`,
    lead.razon      && `Por qué busca trabajo remoto: ${lead.razon}`,
    lead.ingles     && `Nivel de inglés: ${lead.ingles}`,
    lead.compromiso && `Qué tan listo está para empezar: ${lead.compromiso}`,
  ].filter(Boolean);

  if (!campos.length) return '';

  return `

CONTEXTO PRIVADO (lo que esta persona escribió en el formulario, hace días o semanas):
${campos.join('\n')}

Cómo usar esto — importante:
- Es para que ENTIENDAS su situación, no para recitárselo. NUNCA le digas "vi que escribiste que...", "según tu formulario...", "tengo aquí que...", "déjame ver...", ni le repitas sus propias palabras de vuelta. Suena a expediente abierto y espanta.
- NUNCA digas "por lo que me dijiste antes" ni "como me contaste" refiriéndote a esto. La persona NO te lo dijo a ti, lo escribió en un formulario hace días. Tratarlo como si fuera algo que platicaron se siente falso.
- Úsalo para hacer mejores preguntas y para aterrizar tus respuestas a SU caso. Si dice que busca un segundo ingreso, hablas de eso. Si la corrieron, hablas de estabilidad.
- Si vas a tocar el tema, hazlo ligero y en forma de confirmación, no de lectura de ficha. Bien: "Ah va, tú eres el de ventas en Pepsico no?". Mal: "Déjame ver, tengo aquí que estás en ventas, gerente en Pepsico".
- Y solo tráelo a colación si viene al caso en ese momento. Si la persona está preguntando precios o cómo funciona el pago, soltarle de la nada "oye, tú sigues en tal empresa?" la desvía y se siente a que le revisaste el expediente. Mejor úsalo en silencio, para aterrizar tus respuestas a su perfil sin mencionarlo.
- Mejor todavía: pregúntalo como si no lo supieras, con curiosidad genuina ("y cómo te va en eso?", "qué te hizo buscar algo remoto?"). Deja que te lo cuente ella.
- Puede haber cambiado: llenó el formulario hace tiempo y su situación pudo ser otra. Si lo que te dice ahora contradice esto, créele a lo que te dice ahora.
- El objetivo es que sienta que le pones atención, no que la estás vigilando.`;
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

  try {
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
  } catch (err) {
    console.error('[enviarWhatsApp] ERROR de red:', err);
  }
}
