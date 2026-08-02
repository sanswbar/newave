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
  tablaLista = true;
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
async function listarConversaciones() {
  await asegurarTabla();
  const { rows } = await sql`
    SELECT DISTINCT ON (numero)
      numero,
      nombre,
      contenido AS ultimo_mensaje,
      rol AS ultimo_rol,
      creado_en AS ultima_actividad
    FROM mensajes
    ORDER BY numero, creado_en DESC;
  `;
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

module.exports = { guardarMensaje, listarConversaciones, obtenerConversacion, borrarConversacion, guardarLead, obtenerLead };
