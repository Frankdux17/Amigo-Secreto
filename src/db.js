'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

// La base de datos vive DENTRO de la carpeta del proyecto (data/amigo_secreto.db).
// En Render se puede apuntar a un disco persistente con la variable DB_DIR.
const DB_DIR = process.env.DB_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const DB_FILE = path.join(DB_DIR, 'amigo_secreto.db');
const db = new Database(DB_FILE);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
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
  creado          TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS sorteo (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  dador_id   INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  recibe_id  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  ronda      INTEGER NOT NULL DEFAULT 1,
  visto      INTEGER NOT NULL DEFAULT 0,
  creado     TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (dador_id, ronda)
);

CREATE TABLE IF NOT EXISTS config (
  clave TEXT PRIMARY KEY,
  valor TEXT
);

-- Lo que el bot va aprendiendo de cada usuario (se alimenta de sus respuestas)
CREATE TABLE IF NOT EXISTS bot_memoria (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id   INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  tipo      TEXT    NOT NULL DEFAULT 'deseo',
  texto     TEXT    NOT NULL,
  creado    TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS bot_chat (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id   INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  rol       TEXT    NOT NULL,
  mensaje   TEXT    NOT NULL,
  creado    TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS sesiones (
  sid     TEXT PRIMARY KEY,
  expira  INTEGER NOT NULL,
  data    TEXT NOT NULL
);
`);

// ---------- config ----------
const DEFAULTS = {
  max_participantes: '8',
  monto: 'S/ 50 - S/ 80',
  fecha_evento: '2026-12-24',
  lugar: 'Por definir',
  titulo_evento: 'Amigo Secreto Navidad 2026',
  sorteo_hecho: '0',
  ronda_actual: '1'
};

function getConfig(clave) {
  const row = db.prepare('SELECT valor FROM config WHERE clave = ?').get(clave);
  return row ? row.valor : (DEFAULTS[clave] !== undefined ? DEFAULTS[clave] : null);
}

function setConfig(clave, valor) {
  db.prepare(`INSERT INTO config (clave, valor) VALUES (?, ?)
              ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor`).run(clave, String(valor));
}

function allConfig() {
  const out = Object.assign({}, DEFAULTS);
  for (const r of db.prepare('SELECT clave, valor FROM config').all()) out[r.clave] = r.valor;
  return out;
}

for (const [k, v] of Object.entries(DEFAULTS)) {
  if (!db.prepare('SELECT 1 FROM config WHERE clave = ?').get(k)) setConfig(k, v);
}

// ---------- administrador por defecto ----------
function seedAdmin() {
  const existe = db.prepare("SELECT id FROM usuarios WHERE usuario = 'admin'").get();
  if (existe) return;
  db.prepare(`INSERT INTO usuarios
    (usuario, password_hash, nombre, apodo, email, telefono, gustos, no_gustos,
     talla_ropa, talla_zapato, color_favorito, hobbies, deseo1, rol)
    VALUES (@usuario, @password_hash, @nombre, @apodo, @email, @telefono, @gustos, @no_gustos,
     @talla_ropa, @talla_zapato, @color_favorito, @hobbies, @deseo1, 'admin')`).run({
    usuario: 'admin',
    password_hash: bcrypt.hashSync('admin123', 10),
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
  });
}
seedAdmin();

module.exports = { db, DB_FILE, DB_DIR, getConfig, setConfig, allConfig, DEFAULTS };
