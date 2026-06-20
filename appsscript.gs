 // Newave Nuevo Formulario — Google Apps Script

const SHEET_ID   = '10J5chMWPrFFzIYEkjc36HMDJ1H-_q5Q2IsE7srnv1MA';
const SHEET_NAME = 'Registros';

const SKOOL_URL        = 'https://www.skool.com/newave';
const TESTIMONIOS_URL  = 'https://www.newaveacademy.com/#testimonios';
const FROM_NAME        = 'Santiago · NEWAVE';
const FROM_EMAIL       = 'hello@nwave.co';

// Column indices (1-based) — must match sheet headers
const COL_FECHA      = 1;
const COL_NOMBRE     = 2;
const COL_CORREO     = 3;
const COL_ESTATUS    = 12; // Column L — add manually if not present

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
      'Correo enviado: inmediato', // initial Estatus
    ];
    sheet.appendRow(row);

    // Schedule Email 1 for 2 minutes later
    const lastRow = sheet.getLastRow();
    scheduleEmail1delayed(nombre, correo, lastRow);

    // Schedule Email 2 for 24 hours later
    scheduleEmail2(nombre, correo, lastRow);

    return ContentService
      .createTextOutput(JSON.stringify({ status: 'ok' }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ─── EMAIL 1 — 2 minute delay ─────────────────────────────────────────────

function scheduleEmail1delayed(nombre, correo, rowNumber) {
  const props = PropertiesService.getScriptProperties();
  const key   = 'email1_' + rowNumber;
  const data  = JSON.stringify({ nombre: nombre, correo: correo, row: rowNumber });
  props.setProperty(key, data);

  ScriptApp.newTrigger('sendPendingEmail1')
    .timeBased()
    .after(2 * 60 * 1000) // 2 minutes in ms
    .create();
}

function sendPendingEmail1() {
  const props = PropertiesService.getScriptProperties();
  const allProps = props.getProperties();

  for (const key in allProps) {
    if (!key.startsWith('email1_')) continue;

    const data   = JSON.parse(allProps[key]);
    const nombre = data.nombre;
    const correo = data.correo;

    if (correo) {
      sendEmail1(nombre, correo);
    }

    props.deleteProperty(key);
  }

  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === 'sendPendingEmail1') {
      ScriptApp.deleteTrigger(trigger);
    }
  }
}

function sendEmail1(nombre, correo) {
  const firstName = nombre.split(' ')[0] || 'hola';

  const subject = 'Prueba Newave Academy 7 días gratis';

  const utmUrl1 = SKOOL_URL + '?utm_source=email&utm_medium=registro&utm_campaign=email1';

  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.7;color:#111111;max-width:560px;margin:0 auto;">
  <p>Hola ${firstName},</p>
  <p>Soy Santiago, cofundador de Newave Academy.</p>
  <p>Vimos que llenaste nuestro formulario porque te interesa conseguir un trabajo remoto.</p>
  <p>No sé qué te frenó para unirte al programa, pero realmente queremos ayudarte. Por eso te invitamos a probar Newave gratis durante 7 días.</p>
  <p>Sin compromiso.</p>
  <p>Dentro tendrás acceso al curso completo, plantillas de CV, Cover Letter y LinkedIn, nuestra comunidad privada, herramientas de AI y una bolsa de trabajo con vacantes 100% remotas.</p>
  <p><a href="${utmUrl1}" style="color:#FC7342;">Entra aquí → Newave Academy</a></p>
  <p>Si después de una semana sientes que no es para ti, no pagas.</p>
  <p>Pero si tu meta sigue siendo trabajar remoto para una empresa internacional, ganar en dólares y tener más libertad, este es tu mejor camino.</p>
  <p>Nos vemos dentro.</p>
  <p style="margin-top:32px;">Santiago<br>Co-Founder<br>NEWAVE</p>
</div>`;

  GmailApp.sendEmail(correo, subject, '', {
    name: FROM_NAME,
    replyTo: FROM_EMAIL,
    htmlBody: html,
  });
}

// ─── EMAIL 2 — 24 hours later ─────────────────────────────────────────────

function scheduleEmail2(nombre, correo, rowNumber) {
  // Store pending email in Script Properties so the trigger can retrieve it
  const props = PropertiesService.getScriptProperties();
  const key   = 'pending_' + rowNumber;
  const data  = JSON.stringify({ nombre: nombre, correo: correo, row: rowNumber });
  props.setProperty(key, data);

  // Create a one-time trigger 24 hours from now
  ScriptApp.newTrigger('sendPendingEmail2')
    .timeBased()
    .after(24 * 60 * 60 * 1000) // 24 hours in ms
    .create();
}

function sendPendingEmail2() {
  const props = PropertiesService.getScriptProperties();
  const sheet = getSheet(SHEET_NAME);
  const allProps = props.getProperties();

  // Find all pending email 2 entries
  for (const key in allProps) {
    if (!key.startsWith('pending_')) continue;

    const data      = JSON.parse(allProps[key]);
    const rowNumber = data.row;
    const nombre    = data.nombre;
    const correo    = data.correo;

    // Check current Estatus in the sheet — skip if already Pago or Trial
    const estatus = sheet.getRange(rowNumber, COL_ESTATUS).getValue().toString().toLowerCase();
    const skip    = estatus.includes('pago') || estatus.includes('trial');

    if (!skip && correo) {
      sendEmail2(nombre, correo);
      // Update Estatus
      sheet.getRange(rowNumber, COL_ESTATUS).setValue('Correo enviado: 24h');
    }

    // Clean up the property regardless
    props.deleteProperty(key);
  }

  // Delete all time-based triggers named sendPendingEmail2 that have already fired
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === 'sendPendingEmail2') {
      ScriptApp.deleteTrigger(trigger);
    }
  }
}

function sendEmail2(nombre, correo) {
  const firstName = nombre.split(' ')[0] || 'hola';

  const subject = '¿Todavía quieres trabajar remoto?';

  const utmUrl2 = SKOOL_URL + '?utm_source=email&utm_medium=followup&utm_campaign=email2';
  const utmTestimonios = TESTIMONIOS_URL + '?utm_source=email&utm_medium=followup&utm_campaign=email2';

  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.7;color:#111111;max-width:560px;margin:0 auto;">
  <p>Hola ${firstName},</p>
  <p>Ayer llenaste el formulario. No quiero que se te pase.</p>
  <p>Las personas que están dentro hoy tenían las mismas dudas que tú. La diferencia es que entraron.</p>
  <p style="border-left:3px solid #FC7342;padding-left:16px;color:#333333;font-style:italic;">"Mis mejores entrevistas y procesos fueron gracias a que me uní a esta comunidad. Sí funciona."<br><br>— Rebeca Cruz, consiguió oferta en Stripe</p>
  <p>Si quieres ver más historias: <a href="${utmTestimonios}" style="color:#FC7342;">Historias de egresados</a></p>
  <p>7 días gratis.<br><a href="${utmUrl2}" style="color:#FC7342;">Entra aquí → Newave Academy</a></p>
  <p>Nos vemos dentro.</p>
  <p style="margin-top:32px;">Santiago<br>Co-Founder<br>NEWAVE</p>
</div>`;

  GmailApp.sendEmail(correo, subject, '', {
    name: FROM_NAME,
    replyTo: FROM_EMAIL,
    htmlBody: html,
  });
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
