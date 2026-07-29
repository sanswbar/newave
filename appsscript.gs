 // Newave Nuevo Formulario — Google Apps Script

const SHEET_ID   = '10J5chMWPrFFzIYEkjc36HMDJ1H-_q5Q2IsE7srnv1MA';
const SHEET_NAME = 'Registros';

const SKOOL_URL        = 'https://www.skool.com/newave';
const COMUNIDAD_URL    = 'https://www.newaveacademy.com/#comunidad';
const FROM_NAME        = 'Newave Academy';
const FROM_EMAIL       = 'hello@nwave.co';
const WA_LINK          = 'https://wa.me/525573906923?text=Hola%2C%20llen%C3%A9%20el%20formulario%20y%20tengo%20una%20duda';

// Column indices (1-based) — must match sheet headers
const COL_FECHA      = 1;
const COL_NOMBRE     = 2;
const COL_CORREO     = 3;
const COL_ESTATUS    = 12; // Column L
const COL_CLICK      = 13; // Column M — "Click a plan"

// Email sequence delays (ms after signup)
const EMAIL_DELAYS = {
  1: 2 * 60 * 1000,            // 2 min
  2: 24 * 60 * 60 * 1000,      // 24 h
  3: 2 * 24 * 60 * 60 * 1000,  // 2 días
  4: 4 * 24 * 60 * 60 * 1000,  // 4 días
  5: 6 * 24 * 60 * 60 * 1000,  // 6 días
};

// Máximo de correos por corrida (cada 5 min). Reparte los envíos en vez de
// mandarlos de golpe: más suave para la cuota diaria y para los filtros de Gmail.
const MAX_POR_CORRIDA = 10;

// Delay before sending the WhatsApp welcome template (ms after signup)
const WHATSAPP_DELAY = 2 * 60 * 1000; // 2 min, same as email 1

// WhatsApp Cloud API config — token y phone number id viven en Script
// Properties (Project Settings > Script Properties), no aquí en el código:
//   WA_TOKEN            = token permanente del System User
//   WA_PHONE_NUMBER_ID  = Phone Number ID de producción
const WA_TEMPLATE_NAME = 'nw_bienvenida_lead_v2';
const WA_TEMPLATE_LANG = 'es_MX';

// ─── FORM SUBMISSION ──────────────────────────────────────────────────────

