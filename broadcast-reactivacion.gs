// Newave — Broadcast de reactivación (Fase 4)
// Script INDEPENDIENTE del appsscript.gs de producción. No comparte
// trigger, cola de propiedades, ni nada — cero riesgo de romper el
// flujo de leads nuevos que ya está funcionando.
//
// Uso:
//   1. Correr generarListaReactivacion() UNA VEZ. Lee "Registros" y
//      crea/llena la hoja "Reactivacion" con los leads filtrados.
//   2. Revisar la hoja "Reactivacion" a mano si quieres quitar a alguien.
//   3. Correr encolarEnvioReactivacion() UNA VEZ. Encola el envío.
//   4. El trigger de 5 min (creado automáticamente) va disparando los
//      mensajes en tandas hasta terminar la lista.

const SHEET_ID_ORIGEN   = '10J5chMWPrFFzIYEkjc36HMDJ1H-_q5Q2IsE7srnv1MA';
const SHEET_REGISTROS   = 'Registros';
const SHEET_REACTIVAR   = 'Reactivacion';

// Columnas del sheet "Registros" (1-based)
const R_COL_NOMBRE     = 2;
const R_COL_WHATSAPP   = 4;
const R_COL_COMPROMISO = 9;
const R_COL_ESTATUS    = 12;

const WA_TEMPLATE_NAME = 'nw_reactivacion_lead_v2';
const WA_TEMPLATE_LANG = 'es_MX';

// Máximo de mensajes por corrida del trigger (cada 5 min). Reparte el
// envío para no golpear límites de Meta ni verse como spam masivo.
const MAX_POR_CORRIDA = 20;

// ─── PASO 1 — Generar la lista filtrada ────────────────────────────────────

function generarListaReactivacion() {
  const ss = SpreadsheetApp.openById(SHEET_ID_ORIGEN);
  const origen = ss.getSheetByName(SHEET_REGISTROS);
  const lastRow = origen.getLastRow();
  if (lastRow < 2) { Logger.log('Sin filas en Registros.'); return; }

  const data = origen.getRange(2, 1, lastRow - 1, 13).getValues();
  const filtrados = [];

  data.forEach(fila => {
    const nombre     = fila[R_COL_NOMBRE - 1];
    const whatsapp   = fila[R_COL_WHATSAPP - 1];
    const compromiso = fila[R_COL_COMPROMISO - 1];
    const estatus    = (fila[R_COL_ESTATUS - 1] || '').toString().toLowerCase();

    const listo = compromiso === 'Listo para tomar accion';
    const yaConvertido = estatus.includes('trial') || estatus.includes('pago');

    if (listo && !yaConvertido && whatsapp) {
      filtrados.push([nombre, whatsapp, '']); // tercera col: Estatus del broadcast
    }
  });

  let destino = ss.getSheetByName(SHEET_REACTIVAR);
  if (destino) { ss.deleteSheet(destino); } // empieza limpio cada vez que se corre
  destino = ss.insertSheet(SHEET_REACTIVAR);

  const headers = ['Nombre', 'WhatsApp', 'Estatus'];
  destino.getRange(1, 1, 1, 3).setValues([headers]);
  destino.getRange(1, 1, 1, 3).setFontWeight('bold');
  destino.setFrozenRows(1);

  if (filtrados.length > 0) {
    destino.getRange(2, 1, filtrados.length, 3).setValues(filtrados);
  }

  Logger.log('Lista generada: ' + filtrados.length + ' personas en la hoja "' + SHEET_REACTIVAR + '"');
}

// ─── PASO 2 — Encolar el envío ──────────────────────────────────────────────

function encolarEnvioReactivacion() {
  const ss = SpreadsheetApp.openById(SHEET_ID_ORIGEN);
  const sheet = ss.getSheetByName(SHEET_REACTIVAR);
  if (!sheet) { Logger.log('Primero corre generarListaReactivacion().'); return; }

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) { Logger.log('La hoja Reactivacion está vacía.'); return; }

  const data = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
  const props = PropertiesService.getScriptProperties();
  let encolados = 0;

  data.forEach((fila, i) => {
    const rowNumber = i + 2;
    const [nombre, whatsapp, estatus] = fila;
    if (estatus) return; // ya procesado (enviado o error) — no reencolar

    const key = 'bc_' + rowNumber;
    props.setProperty(key, JSON.stringify({ nombre, whatsapp, row: rowNumber }));
    encolados++;
  });

  ensureTrigger();
  Logger.log('Encolados: ' + encolados);
}

// ─── PASO 3 — Procesar la cola (automático, cada 5 min) ────────────────────

function procesarColaReactivacion() {
  const ss = SpreadsheetApp.openById(SHEET_ID_ORIGEN);
  const sheet = ss.getSheetByName(SHEET_REACTIVAR);
  if (!sheet) return;

  const props = PropertiesService.getScriptProperties();
  const allProps = props.getProperties();
  let enviados = 0;

  for (const key in allProps) {
    if (key.indexOf('bc_') !== 0) continue;
    if (enviados >= MAX_POR_CORRIDA) break;

    const data = JSON.parse(allProps[key]);
    try {
      enviarPlantilla(data.whatsapp);
      sheet.getRange(data.row, 3).setValue('Enviado');
      enviados++;
    } catch (err) {
      sheet.getRange(data.row, 3).setValue('Error: ' + (err.message || err));
    }
    props.deleteProperty(key);
  }

  if (enviados > 0) Logger.log('Enviados en esta corrida: ' + enviados);
}

function ensureTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  for (const t of triggers) {
    if (t.getHandlerFunction() === 'procesarColaReactivacion') return;
  }
  ScriptApp.newTrigger('procesarColaReactivacion')
    .timeBased()
    .everyMinutes(5)
    .create();
}

// ─── WhatsApp API ───────────────────────────────────────────────────────────

function enviarPlantilla(whatsapp) {
  const props = PropertiesService.getScriptProperties();
  const token         = props.getProperty('WA_TOKEN');
  const phoneNumberId = props.getProperty('WA_PHONE_NUMBER_ID');
  if (!token || !phoneNumberId) throw new Error('Faltan WA_TOKEN / WA_PHONE_NUMBER_ID en Script Properties');

  const to = normalizarNumero(whatsapp);
  const payload = {
    messaging_product: 'whatsapp',
    to: to,
    type: 'template',
    template: { name: WA_TEMPLATE_NAME, language: { code: WA_TEMPLATE_LANG } },
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

function normalizarNumero(numero) {
  let digits = numero.toString().replace(/\D/g, '');
  if (digits.length === 10) digits = '52' + digits;
  return digits;
}

// ─── Detener el broadcast en cualquier momento ─────────────────────────────

function detenerBroadcast() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => {
    if (t.getHandlerFunction() === 'procesarColaReactivacion') ScriptApp.deleteTrigger(t);
  });

  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();
  let borrados = 0;
  for (const key in all) {
    if (key.indexOf('bc_') === 0) { props.deleteProperty(key); borrados++; }
  }
  Logger.log('Trigger eliminado. Pendientes borrados: ' + borrados);
}
