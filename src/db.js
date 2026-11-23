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
async function init() {
  await cliente.executeMultiple(ESQUEMA);

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
  cliente, init, all, get, run, batch,
  getConfig, setConfig, allConfig, cargarConfig,
  DB_FILE, DB_DIR, USA_TURSO, DEFAULTS
};
