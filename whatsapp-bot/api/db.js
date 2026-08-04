// Newave — acceso a la base de datos de conversaciones (Vercel Postgres / Neon)
const { sql } = require('@vercel/postgres');

let tablaLista = false;

// Crea la tabla si no existe. Se llama antes de cada operación; es barato
// porque Postgres ignora el CREATE TABLE IF NOT EXISTS si ya existe.
async function asegurarTabla() {
  if (tablaLista) return;
  await sql`
    CREATE TABLE IF NOT EXISTS mensajes (
      id SERIAL PRIMARY KEY,
      numero TEXT NOT NULL,
      nombre TEXT,
      rol TEXT NOT NULL,
      contenido TEXT NOT NULL,
      creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_mensajes_numero ON mensajes (numero);`;

  // Datos del formulario, para que el bot sepa con quién habla antes de que
  // la persona se lo cuente. El número es la llave: es lo único que tenemos
  // en común entre el formulario y quien escribe por WhatsApp.
  await sql`
    CREATE TABLE IF NOT EXISTS leads (
      numero TEXT PRIMARY KEY,
      nombre TEXT,
      trabajo TEXT,
      razon TEXT,
      ingles TEXT,
      compromiso TEXT,
      creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;

  // Etiquetas del dashboard para marcar cómo salió cada conversación
  // (buena / revisar / convirtió). Tabla aparte para no tocar `leads`, que
  // la escribe Apps Script: aquí solo escribe el dashboard.
  await sql`
    CREATE TABLE IF NOT EXISTS etiquetas (
      numero TEXT PRIMARY KEY,
      etiqueta TEXT,
      actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
  tablaLista = true;
}

// Marca una conversación. Pasar etiqueta null o '' la quita.
async function guardarEtiqueta(numero, etiqueta) {
  await asegurarTabla();
  if (!etiqueta) {
    await sql`DELETE FROM etiquetas WHERE numero = ${numero};`;
    return;
  }
  await sql`
    INSERT INTO etiquetas (numero, etiqueta)
    VALUES (${numero}, ${etiqueta})
    ON CONFLICT (numero) DO UPDATE SET
      etiqueta = EXCLUDED.etiqueta,
      actualizado_en = NOW();
  `;
}

// Guarda (o actualiza) los datos del formulario de un lead. Si la persona
// vuelve a llenar el formulario, se queda la versión más reciente.
async function guardarLead({ numero, nombre, trabajo, razon, ingles, compromiso }) {
  await asegurarTabla();
  await sql`
    INSERT INTO leads (numero, nombre, trabajo, razon, ingles, compromiso)
    VALUES (${numero}, ${nombre}, ${trabajo}, ${razon}, ${ingles}, ${compromiso})
    ON CONFLICT (numero) DO UPDATE SET
      nombre     = EXCLUDED.nombre,
      trabajo    = EXCLUDED.trabajo,
      razon      = EXCLUDED.razon,
      ingles     = EXCLUDED.ingles,
      compromiso = EXCLUDED.compromiso,
      creado_en  = NOW();
  `;
}

// Busca los datos del formulario de un número. Devuelve null si no hay
// (ej. alguien que escribe sin haber llenado el formulario).
async function obtenerLead(numero) {
  await asegurarTabla();
  const { rows } = await sql`SELECT * FROM leads WHERE numero = ${numero} LIMIT 1;`;
  return rows[0] || null;
}

// Guarda un mensaje (rol: 'user' o 'assistant') asociado a un número.
async function guardarMensaje(numero, nombre, rol, contenido) {
  await asegurarTabla();
  await sql`
    INSERT INTO mensajes (numero, nombre, rol, contenido)
    VALUES (${numero}, ${nombre}, ${rol}, ${contenido});
  `;
}

// Lista de conversaciones (una fila por número), con el último mensaje y su hora.
// Lista de conversaciones con su etiqueta. Si se pasa `busqueda`, filtra por
// nombre, número o contenido de cualquier mensaje de esa conversación.
async function listarConversaciones(busqueda) {
  await asegurarTabla();

  const termino = (busqueda || '').trim();
  let rows;

  if (termino) {
    const patron = `%${termino}%`;
    // El filtro va sobre la conversación completa (por eso el IN), no solo
    // sobre el último mensaje: buscar "precio" debe encontrar a quien lo
    // preguntó hace 20 mensajes, no solo si fue lo último que dijo.
    ({ rows } = await sql`
      SELECT DISTINCT ON (m.numero)
        m.numero,
        m.nombre,
        m.contenido AS ultimo_mensaje,
        m.rol AS ultimo_rol,
        m.creado_en AS ultima_actividad,
        e.etiqueta
      FROM mensajes m
      LEFT JOIN etiquetas e ON e.numero = m.numero
      WHERE m.numero IN (
        SELECT DISTINCT numero FROM mensajes
        WHERE contenido ILIKE ${patron}
           OR nombre ILIKE ${patron}
           OR numero ILIKE ${patron}
      )
      ORDER BY m.numero, m.creado_en DESC;
    `);
  } else {
    ({ rows } = await sql`
      SELECT DISTINCT ON (m.numero)
        m.numero,
        m.nombre,
        m.contenido AS ultimo_mensaje,
        m.rol AS ultimo_rol,
        m.creado_en AS ultima_actividad,
        e.etiqueta
      FROM mensajes m
      LEFT JOIN etiquetas e ON e.numero = m.numero
      ORDER BY m.numero, m.creado_en DESC;
    `);
  }

  rows.sort((a, b) => new Date(b.ultima_actividad) - new Date(a.ultima_actividad));
  return rows;
}

// Todos los mensajes de un número específico, en orden cronológico.
async function obtenerConversacion(numero) {
  await asegurarTabla();
  const { rows } = await sql`
    SELECT rol, contenido, creado_en
    FROM mensajes
    WHERE numero = ${numero}
    ORDER BY creado_en ASC;
  `;
  return rows;
}

// Borra todos los mensajes de un número específico.
async function borrarConversacion(numero) {
  await asegurarTabla();
  await sql`DELETE FROM mensajes WHERE numero = ${numero};`;
}

module.exports = { guardarMensaje, listarConversaciones, obtenerConversacion, borrarConversacion, guardarLead, obtenerLead, guardarEtiqueta };