function doGet(e) {
  try {
    // Registro de click en el CTA final — no crea lead nuevo
    if (e.parameter.action === 'click') {
      registrarClick(e.parameter.correo || '');
      return ContentService
        .createTextOutput(JSON.stringify({ status: 'ok', click: true }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const track = e.parameter.track || '';
    const sheet = getSheet(SHEET_NAME);

    const nombre   = e.parameter.nombre   || '';
    const correo   = e.parameter.correo   || '';
    const whatsapp = e.parameter.whatsapp || '';

    const row = [
      new Date(),
      nombre,
      correo,
      e.parameter.whatsapp   || '',
      "'" + (e.parameter.linkedin || ''),
      e.parameter.ingles     || '',
      e.parameter.trabajo    || '',
      e.parameter.razon      || '',
      e.parameter.compromiso || '',
      e.parameter.inversion  || '',
      track,
      'Registrado',
    ];
    sheet.appendRow(row);

    const lastRow = sheet.getLastRow();
    const compromiso = e.parameter.compromiso || '';
    // No gastar cuota de Gmail en quien de entrada dijo que solo está
    // buscando, aún no listo — se manda solo a los dos niveles de mayor
    // interés real.
    if (compromiso !== 'Buscando, no listo aun') {
      queueSequence(nombre, correo, lastRow);
    }
    queueWhatsapp(nombre, whatsapp, lastRow);
    ensureProcessorTrigger();

    return ContentService
      .createTextOutput(JSON.stringify({ status: 'ok' }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function registrarClick(correo) {
  const sheet = getSheet(SHEET_NAME);
  const row = buscarFilaPorCorreo(sheet, correo);
  if (row) sheet.getRange(row, COL_CLICK).setValue('Sí');
}

// ─── QUEUE + SINGLE RECURRING TRIGGER ─────────────────────────────────────

function queueSequence(nombre, correo, rowNumber) {
  const props = PropertiesService.getScriptProperties();
  const now   = Date.now();

  for (let n = 1; n <= 5; n++) {
    const key  = 'seq_' + rowNumber + '_' + n;
    const data = JSON.stringify({
      emailNum: n,
      nombre:   nombre,
      correo:   correo,
      row:      rowNumber,
      dueAt:    now + EMAIL_DELAYS[n],
    });
    props.setProperty(key, data);
  }
}

// Queue the WhatsApp welcome template for this lead, if they gave a number.
function queueWhatsapp(nombre, whatsapp, rowNumber) {
  if (!whatsapp) return; // no number given, nothing to send

  const props = PropertiesService.getScriptProperties();
  const key   = 'wa_' + rowNumber;
  const data  = JSON.stringify({
    nombre:   nombre,
    whatsapp: whatsapp,
    row:      rowNumber,
    dueAt:    Date.now() + WHATSAPP_DELAY,
  });
  props.setProperty(key, data);
}

function ensureProcessorTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  for (const t of triggers) {
    if (t.getHandlerFunction() === 'processQueue') return;
  }
  ScriptApp.newTrigger('processQueue')
    .timeBased()
    .everyMinutes(5)
    .create();
}

// Encuentra la fila actual de un lead por su correo (el más reciente).
// Se busca por correo, no por índice, para que borrar filas nunca desincronice.
function buscarFilaPorCorreo(sheet, correo) {
  if (!correo) return 0;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;

  const correos = sheet.getRange(1, COL_CORREO, lastRow, 1).getValues();
  const target = correo.trim().toLowerCase();

  for (let i = correos.length - 1; i >= 1; i--) {
    if (correos[i][0].toString().trim().toLowerCase() === target) {
      return i + 1;
    }
  }
  return 0;
}

// Corre cada 5 min: manda los correos vencidos, con tope por corrida y
// reintento automático si Gmail se queda sin cuota. También procesa la
// cola de WhatsApp (plantilla de bienvenida para leads nuevos).
function processQueue() {
  const props = PropertiesService.getScriptProperties();
  const sheet = getSheet(SHEET_NAME);
  const allProps = props.getProperties();
  const now = Date.now();

  const senders = {
    1: sendEmail1, 2: sendEmail2, 3: sendEmail3, 4: sendEmail4, 5: sendEmail5,
  };

  let enviados = 0;

  // Sin cuota de Gmail, se salta el bloque de correos pero el de WhatsApp
  // sigue corriendo abajo — no dependen del mismo límite.
  const sinCuotaGmail = MailApp.getRemainingDailyQuota() <= 0;

  for (const key in allProps) {
    if (sinCuotaGmail) break;
    if (key.indexOf('seq_') !== 0) continue;
    if (enviados >= MAX_POR_CORRIDA) break; // throttle: rest waits for next run

    const data = JSON.parse(allProps[key]);
    if (now < data.dueAt) continue; // not due yet

    const row = buscarFilaPorCorreo(sheet, data.correo);

    // Email 1 always sends; 2-5 skip if the lead already started trial or paid
    const skip = (data.emailNum !== 1) && row && isTrialOrPaid(sheet, row);

    if (skip || !data.correo) {
      props.deleteProperty(key);
      continue;
    }

    try {
      senders[data.emailNum](data.nombre, data.correo);
      if (row) sheet.getRange(row, COL_ESTATUS).setValue('Correo enviado: email ' + data.emailNum);
      enviados++;
      props.deleteProperty(key);
    } catch (err) {
      const msg = err.message || '';
      if (msg.indexOf('too many times') !== -1 || msg.indexOf('Límite') !== -1) {
        if (row) sheet.getRange(row, COL_ESTATUS).setValue('En espera (límite diario)');
        break; // se acabó la cuota de Gmail — el bloque de WhatsApp sigue abajo
      }
      if (row) sheet.getRange(row, COL_ESTATUS).setValue('Error correo ' + data.emailNum + ': ' + msg);
      props.deleteProperty(key);
    }
  }

  for (const key in allProps) {
    if (key.indexOf('wa_') !== 0) continue;

    const data = JSON.parse(allProps[key]);
    Logger.log('[WA queue] ' + key + ' dueAt=' + data.dueAt + ' now=' + now + ' pendiente=' + (now < data.dueAt));
    if (now < data.dueAt) continue; // not due yet

    try {
      enviarPlantillaWhatsapp(data.nombre, data.whatsapp);
      if (data.row) agregarEstatus(sheet, data.row, 'WhatsApp enviado');
      Logger.log('[WA queue] enviado OK a fila ' + data.row);
    } catch (err) {
      Logger.log('[WA queue] ERROR: ' + (err.message || err));
      if (data.row) agregarEstatus(sheet, data.row, 'Error WhatsApp: ' + (err.message || err));
    }
    props.deleteProperty(key);
  }
}

// Appends a note to the Estatus cell instead of overwriting it, so the
// email-sequence status and the WhatsApp status don't clobber each other.
function agregarEstatus(sheet, row, nota) {
  const cell = sheet.getRange(row, COL_ESTATUS);
  const actual = cell.getValue().toString().trim();
  cell.setValue(actual ? actual + ' | ' + nota : nota);
}

// ─── WHATSAPP (Cloud API) ─────────────────────────────────────────────────

// Sends the approved "nw_bienvenida_lead" template to a new lead.
// La plantilla no tiene variables, así que el payload no lleva parameters.
function enviarPlantillaWhatsapp(nombre, whatsapp) {
  const props = PropertiesService.getScriptProperties();
  const token         = props.getProperty('WA_TOKEN');
  const phoneNumberId = props.getProperty('WA_PHONE_NUMBER_ID');
  if (!token || !phoneNumberId) throw new Error('Faltan WA_TOKEN / WA_PHONE_NUMBER_ID en Script Properties');

  const to = normalizarNumero(whatsapp);

  const payload = {
    messaging_product: 'whatsapp',
    to: to,
    type: 'template',
    template: {
      name: WA_TEMPLATE_NAME,
      language: { code: WA_TEMPLATE_LANG },
    },
  };

  const resp = UrlFetchApp.fetch(
    'https://graph.facebook.com/v21.0/' + phoneNumberId + '/messages',
    {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    }
  );

  const code = resp.getResponseCode();
  if (code >= 300) throw new Error('WhatsApp API ' + code + ': ' + resp.getContentText());
}

// Strips non-digit characters and ensures the Mexico country code (52) is present.
function normalizarNumero(numero) {
  let digits = numero.toString().replace(/\D/g, '');
  if (digits.length === 10) digits = '52' + digits; // bare 10-digit MX number
  return digits;
}

function isTrialOrPaid(sheet, rowNumber) {
  const estatus = sheet.getRange(rowNumber, COL_ESTATUS).getValue().toString().toLowerCase();
  return estatus.includes('pago') || estatus.includes('trial');
}

// ─── EMAIL 1 — 2 minutos ──────────────────────────────────────────────────

function sendEmail1(nombre, correo) {
  const firstName = nombre.split(' ')[0] || 'hola';
  const subject = 'Llenaste nuestro formulario. Te queremos en Newave Academy.';
  const utmUrl1 = SKOOL_URL + '?utm_source=email&utm_medium=registro&utm_campaign=email1';

  const html = `
<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#222222;">
  <p style="margin:0 0 16px">Hola ${firstName},</p>
  <p style="margin:0 0 16px">Te escribe Santiago, cofundador de Newave Academy.</p>
  <p style="margin:0 0 16px">Vimos que llenaste nuestro formulario porque te interesa conseguir un trabajo remoto. No sé qué te frenó para unirte, pero te invitamos a probar Newave gratis durante 7 días, sin pagar nada si no te convence.</p>
  <p style="margin:0 0 16px">Funciona para cualquier perfil profesional, no solo tech: marketing, ventas, diseño, finanzas, operaciones, hospitalidad y más. Dentro tienes el curso completo, plantillas de CV/LinkedIn, comunidad privada, herramientas de AI y bolsa de trabajo con vacantes 100% remotas.</p>
  <p style="margin:0 0 16px">Entra aquí: <a href="${utmUrl1}">Newave Academy</a></p>
  <p style="margin:0 0 16px">Cualquier duda, puedes escribirnos por WhatsApp: <a href="${WA_LINK}">wa.me/525573906923</a></p>
  <p style="margin:0 0 16px">Nos vemos dentro.</p>
  <p style="margin:0">Santiago<br><strong>Co-Founder</strong><br><em>NEWAVE</em></p>
</div>`;

  GmailApp.sendEmail(correo, subject, '', { name: FROM_NAME, replyTo: FROM_EMAIL, htmlBody: html });
}

// ─── EMAIL 2 — 24 horas ───────────────────────────────────────────────────

function sendEmail2(nombre, correo) {
  const firstName = nombre.split(' ')[0] || 'hola';
  const subject = 'Te estamos esperando';
  const utmUrl2 = SKOOL_URL + '?utm_source=email&utm_medium=followup&utm_campaign=email2';
  const utmComunidad = 'https://www.newaveacademy.com/?utm_source=email&utm_medium=followup&utm_campaign=email2#comunidad';

  const html = `
<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#222222;">
  <p>Hola ${firstName},</p>
  <p>Ayer llenaste el formulario. No quiero que se te pase.</p>
  <p>Las personas que están dentro hoy tenían las mismas dudas que tú. La diferencia es que entraron.</p>
  <p style="border-left:2px solid #d0d0d0;padding-left:14px;color:#555555;">"Mis mejores entrevistas y procesos fueron gracias a que me uní a esta comunidad. Sí funciona."<br>— Rebeca Cruz, consiguió oferta en Stripe</p>
  <p>Si quieres ver más historias: <a href="${utmComunidad}">Historias de egresados</a></p>
  <p>7 días gratis. Entra aquí: <a href="${utmUrl2}">Newave Academy</a></p>
  <p>Cualquier duda, puedes escribirnos por WhatsApp: <a href="${WA_LINK}">wa.me/525573906923</a></p>
  <p>Nos vemos dentro.</p>
  <p>Santiago<br><strong>Co-Founder</strong><br><em>NEWAVE</em></p>
</div>`;

  GmailApp.sendEmail(correo, subject, '', { name: FROM_NAME, replyTo: FROM_EMAIL, htmlBody: html });
}

// ─── EMAIL 3 — 2 días (caso de éxito) ─────────────────────────────────────

function sendEmail3(nombre, correo) {
  const firstName = nombre.split(' ')[0] || 'hola';
  const subject = 'Quedó en una empresa de tech en 2 meses';
  const utmUrl3 = SKOOL_URL + '?utm_source=email&utm_medium=followup&utm_campaign=email3';

  const html = `
<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#222222;">
  <p>Hola ${firstName},</p>
  <p>Hace unos días llenaste el formulario. Quiero contarte algo que pasó dentro de Newave.</p>
  <p>Uno de nuestros miembros llevaba alrededor de dos meses aplicando. Hace poco quedó en una posición de ADR en Samsara, una empresa de tech.</p>
  <p style="border-left:2px solid #d0d0d0;padding-left:14px;color:#555555;">"De lo más valioso en mi proceso fue lograr una creación espectacular de mi currículum gracias a los videos y el acompañamiento. En el flujo de entrevistas llegué con el CCO de México y lo primero que me dijo fue: 'estoy viendo tu currículum y definitivamente tienes una gran habilidad de comunicar, tengo muy claro todos tus logros'. Eso fue oro para mí."</p>
  <p>Fíjate en el detalle: no fue suerte. Fue tener un CV que comunica tus logros en el lenguaje correcto. Eso es lo que te enseñamos a construir.</p>
  <p>Pruébalo gratis 7 días: <a href="${utmUrl3}">Newave Academy</a></p>
  <p>Cualquier duda, puedes escribirnos por WhatsApp: <a href="${WA_LINK}">wa.me/525573906923</a></p>
  <p>Nos vemos dentro.</p>
  <p>Santiago<br><strong>Co-Founder</strong><br><em>NEWAVE</em></p>
</div>`;

  GmailApp.sendEmail(correo, subject, '', { name: FROM_NAME, replyTo: FROM_EMAIL, htmlBody: html });
}

// ─── EMAIL 4 — 4 días ─────────────────────────────────────────────────────

function sendEmail4(nombre, correo) {
  const firstName = nombre.split(' ')[0] || 'hola';
  const subject = 'Solo necesitas una semana';
  const utmUrl4 = SKOOL_URL + '?utm_source=email&utm_medium=followup&utm_campaign=email4';

  const html = `
<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#222222;">
  <p>Hola ${firstName},</p>
  <p>No tienes que decidir hoy si Newave es para ti. Solo entra y compruébalo.</p>
  <p>7 días gratis. Acceso completo. Si no es lo tuyo, sales sin pagar.</p>
  <p>Entra aquí: <a href="${utmUrl4}">Newave Academy</a></p>
  <p>Cualquier duda, puedes escribirnos por WhatsApp: <a href="${WA_LINK}">wa.me/525573906923</a></p>
  <p>Nos vemos dentro.</p>
  <p>Santiago<br><strong>Co-Founder</strong><br><em>NEWAVE</em></p>
</div>`;

  GmailApp.sendEmail(correo, subject, '', { name: FROM_NAME, replyTo: FROM_EMAIL, htmlBody: html });
}

// ─── EMAIL 5 — 6 días (última llamada) ────────────────────────────────────

function sendEmail5(nombre, correo) {
  const firstName = nombre.split(' ')[0] || 'hola';
  const subject = 'Esto es lo último que te escribo';
  const utmUrl5 = SKOOL_URL + '?utm_source=email&utm_medium=followup&utm_campaign=email5';

  const html = `
<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#222222;">
  <p>Hola ${firstName},</p>
  <p>Este es el último correo que te mando sobre esto.</p>
  <p>Hace días diste un paso: llenaste el formulario porque algo te dijo que querías cambiar tu situación. Trabajar remoto. Ganar en dólares. Tener más libertad.</p>
  <p>Esa razón sigue ahí. La pregunta es si vas a hacer algo al respecto o lo vas a dejar pasar otra vez.</p>
  <p>Newave sigue abierto para ti. 7 días gratis, sin compromiso. Lo único que tienes que hacer es entrar.</p>
  <p>Entra aquí: <a href="${utmUrl5}">Newave Academy</a></p>
  <p>Cualquier duda, puedes escribirnos por WhatsApp: <a href="${WA_LINK}">wa.me/525573906923</a></p>
  <p>Si decides que no es tu momento, lo entiendo. Pero si tu meta sigue siendo trabajar remoto para una empresa internacional, este es tu mejor camino.</p>
  <p>Tú decides.</p>
  <p>Santiago<br><strong>Co-Founder</strong><br><em>NEWAVE</em></p>
</div>`;

  GmailApp.sendEmail(correo, subject, '', { name: FROM_NAME, replyTo: FROM_EMAIL, htmlBody: html });
}

// ─── SHEET SETUP ──────────────────────────────────────────────────────────

function getSheet(name) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    const headers = [
      'Fecha', 'Nombre', 'Correo', 'WhatsApp', 'LinkedIn',
      'Inglés', 'Trabajo actual', 'Razón del cambio',
      'Nivel de compromiso', 'Capacidad de inversión', 'Track', 'Estatus', 'Click a plan',
    ];
    const headerRow = sheet.getRange(1, 1, 1, headers.length);
    headerRow.setValues([headers]);
    headerRow.setFontWeight('bold');
    headerRow.setBackground('#1a1f26');
    headerRow.setFontColor('#FC7342');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// Corre esta función una sola vez para forzar el prompt de autorización
// de UrlFetchApp (llamadas HTTP salientes, necesarias para WhatsApp).
function autorizarUrlFetch() {
  const resp = UrlFetchApp.fetch('https://www.google.com', { muteHttpExceptions: true });
  Logger.log('OK, código: ' + resp.getResponseCode());
}

// Borra todas las claves wa_ pendientes (limpieza de pruebas viejas).
function limpiarColaWhatsapp() {
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();
  let borradas = 0;
  for (const key in all) {
    if (key.indexOf('wa_') === 0) {
      props.deleteProperty(key);
      borradas++;
    }
  }
  Logger.log('Borradas ' + borradas + ' claves wa_');
}

function diagnostico() {
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();
  const waKeys = Object.keys(all).filter(k => k.indexOf('wa_') === 0);
  Logger.log('Total properties: ' + Object.keys(all).length);
  Logger.log('Claves wa_: ' + JSON.stringify(waKeys));

  const sheet = getSheet(SHEET_NAME);
  const lastRow = sheet.getLastRow();
  Logger.log('Última fila del sheet: ' + lastRow);
  const rowData = sheet.getRange(lastRow, 1, 1, 13).getValues()[0];
  Logger.log('Datos última fila: ' + JSON.stringify(rowData));
}
