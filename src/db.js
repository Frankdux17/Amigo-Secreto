'use strict';

// ============================================================
//  Capa de datos (SQLite / libSQL)
//
//  - En local: un archivo SQLite dentro del proyecto -> data/amigo_secreto.db
//  - En producción (Render): la misma base SQLite, pero alojada en Turso,
//    para que los datos NO vivan dentro del contenedor y sobrevivan a
//    reinicios y redespliegues.
//
//  Basta con definir TURSO_DATABASE_URL y TURSO_AUTH_TOKEN para cambiar de
//  uno a otro: no hay que tocar una sola línea de código.
// ============================================================

const path = require('path');
const fs = require('fs');
const { createClient } = require('@libsql/client');
const bcrypt = require('bcryptjs');

const DB_DIR = process.env.DB_DIR || path.join(__dirname, '..', 'data');
const ARCHIVO_LOCAL = path.join(DB_DIR, 'amigo_secreto.db');

const USA_TURSO = !!process.env.TURSO_DATABASE_URL;
if (!USA_TURSO && !fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const cliente = createClient(
  USA_TURSO
    ? { url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN }
    : { url: 'file:' + ARCHIVO_LOCAL.replace(/\\/g, '/') }
);

const DB_FILE = USA_TURSO ? process.env.TURSO_DATABASE_URL.replace(/\?.*$/, '') : ARCHIVO_LOCAL;

// ---------- helpers de consulta ----------
async function all(sql, args = {}) {
  const r = await cliente.execute({ sql, args });
  return r.rows;
}

async function get(sql, args = {}) {
  const filas = await all(sql, args);
  return filas.length ? filas[0] : undefined;
}

async function run(sql, args = {}) {
  const r = await cliente.execute({ sql, args });
  return {
    lastInsertRowid: r.lastInsertRowid == null ? null : Number(r.lastInsertRowid),
    rowsAffected: r.rowsAffected
  };
}

// varias sentencias en una sola transacción
async function batch(sentencias) {
  return cliente.batch(sentencias, 'write');
}

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS usuarios (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario         TEXT    NOT NULL UNIQUE,
  password_hash   TEXT    NOT NULL,
  nombre          TEXT    NOT NULL,
  apodo           TEXT,
  email           TEXT    NOT NULL,
  telefono        TEXT    NOT NULL,
  cumple          TEXT,
  gustos          TEXT    NOT NULL,
  no_gustos       TEXT,
  talla_ropa      TEXT    NOT NULL,
  talla_zapato    TEXT    NOT NULL,
  color_favorito  TEXT    NOT NULL,
  hobbies         TEXT    NOT NULL,
  deseo1          TEXT    NOT NULL,
  deseo2          TEXT,
  deseo3          TEXT,
  direccion       TEXT,
  foto            TEXT,
  rol             TEXT    NOT NULL DEFAULT 'participante',
  activo          INTEGER NOT NULL DEFAULT 1,
  creado          TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sorteo (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  dador_id   INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  recibe_id  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  ronda      INTEGER NOT NULL DEFAULT 1,
  visto      INTEGER NOT NULL DEFAULT 0,
  creado     TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (dador_id, ronda)
);

CREATE TABLE IF NOT EXISTS config (
  clave TEXT PRIMARY KEY,
  valor TEXT
);

CREATE TABLE IF NOT EXISTS bot_memoria (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id   INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  tipo      TEXT    NOT NULL DEFAULT 'deseo',
  texto     TEXT    NOT NULL,
  creado    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bot_chat (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id   INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  rol       TEXT    NOT NULL,
  mensaje   TEXT    NOT NULL,
  creado    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sesiones (
  sid     TEXT PRIMARY KEY,
  expira  INTEGER NOT NULL,
  data    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS senales (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  tipo        TEXT    NOT NULL DEFAULT 'gusta',
  valor       TEXT    NOT NULL,
  peso        REAL    NOT NULL DEFAULT 1,
  origen      TEXT    NOT NULL DEFAULT 'chat',
  autor_id    INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  creado      TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_senales_usuario ON senales (usuario_id);

CREATE TABLE IF NOT EXISTS recados (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  de_id       INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  para_id     INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  texto       TEXT    NOT NULL,
  anonimo     INTEGER NOT NULL DEFAULT 0,
  estado      TEXT    NOT NULL DEFAULT 'pendiente',
  respuesta   TEXT,
  creado      TEXT    NOT NULL DEFAULT (datetime('now')),
  entregado   TEXT
);
CREATE INDEX IF NOT EXISTS idx_recados_para ON recados (para_id, estado);

`;

// ---------- configuración (en memoria, se lee muchas veces) ----------
const DEFAULTS = {
  max_participantes: '8',
  monto: 'S/ 50 - S/ 80',
  fecha_evento: '2026-12-24',
  lugar: 'Por definir',
  titulo_evento: 'Amigo Secreto Navidad 2026',
  sorteo_hecho: '0',
  ronda_actual: '1',
  fecha_sorteo: ''
};

let cache = Object.assign({}, DEFAULTS);

async function cargarConfig() {
  const filas = await all('SELECT clave, valor FROM config');
  cache = Object.assign({}, DEFAULTS);
  for (const f of filas) cache[f.clave] = f.valor;
  return cache;
}

function getConfig(clave) {
  return cache[clave] !== undefined ? cache[clave] : null;
}

function allConfig() {
  return Object.assign({}, cache);
}

async function setConfig(clave, valor) {
  await run(
    `INSERT INTO config (clave, valor) VALUES (:clave, :valor)
     ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor`,
    { clave, valor: String(valor) }
  );
  cache[clave] = String(valor);
}

// ---------- arranque ----------

/**
 * CREATE TABLE IF NOT EXISTS crea tablas nuevas, pero no agrega columnas a una
 * tabla que ya existe. Esto compara lo que hay con lo que debería haber y
 * agrega lo que falte, para que un despliegue sobre datos viejos no se rompa.
 */
const COLUMNAS_ESPERADAS = {
  usuarios: {
    apodo: 'TEXT', cumple: 'TEXT', no_gustos: 'TEXT', direccion: 'TEXT', foto: 'TEXT',
    rol: "TEXT NOT NULL DEFAULT 'participante'", activo: 'INTEGER NOT NULL DEFAULT 1'
  },
  sorteo: { visto: 'INTEGER NOT NULL DEFAULT 0' },
  senales: { autor_id: 'INTEGER', origen: "TEXT NOT NULL DEFAULT 'chat'", peso: 'REAL NOT NULL DEFAULT 1' },
  recados: { anonimo: 'INTEGER NOT NULL DEFAULT 0', respuesta: 'TEXT', entregado: 'TEXT' }
};

async function migrarColumnas() {
  const agregadas = [];
  for (const [tabla, columnas] of Object.entries(COLUMNAS_ESPERADAS)) {
    let actuales;
    try { actuales = await all(`PRAGMA table_info(${tabla})`); }
    catch (e) { continue; }                       // la tabla aún no existe
    if (!actuales || !actuales.length) continue;
    const hay = new Set(actuales.map(c => c.name));
    for (const [col, tipo] of Object.entries(columnas)) {
      if (hay.has(col)) continue;
      try {
        await cliente.execute(`ALTER TABLE ${tabla} ADD COLUMN ${col} ${tipo}`);
        agregadas.push(`${tabla}.${col}`);
      } catch (e) { /* ya existía o no se puede: se ignora */ }
    }
  }
  if (agregadas.length) console.log('Columnas agregadas:', agregadas.join(', '));
  return agregadas;
}

async function init() {
  await cliente.executeMultiple(ESQUEMA);
  await migrarColumnas();

  for (const [k, v] of Object.entries(DEFAULTS)) {
    const existe = await get('SELECT 1 AS x FROM config WHERE clave = ?', [k]);
    if (!existe) await run('INSERT INTO config (clave, valor) VALUES (?, ?)', [k, v]);
  }
  await cargarConfig();

  // administrador por defecto
  const admin = await get("SELECT id FROM usuarios WHERE usuario = 'admin'");
  if (!admin) {
    await run(
      `INSERT INTO usuarios
        (usuario, password_hash, nombre, apodo, email, telefono, gustos, no_gustos,
         talla_ropa, talla_zapato, color_favorito, hobbies, deseo1, rol)
       VALUES (@usuario, @password_hash, @nombre, @apodo, @email, @telefono, @gustos, @no_gustos,
         @talla_ropa, @talla_zapato, @color_favorito, @hobbies, @deseo1, 'admin')`,
      {
        usuario: 'admin',
        password_hash: bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'admin123', 10),
        nombre: 'Administrador',
        apodo: 'Santa Jefe',
        email: 'admin@navidad.local',
        telefono: '000000000',
        gustos: 'Organizar la mejor Navidad',
        no_gustos: 'El desorden',
        talla_ropa: 'M',
        talla_zapato: '40',
        color_favorito: 'Rojo',
        hobbies: 'Coordinar el intercambio',
        deseo1: 'Que todos reciban su regalo'
      }
    );
  }

  return { USA_TURSO, DB_FILE };
}

module.exports = {
  cliente, init, all, get, run, batch, migrarColumnas,
  getConfig, setConfig, allConfig, cargarConfig,
  DB_FILE, DB_DIR, USA_TURSO, DEFAULTS
};
