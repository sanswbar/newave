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
  tablaLista = true;
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

module.exports = { guardarMensaje, listarConversaciones, obtenerConversacion, borrarConversacion };
