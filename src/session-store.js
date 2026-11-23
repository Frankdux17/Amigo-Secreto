'use strict';

// Store de sesiones sobre SQLite/libSQL: las sesiones sobreviven a un
// reinicio del servidor y, con Turso, también a un redespliegue.
const session = require('express-session');
const { all, get, run } = require('./db');

const Store = session.Store;

class SqliteStore extends Store {
  constructor(options = {}) {
    super(options);
    this.ttl = options.ttl || 1000 * 60 * 60 * 24 * 30; // 30 días
    const limpieza = setInterval(() => this.limpiar(), 1000 * 60 * 60);
    if (limpieza.unref) limpieza.unref();
    this.limpiar();
  }

  limpiar() {
    run('DELETE FROM sesiones WHERE expira < ?', [Date.now()]).catch(() => {});
  }

  venceEn(sess) {
    if (sess && sess.cookie && sess.cookie.expires) {
      return new Date(sess.cookie.expires).getTime();
    }
    return Date.now() + this.ttl;
  }

  get(sid, cb) {
    get('SELECT data, expira FROM sesiones WHERE sid = ?', [sid])
      .then(fila => {
        if (!fila) return cb(null, null);
        if (Number(fila.expira) < Date.now()) {
          return run('DELETE FROM sesiones WHERE sid = ?', [sid])
            .then(() => cb(null, null))
            .catch(() => cb(null, null));
        }
        let datos;
        try { datos = JSON.parse(fila.data); } catch (e) { return cb(null, null); }
        cb(null, datos);
      })
      .catch(err => cb(err));
  }

  set(sid, sess, cb) {
    run(
      `INSERT INTO sesiones (sid, expira, data) VALUES (?, ?, ?)
       ON CONFLICT(sid) DO UPDATE SET expira = excluded.expira, data = excluded.data`,
      [sid, this.venceEn(sess), JSON.stringify(sess)]
    ).then(() => cb && cb(null)).catch(err => cb && cb(err));
  }

  destroy(sid, cb) {
    run('DELETE FROM sesiones WHERE sid = ?', [sid])
      .then(() => cb && cb(null)).catch(err => cb && cb(err));
  }

  touch(sid, sess, cb) {
    return this.set(sid, sess, cb);
  }

  length(cb) {
    get('SELECT COUNT(*) AS n FROM sesiones WHERE expira >= ?', [Date.now()])
      .then(r => cb(null, Number(r.n))).catch(err => cb(err));
  }

  all(cb) {
    all('SELECT sid, data FROM sesiones WHERE expira >= ?', [Date.now()])
      .then(filas => {
        const salida = {};
        for (const f of filas) {
          try { salida[f.sid] = JSON.parse(f.data); } catch (e) { /* ignorar */ }
        }
        cb(null, salida);
      })
      .catch(err => cb(err));
  }

  clear(cb) {
    run('DELETE FROM sesiones').then(() => cb && cb(null)).catch(err => cb && cb(err));
  }
}

module.exports = SqliteStore;
