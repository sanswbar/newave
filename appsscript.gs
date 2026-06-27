 // Newave Nuevo Formulario — Google Apps Script

const SHEET_ID   = '10J5chMWPrFFzIYEkjc36HMDJ1H-_q5Q2IsE7srnv1MA';
const SHEET_NAME = 'Registros';

const SKOOL_URL        = 'https://www.skool.com/newave';
const COMUNIDAD_URL    = 'https://www.newaveacademy.com/#comunidad';
const FROM_NAME        = 'Newave Academy';
const FROM_EMAIL       = 'hello@nwave.co';

// Column indices (1-based) — must match sheet headers
const COL_FECHA      = 1;
const COL_NOMBRE     = 2;
const COL_CORREO     = 3;
const COL_ESTATUS    = 12; // Column L — add manually if not present

// Email sequence delays (ms after signup)
const EMAIL_DELAYS = {
  1: 2 * 60 * 1000,            // 2 min
  2: 24 * 60 * 60 * 1000,      // 24 h
  3: 3 * 24 * 60 * 60 * 1000,  // 3 días
  4: 5 * 24 * 60 * 60 * 1000,  // 5 días
  5: 7 * 24 * 60 * 60 * 1000,  // 7 días
};

// ─── FORM SUBMISSION ──────────────────────────────────────────────────────

function doGet(e) {
  try {
    const track = e.parameter.track || '';
    const sheet = getSheet(SHEET_NAME);

    const nombre  = e.parameter.nombre  || '';
    const correo  = e.parameter.correo  || '';

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
      'Registrado', // initial Estatus
    ];
    sheet.appendRow(row);

    // Queue the full email sequence in Script Properties.
    // A single recurring trigger (every5min) processes the queue — no per-email triggers.
    const lastRow = sheet.getLastRow();
    queueSequence(nombre, correo, lastRow);
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

// ─── QUEUE + SINGLE RECURRING TRIGGER ─────────────────────────────────────

// Store one pending entry per email in the sequence, each with its due timestamp.
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

// Make sure exactly ONE recurring processor trigger exists (every 5 minutes).
function ensureProcessorTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  for (const t of triggers) {
    if (t.getHandlerFunction() === 'processQueue') return; // already exists
  }
  ScriptApp.newTrigger('processQueue')
    .timeBased()
    .everyMinutes(5)
    .create();
}

