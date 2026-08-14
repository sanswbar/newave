// Conversions API de Meta — envío server-side del evento CompleteRegistration.
//
// POR QUÉ EXISTE: el pixel de navegador solo captura ~20% de las conversiones
// reales (11 ago: 8 eventos vs 29 leads; 12 ago: 4 vs 19). Se pierde por
// bloqueadores, iOS/ATT y el webview de Instagram, de donde viene casi todo el
// tráfico. Meta estaba optimizando las campañas de frío con una quinta parte
// de la señal.
//
// Esto NO reemplaza al pixel de navegador: los dos mandan el mismo evento y
// Meta los deduplica por event_id. El de navegador sigue siendo útil cuando sí
// pasa; este cubre los casos en que el navegador no puede.
//
// DEDUPLICACIÓN — lo crítico: el cliente genera un event_id único por submit y
// lo manda en las dos vías (fbq y aquí). Meta empareja por (event_id,
// event_name) y cuenta una sola conversión. Si el event_id no coincide, las
// métricas se inflan al doble y las campañas optimizan sobre datos falsos.

const PIXEL_ID = '2100703077340387'; // Newave Landing Pixel
const API_VERSION = 'v21.0';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = process.env.META_CAPI_TOKEN;
  if (!token) {
    // Sin token configurado no es un error del lead: se responde ok para que
    // el cliente nunca vea un fallo por algo que es de configuración nuestra.
    console.error('meta-capi: falta META_CAPI_TOKEN en las variables de entorno');
    return res.status(200).json({ ok: false, reason: 'not_configured' });
  }

  try {
    const {
      event_id,
      event_name = 'CompleteRegistration',
      event_source_url,
      em,           // email ya hasheado en el cliente (SHA-256 hex)
      ph,           // teléfono ya hasheado en el cliente (SHA-256 hex)
      fbc,          // cookie _fbc: click id de Meta, sube mucho el match
      fbp,          // cookie _fbp: browser id de Meta
      content_name,
      status,
    } = req.body || {};

    if (!event_id) {
      return res.status(400).json({ error: 'event_id requerido para deduplicar' });
    }

    // El servidor sí ve la IP y el user agent reales. El navegador no puede
    // mandarlos de forma confiable y son de las señales que más suben el
    // Event Match Quality.
    const ip =
      (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
      req.headers['x-real-ip'] ||
      undefined;
    const userAgent = req.headers['user-agent'] || undefined;

    const userData = {};
    if (em) userData.em = [em];
    if (ph) userData.ph = [ph];
    if (fbc) userData.fbc = fbc;
    if (fbp) userData.fbp = fbp;
    if (ip) userData.client_ip_address = ip;
    if (userAgent) userData.client_user_agent = userAgent;

    const payload = {
      data: [
        {
          event_name,
          event_time: Math.floor(Date.now() / 1000),
          event_id,                        // <- la llave de la deduplicación
          event_source_url,
          action_source: 'website',
          user_data: userData,
          custom_data: {
            content_name: content_name || 'Formulario Newave',
            status: status === true || status === 'true',
          },
        },
      ],
    };

    const url = `https://graph.facebook.com/${API_VERSION}/${PIXEL_ID}/events?access_token=${encodeURIComponent(token)}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await resp.json();

    if (!resp.ok) {
      console.error('meta-capi: Meta respondió ' + resp.status, JSON.stringify(data));
      return res.status(200).json({ ok: false, meta: data });
    }

    return res.status(200).json({ ok: true, events_received: data.events_received });
  } catch (err) {
    // Nunca devolver error al cliente: un fallo aquí no debe traducirse en
    // nada visible ni en un reintento que retrase la navegación a Skool.
    console.error('meta-capi falló:', err);
    return res.status(200).json({ ok: false, reason: 'exception' });
  }
}
