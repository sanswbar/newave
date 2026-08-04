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
// Columna N — cuántos correos había recibido la persona al marcarla como
// trial. Se llena sola (ver registrarCorreoAlConvertir): al marcar "trial" a
// mano se sobrescribe la columna Estatus y se pierde el "email N" que tenía,
// así que este dato se deduce del tiempo transcurrido desde el registro.
const COL_CORREO_AL_CONVERTIR = 14;

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

// Si un envío encolado lleva más de esto esperando, se descarta en vez de
// mandarse. Un "hola, vi que llenaste el formulario" que llega 3 días después
// se lee como spam, no como bienvenida.
const MAX_RETRASO_WHATSAPP = 6 * 60 * 60 * 1000; // 6 horas

// WhatsApp Cloud API config — token y phone number id viven en Script
// Properties (Project Settings > Script Properties), no aquí en el código:
//   WA_TOKEN            = token permanente del System User
//   WA_PHONE_NUMBER_ID  = Phone Number ID de producción
const WA_TEMPLATE_NAME = 'nw_bienvenida_lead_v3';
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

    // Métricas para el dashboard del bot. Va con clave porque devuelve
    // información agregada del negocio, no algo que deba ser público.
    if (e.parameter.action === 'metricas') {
      const claveOk = PropertiesService.getScriptProperties().getProperty('DASHBOARD_PASSWORD');
      if (!claveOk || e.parameter.clave !== claveOk) {
        return ContentService
          .createTextOutput(JSON.stringify({ status: 'error', message: 'No autorizado' }))
          .setMimeType(ContentService.MimeType.JSON);
      }
      return ContentService
        .createTextOutput(JSON.stringify(calcularMetricas()))
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

    // Lock obligatorio: Apps Script atiende peticiones en paralelo y
    // appendRow no es atómico entre ejecuciones. Sin esto, dos formularios
    // enviados en el mismo segundo (normal con campañas activas) pueden
    // pisarse la fila. Además getLastRow() justo después podría devolver la
    // fila del OTRO lead y encolarle los correos a la persona equivocada.
    //
    // La deduplicación va DENTRO del lock a propósito: el formulario envía el
    // registro por dos caminos a la vez (fetch + imagen) para que ningún lead
    // se pierda, y esos dos llegan casi simultáneos. Comprobar el duplicado
    // fuera del lock dejaría pasar ambos.
    const lock = LockService.getScriptLock();
    let lastRow;
    let duplicado = false;
    try {
      lock.waitLock(30000);

      const filaPrevia = buscarDuplicadoReciente(sheet, correo);
      if (filaPrevia) {
        duplicado = true;
        lastRow = filaPrevia;
      } else {
        sheet.appendRow(row);
        lastRow = sheet.getLastRow();
      }
    } finally {
      lock.releaseLock();
    }

    // Si ya existía, no se vuelve a encolar la secuencia de correos: el lead
    // recibiría la serie completa por duplicado.
    if (duplicado) {
      return ContentService
        .createTextOutput(JSON.stringify({ status: 'ok', duplicado: true }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const compromiso = e.parameter.compromiso || '';
    // Cambio 3 ago 2026: los correos van a TODOS los niveles de compromiso,
    // incluido "Buscando, no listo aun". Razón: son ~7% de los leads (31 de
    // 458 en junio), el nurture por correo es justo la herramienta para quien
    // aún no está listo, y el costo en cuota de Gmail es mínimo (~7-10
    // correos extra al día). El correo es de baja intrusión; WhatsApp abajo
    // sigue filtrado porque un mensaje directo a quien dijo "aún no" sí se
    // siente invasivo.
    queueSequence(nombre, correo, lastRow);
    // Reactivado 3 ago 2026 (se pausó el 30 jul por sospecha de que bajaba
    // los leads; los datos no confirmaron esa correlación). Mismo criterio
    // que los correos de arriba: no se le escribe a quien de entrada dijo
    // que solo está viendo. Si algo sale mal, volver a comentar esta línea.
    if (compromiso !== 'Buscando, no listo aun') {
      queueWhatsapp(nombre, whatsapp, lastRow);
    }

    // Le pasa al bot lo que la persona escribió, para que si escribe por
    // WhatsApp ya sepa quién es y no pregunte de cero lo que ya contestó.
    enviarLeadAlBot({
      nombre:     nombre,
      whatsapp:   whatsapp,
      trabajo:    e.parameter.trabajo || '',
      razon:      e.parameter.razon || '',
      ingles:     e.parameter.ingles || '',
      compromiso: compromiso,
    });

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

// Manda los datos del formulario al bot de WhatsApp. Va envuelto en try/catch
// a propósito: si el bot está caído o cambia de URL, el lead ya quedó guardado
// en el sheet y no se debe perder el registro por esto. Falla en silencio
// (solo log) porque este envío es un extra, no parte del registro del lead.
function enviarLeadAlBot(datos) {
  try {
    const props  = PropertiesService.getScriptProperties();
    const url    = props.getProperty('BOT_LEAD_URL');
    const secret = props.getProperty('BOT_LEAD_SECRET');
    if (!url || !secret) return; // no configurado todavía, no es un error

    const resp = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-lead-secret': secret },
      payload: JSON.stringify(datos),
      muteHttpExceptions: true,
    });

    const code = resp.getResponseCode();
    if (code >= 300) {
      console.error('enviarLeadAlBot: HTTP ' + code + ' — ' + resp.getContentText());
    }
  } catch (err) {
    console.error('enviarLeadAlBot falló: ' + err);
  }
}

// Calcula el embudo (leads → click al plan → trial) por periodo y por
// segmento, leyendo el sheet de Registros. Lo consume el dashboard del bot.
function calcularMetricas() {
  const sheet = getSheet(SHEET_NAME);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { total: vacio(), hoy: vacio(), semana: vacio(), mes: vacio(), segmentos: {} };

  // Una sola lectura del rango completo: pedir celda por celda sobre miles de
  // filas es lentísimo en Apps Script.
  const datos = sheet.getRange(2, 1, lastRow - 1, COL_CORREO_AL_CONVERTIR).getValues();

  const ahora = new Date();
  const inicioHoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
  const inicioSemana = new Date(inicioHoy.getTime() - 7 * 24 * 60 * 60 * 1000);
  const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1);

  // El registro de clicks se implementó el 11 jul 2026 (commit 893f7b7). Los
  // leads anteriores tienen la columna vacía por diseño, no porque no hayan
  // dado click, así que se cuentan aparte para no diluir el porcentaje.
  const INICIO_TRACKING_CLICKS = new Date(2026, 6, 11); // 11 jul 2026
  let leadsConTrackingClick = 0;
  let clicksDesdeTracking = 0;

  const total  = vacio();
  const hoy    = vacio();
  const semana = vacio();
  const mes    = vacio();
  const porCompromiso = {};
  const porIngles = {};
  const porTrack = {};
  // Cuántos correos había recibido cada quien al momento de convertir.
  // Es el último correo ENVIADO antes del trial, no prueba de causalidad,
  // pero sirve para ver en qué punto de la secuencia se concentran.
  const porCorreo = { 'Sin correo aún': 0, 'Correo 1': 0, 'Correo 2': 0, 'Correo 3': 0, 'Correo 4': 0, 'Correo 5': 0, 'Sin dato': 0 };
  const numerosTrial = [];

  for (let i = 0; i < datos.length; i++) {
    const fila = datos[i];
    const fecha      = fila[COL_FECHA - 1];
    const ingles     = (fila[5]  || '').toString().trim();   // col 6
    const compromiso = (fila[8]  || '').toString().trim();   // col 9
    const track      = (fila[10] || '').toString().trim();   // col 11
    const estatus    = (fila[COL_ESTATUS - 1] || '').toString().toLowerCase();
    const click      = (fila[COL_CLICK - 1] || '').toString().trim();

    // El estatus acumula notas separadas por " | " (correos, WhatsApp), así
    // que se busca la palabra dentro, no una igualdad exacta.
    const esTrial = estatus.indexOf('trial') !== -1 || estatus.indexOf('pago') !== -1;
    const dioClick = click !== '';

    sumar(total, esTrial, dioClick);

    if (fecha instanceof Date && !isNaN(fecha.getTime())) {
      if (fecha >= inicioHoy)    sumar(hoy, esTrial, dioClick);
      if (fecha >= inicioSemana) sumar(semana, esTrial, dioClick);
      if (fecha >= inicioMes)    sumar(mes, esTrial, dioClick);

      if (fecha >= INICIO_TRACKING_CLICKS) {
        leadsConTrackingClick++;
        if (dioClick) clicksDesdeTracking++;
      }
    }

    acumularSegmento(porCompromiso, compromiso || 'Sin dato', esTrial, dioClick);
    acumularSegmento(porIngles,     ingles     || 'Sin dato', esTrial, dioClick);
    acumularSegmento(porTrack,      track      || 'Sin dato', esTrial, dioClick);

    if (esTrial) {
      // La columna N la llena onEdit al marcar el trial. Si está vacía, es un
      // trial de antes de esa mecánica y no hay dato — se cuenta aparte en vez
      // de meterlo en "Sin correo aún", que significaría otra cosa.
      const registrado = fila[COL_CORREO_AL_CONVERTIR - 1];
      if (registrado === '' || registrado === null || registrado === undefined) {
        porCorreo['Sin dato']++;
      } else {
        const n = parseInt(registrado, 10);
        const llave = n === 0 ? 'Sin correo aún' : 'Correo ' + n;
        if (porCorreo[llave] !== undefined) porCorreo[llave]++;
      }

      // Solo el número normalizado, para que el bot pueda cruzar quién de
      // los que convirtieron había hablado con él. Sin nombre ni correo.
      const wa = normalizarNumero(fila[3] || '');
      if (wa) numerosTrial.push(wa);
    }
  }

  return {
    actualizado: ahora.toISOString(),
    total: total,
    hoy: hoy,
    semana: semana,
    mes: mes,
    segmentos: {
      compromiso: porCompromiso,
      ingles: porIngles,
      track: porTrack,
    },
    trialsPorCorreo: porCorreo,
    numerosTrial: numerosTrial,
    // Base real para el % de clicks: solo los leads que llegaron cuando el
    // registro de clicks ya existía.
    tracking: {
      clicksDesde: INICIO_TRACKING_CLICKS.toISOString(),
      leadsDesdeTracking: leadsConTrackingClick,
      clicksDesdeTracking: clicksDesdeTracking,
    },
  };

  function vacio() { return { leads: 0, clicks: 0, trials: 0 }; }

  function sumar(acc, esTrial, dioClick) {
    acc.leads++;
    if (dioClick) acc.clicks++;
    if (esTrial)  acc.trials++;
  }

  function acumularSegmento(mapa, llave, esTrial, dioClick) {
    if (!mapa[llave]) mapa[llave] = { leads: 0, clicks: 0, trials: 0 };
    sumar(mapa[llave], esTrial, dioClick);
  }
}

// Se dispara al editar el sheet. Cuando se marca una fila como "trial",
// calcula cuántos correos de la secuencia ya habían salido y lo guarda en la
// columna N, antes de que ese dato se pierda para siempre.
//
// Se deduce del tiempo transcurrido desde el registro (los correos salen en
// tiempos fijos) en vez de leerlo del estatus, porque marcar el trial a mano
// sobrescribe esa celda y borra el "Correo enviado: email N" que tenía.
function onEdit(e) {
  try {
    if (!e || !e.range) return;
    const sheet = e.range.getSheet();
    if (sheet.getName() !== SHEET_NAME) return;
    if (e.range.getColumn() !== COL_ESTATUS) return;

    const fila = e.range.getRow();
    if (fila < 2) return;

    const valor = (e.range.getValue() || '').toString().toLowerCase();
    if (valor.indexOf('trial') === -1 && valor.indexOf('pago') === -1) return;

    // Si ya se registró antes, no pisarlo (por si se re-edita la celda)
    const celdaDestino = sheet.getRange(fila, COL_CORREO_AL_CONVERTIR);
    if (celdaDestino.getValue() !== '') return;

    const fechaRegistro = sheet.getRange(fila, COL_FECHA).getValue();
    if (!(fechaRegistro instanceof Date) || isNaN(fechaRegistro.getTime())) return;

    celdaDestino.setValue(correosEnviadosAl(Date.now() - fechaRegistro.getTime()));
  } catch (err) {
    // Nunca romper la edición del sheet por esto
    console.error('onEdit falló: ' + err);
  }
}

// Cuántos correos de la secuencia ya habían salido tras X ms del registro.
// Nota: es cuántos se ENVIARON, no cuántos se abrieron o leyeron.
function correosEnviadosAl(transcurridoMs) {
  let n = 0;
  for (let i = 1; i <= 5; i++) {
    if (transcurridoMs >= EMAIL_DELAYS[i]) n = i;
  }
  return n;
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

// Ventana para considerar dos registros del mismo correo como el mismo envío.
// El formulario manda fetch + imagen casi a la vez, y el reintento diferido de
// localStorage puede llegar bastante después si la persona cerró la pestaña.
// 10 min cubre ambos casos sin bloquear a quien vuelve a aplicar otro día.
const VENTANA_DUPLICADO_MS = 10 * 60 * 1000;

// Devuelve la fila de un registro reciente con el mismo correo, o 0 si no hay.
// Solo mira las últimas filas: el duplicado siempre está al final, y así no se
// recorre todo el sheet en cada submit.
function buscarDuplicadoReciente(sheet, correo) {
  if (!correo) return 0;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;

  const FILAS_A_REVISAR = 30;
  const desde = Math.max(2, lastRow - FILAS_A_REVISAR + 1);
  const numFilas = lastRow - desde + 1;
  if (numFilas < 1) return 0;

  // Columnas 1..3 = Fecha, Nombre, Correo
  const datos = sheet.getRange(desde, COL_FECHA, numFilas, COL_CORREO).getValues();
  const target = correo.trim().toLowerCase();
  const ahora = Date.now();

  for (let i = datos.length - 1; i >= 0; i--) {
    const correoFila = datos[i][COL_CORREO - 1];
    if (!correoFila || correoFila.toString().trim().toLowerCase() !== target) continue;

    const fecha = datos[i][COL_FECHA - 1];
    // Si la fecha no es una fecha válida, se prefiere NO tratarlo como
    // duplicado: registrar de más es mejor que perder el lead.
    if (!(fecha instanceof Date) || isNaN(fecha.getTime())) continue;

    if (ahora - fecha.getTime() <= VENTANA_DUPLICADO_MS) {
      return desde + i;
    }
  }
  return 0;
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
    // Guard contra celdas vacías o con error de fórmula: sin esto, un
    // .toString() sobre null lanza excepción y tumba processQueue entero,
    // dejando sin correos a TODOS los leads pendientes de esa corrida.
    const val = correos[i][0];
    if (val && val.toString().trim().toLowerCase() === target) {
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

    // Una clave con JSON corrupto no debe tumbar la cola entera: se descarta
    // y se sigue con los demás leads.
    let data;
    try {
      data = JSON.parse(allProps[key]);
    } catch (err) {
      props.deleteProperty(key);
      continue;
    }
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

    let data;
    try {
      data = JSON.parse(allProps[key]);
    } catch (err) {
      props.deleteProperty(key);
      continue;
    }
    Logger.log('[WA queue] ' + key + ' dueAt=' + data.dueAt + ' now=' + now + ' pendiente=' + (now < data.dueAt));
    if (now < data.dueAt) continue; // not due yet

    // Un mensaje de bienvenida que llega días tarde es peor que no mandarlo:
    // la persona ya no se acuerda del formulario y se siente spam. Si la cola
    // se atoró (pausa, error, cuota), se descarta en vez de enviarse tarde.
    if (now - data.dueAt > MAX_RETRASO_WHATSAPP) {
      Logger.log('[WA queue] descartado por viejo: ' + key + ' (' + Math.round((now - data.dueAt) / 3600000) + ' h de retraso)');
      if (data.row) agregarEstatus(sheet, data.row, 'WhatsApp no enviado (encolado muy viejo)');
      props.deleteProperty(key);
      continue;
    }

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

  // Al final de cada corrida: ¿lleva el sheet demasiado sin leads nuevos?
  vigilarSilencioDeLeads();
}

// ─── WATCHDOG: alerta si el sheet se queda en silencio ────────────────────
// El 30 jul 2026 el registro de leads se cortó a las 2 PM y nadie se dio
// cuenta hasta el día siguiente. Esto corre en cada pasada de processQueue
// (cada 5 min) y manda un correo de alerta si lleva demasiado sin entrar un
// lead nuevo. No detecta pérdidas sueltas (un lead fallido entre muchos que
// sí entraron); para eso, comparar form_submit de GA4 contra las filas del
// sheet del mismo día.
// Umbral de 16 h: el silencio nocturno normal es de ~14 h (últimos leads
// ~8 PM, se reanudan ~9-10 AM), así que 5 h alarmaría en falso cada
// madrugada. Con 16 h las noches nunca alarman y un corte real de mediodía
// avisa a la mañana siguiente.
const SILENCIO_UMBRAL_MS   = 16 * 60 * 60 * 1000; // 16 h sin leads = alerta
const SILENCIO_REALERTA_MS = 6 * 60 * 60 * 1000;  // re-alertar máx cada 6 h

function vigilarSilencioDeLeads() {
  try {
    const sheet = getSheet(SHEET_NAME);
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return;

    const fecha = sheet.getRange(lastRow, COL_FECHA).getValue();
    if (!(fecha instanceof Date) || isNaN(fecha.getTime())) return;

    const silencio = Date.now() - fecha.getTime();
    if (silencio < SILENCIO_UMBRAL_MS) return;

    // No repetir la alerta en cada corrida mientras dure el silencio
    const props = PropertiesService.getScriptProperties();
    const ultima = Number(props.getProperty('ultima_alerta_silencio') || 0);
    if (Date.now() - ultima < SILENCIO_REALERTA_MS) return;

    const horas = Math.round((silencio / 3600000) * 10) / 10;
    GmailApp.sendEmail(
      FROM_EMAIL,
      'Sin leads nuevos en el sheet desde hace ' + horas + ' horas',
      'El último registro en "' + SHEET_NAME + '" es de: ' + fecha + '\n\n' +
      'Puede ser tráfico bajo real, pero si las campañas están activas, revisa en orden:\n' +
      '1. GA4 -> Eventos -> form_submit: ¿hay submits recientes que no llegaron al sheet?\n' +
      '2. Apps Script -> Ejecuciones: ¿doGet está marcando errores?\n' +
      '3. Meta Ads Manager: ¿las campañas siguen entregando?\n\n' +
      '(Alerta automática del watchdog en processQueue. Se repite máximo cada 6 horas mientras siga el silencio.)'
    );
    props.setProperty('ultima_alerta_silencio', String(Date.now()));
  } catch (err) {
    // El watchdog jamás debe tumbar processQueue: si falla, solo se loguea.
    console.error('vigilarSilencioDeLeads falló: ' + err);
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
// El "1" después del 52 se quita: mucha gente escribe su número como
// +52 1 55..., pero la Cloud API espera 52 + los 10 dígitos. Sin esto el envío
// falla o va a un número distinto al que luego contesta por WhatsApp, y el bot
// no encuentra el contexto del lead (que se guarda ya sin ese "1").
function normalizarNumero(numero) {
  let digits = numero.toString().replace(/\D/g, '');
  if (digits.length === 10) digits = '52' + digits; // bare 10-digit MX number
  if (digits.startsWith('521') && digits.length === 13) {
    digits = '52' + digits.slice(3);
  }
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
  <p style="margin:0 0 16px">Cualquier duda, puedes escribirnos por WhatsApp <a href="${WA_LINK}">aquí</a></p>
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
  <p>Cualquier duda, puedes escribirnos por WhatsApp <a href="${WA_LINK}">aquí</a></p>
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
  <p>Cualquier duda, puedes escribirnos por WhatsApp <a href="${WA_LINK}">aquí</a></p>
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
  <p>Cualquier duda, puedes escribirnos por WhatsApp <a href="${WA_LINK}">aquí</a></p>
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
  <p>Cualquier duda, puedes escribirnos por WhatsApp <a href="${WA_LINK}">aquí</a></p>
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