// Runs every 5 min: sends any email whose dueAt has passed, skipping converted leads.
function processQueue() {
  const props = PropertiesService.getScriptProperties();
  const sheet = getSheet(SHEET_NAME);
  const allProps = props.getProperties();
  const now = Date.now();

  const senders = {
    1: sendEmail1, 2: sendEmail2, 3: sendEmail3, 4: sendEmail4, 5: sendEmail5,
  };

  for (const key in allProps) {
    if (key.indexOf('seq_') !== 0) continue;

    const data = JSON.parse(allProps[key]);
    if (now < data.dueAt) continue; // not due yet

    // Email 1 always sends; 2-5 skip if the lead already started trial or paid
    const skip = (data.emailNum !== 1) && isTrialOrPaid(sheet, data.row);

    if (!skip && data.correo) {
      try {
        senders[data.emailNum](data.nombre, data.correo);
        sheet.getRange(data.row, COL_ESTATUS).setValue('Correo enviado: email ' + data.emailNum);
      } catch (err) {
        sheet.getRange(data.row, COL_ESTATUS).setValue('Error correo ' + data.emailNum + ': ' + err.message);
      }
    }

    // Remove this entry whether it sent, failed, or was skipped — never blocks the queue
    props.deleteProperty(key);
  }
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
  <p>Hola ${firstName},</p>
  <p>Te escribe Santiago, cofundador de Newave Academy.</p>
  <p>Vimos que llenaste nuestro formulario porque te interesa conseguir un trabajo remoto.</p>
  <p>No sé qué te frenó para unirte al programa, pero realmente queremos ayudarte. Por eso te invitamos a probar Newave gratis durante 7 días.</p>
  <p>Sin compromiso.</p>
  <p>Y algo importante: Newave funciona para cualquier perfil profesional, no solo tech. Tenemos casos en marketing, ventas, diseño, finanzas, operaciones, hospitalidad y más.</p>
  <p>Dentro tendrás acceso al curso completo, plantillas de CV, Cover Letter y LinkedIn, nuestra comunidad privada, herramientas de AI y una bolsa de trabajo con vacantes 100% remotas.</p>
  <p>Entra aquí: <a href="${utmUrl1}">Newave Academy</a></p>
  <p>Si después de una semana sientes que no es para ti, no pagas.</p>
  <p>Pero si tu meta sigue siendo trabajar remoto para una empresa internacional, ganar en dólares y tener más libertad, este es tu mejor camino.</p>
  <p>Nos vemos dentro.</p>
  <p>Santiago<br><strong>Co-Founder</strong><br><em>NEWAVE</em></p>
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
  <p>Nos vemos dentro.</p>
  <p>Santiago<br><strong>Co-Founder</strong><br><em>NEWAVE</em></p>
</div>`;

  GmailApp.sendEmail(correo, subject, '', { name: FROM_NAME, replyTo: FROM_EMAIL, htmlBody: html });
}

// ─── EMAIL 3 — 3 días (caso de éxito) ─────────────────────────────────────

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
  <p>Nos vemos dentro.</p>
  <p>Santiago<br><strong>Co-Founder</strong><br><em>NEWAVE</em></p>
</div>`;

  GmailApp.sendEmail(correo, subject, '', { name: FROM_NAME, replyTo: FROM_EMAIL, htmlBody: html });
}

// ─── EMAIL 4 — 5 días ─────────────────────────────────────────────────────

function sendEmail4(nombre, correo) {
  const firstName = nombre.split(' ')[0] || 'hola';
  const subject = 'Solo necesitas una semana';
  const utmUrl4 = SKOOL_URL + '?utm_source=email&utm_medium=followup&utm_campaign=email4';

  const html = `
<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#222222;">
  <p>Hola ${firstName},</p>
  <p>No tienes que decidir hoy si Newave es para ti. Solo entra y compruébalo.</p>
  <p>7 días gratis. Acceso completo. Si no es lo tuyo, sales sin pagar.</p>
  <p>Una semana para ver si esto cambia tu situación. Nada más.</p>
  <p>Entra aquí: <a href="${utmUrl4}">Newave Academy</a></p>
  <p>Nos vemos dentro.</p>
  <p>Santiago<br><strong>Co-Founder</strong><br><em>NEWAVE</em></p>
</div>`;

  GmailApp.sendEmail(correo, subject, '', { name: FROM_NAME, replyTo: FROM_EMAIL, htmlBody: html });
}

// ─── EMAIL 5 — 7 días (última llamada) ────────────────────────────────────

function sendEmail5(nombre, correo) {
  const firstName = nombre.split(' ')[0] || 'hola';
  const subject = 'Esto es lo último que te escribo';
  const utmUrl5 = SKOOL_URL + '?utm_source=email&utm_medium=followup&utm_campaign=email5';

  const html = `
<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#222222;">
  <p>Hola ${firstName},</p>
  <p>Este es el último correo que te mando sobre esto.</p>
  <p>Hace una semana diste un paso: llenaste el formulario porque algo te dijo que querías cambiar tu situación. Trabajar remoto. Ganar en dólares. Tener más libertad.</p>
  <p>Esa razón sigue ahí. La pregunta es si vas a hacer algo al respecto o lo vas a dejar pasar otra vez.</p>
  <p>Newave sigue abierto para ti. 7 días gratis, sin compromiso. Lo único que tienes que hacer es entrar.</p>
  <p>Entra aquí: <a href="${utmUrl5}">Newave Academy</a></p>
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
      'Nivel de compromiso', 'Capacidad de inversión', 'Track', 'Estatus',
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
