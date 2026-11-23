'use strict';

// Store de sesiones sobre SQLite: las sesiones sobreviven a un reinicio del server.
const session = require('express-session');
const { db } = require('./db');

const Store = session.Store;

class SqliteStore extends Store {
  constructor(options = {}) {
    super(options);
    this.ttl = options.ttl || 1000 * 60 * 60 * 24 * 30; // 30 dias
    this.stmts = {
      get: db.prepare('SELECT data, expira FROM sesiones WHERE sid = ?'),
      set: db.prepare(`INSERT INTO sesiones (sid, expira, data) VALUES (?, ?, ?)
                       ON CONFLICT(sid) DO UPDATE SET expira = excluded.expira, data = excluded.data`),
      del: db.prepare('DELETE FROM sesiones WHERE sid = ?'),
      clean: db.prepare('DELETE FROM sesiones WHERE expira < ?'),
      all: db.prepare('SELECT sid, data FROM sesiones WHERE expira >= ?'),
      count: db.prepare('SELECT COUNT(*) AS n FROM sesiones WHERE expira >= ?')
    };
    setInterval(() => this.limpiar(), 1000 * 60 * 60).unref();
    this.limpiar();
  }

  limpiar() {
    try { this.stmts.clean.run(Date.now()); } catch (_) { /* noop */ }
  }

  venceEn(sess) {
    if (sess && sess.cookie && sess.cookie.expires) {
      return new Date(sess.cookie.expires).getTime();
    }
    return Date.now() + this.ttl;
  }

  get(sid, cb) {
    try {
      const row = this.stmts.get.get(sid);
      if (!row) return cb(null, null);
      if (row.expira < Date.now()) { this.stmts.del.run(sid); return cb(null, null); }
      return cb(null, JSON.parse(row.data));
    } catch (err) { return cb(err); }
  }

  set(sid, sess, cb) {
    try {
      this.stmts.set.run(sid, this.venceEn(sess), JSON.stringify(sess));
      return cb && cb(null);
    } catch (err) { return cb && cb(err); }
  }

  destroy(sid, cb) {
    try { this.stmts.del.run(sid); return cb && cb(null); }
    catch (err) { return cb && cb(err); }
  }

  touch(sid, sess, cb) {
    return this.set(sid, sess, cb);
  }

  length(cb) {
    try { return cb(null, this.stmts.count.get(Date.now()).n); }
    catch (err) { return cb(err); }
  }

  clear(cb) {
    try { db.prepare('DELETE FROM sesiones').run(); return cb && cb(null); }
    catch (err) { return cb && cb(err); }
  }
}

module.exports = SqliteStore;
