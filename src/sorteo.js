'use strict';

const crypto = require('crypto');
const { db, getConfig, setConfig } = require('./db');

// Entero aleatorio criptograficamente seguro en [0, max)
function randInt(max) {
  return crypto.randomInt(max);
}

// Mezcla Fisher-Yates
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Genera una permutacion SIN puntos fijos (nadie se saca a si mismo).
// Ademas usa un ciclo unico: asi no se forman parejas que se regalan entre si (A->B, B->A),
// que es lo que mas arruina la sorpresa en un intercambio real.
function cicloUnico(ids) {
  const orden = shuffle(ids);
  const pares = [];
  for (let i = 0; i < orden.length; i++) {
    const dador = orden[i];
    const recibe = orden[(i + 1) % orden.length];
    pares.push({ dador, recibe });
  }
  return pares;
}

function participantes() {
  return db.prepare(
    "SELECT id, nombre, usuario FROM usuarios WHERE rol = 'participante' AND activo = 1 ORDER BY id"
  ).all();
}

function totalParticipantes() {
  return participantes().length;
}

function sorteoHecho() {
  return getConfig('sorteo_hecho') === '1';
}

function rondaActual() {
  return parseInt(getConfig('ronda_actual') || '1', 10);
}

function asignacionDe(userId) {
  return db.prepare(`
    SELECT s.id AS sorteo_id, s.visto, u.*
    FROM sorteo s JOIN usuarios u ON u.id = s.recibe_id
    WHERE s.dador_id = ? AND s.ronda = ?`).get(userId, rondaActual());
}

function marcarVisto(userId) {
  db.prepare('UPDATE sorteo SET visto = 1 WHERE dador_id = ? AND ronda = ?').run(userId, rondaActual());
}

function todasLasAsignaciones() {
  return db.prepare(`
    SELECT d.id AS dador_id, d.nombre AS dador, d.usuario AS dador_usuario, d.foto AS dador_foto,
           r.id AS recibe_id, r.nombre AS recibe, r.usuario AS recibe_usuario, r.foto AS recibe_foto,
           s.visto, s.ronda
    FROM sorteo s
    JOIN usuarios d ON d.id = s.dador_id
    JOIN usuarios r ON r.id = s.recibe_id
    WHERE s.ronda = ?
    ORDER BY d.nombre`).all(rondaActual());
}

// Ejecuta el sorteo. Devuelve { ok, motivo, total }
function ejecutarSorteo({ forzar = false } = {}) {
  const max = parseInt(getConfig('max_participantes') || '8', 10);
  const lista = participantes();

  if (sorteoHecho() && !forzar) {
    return { ok: false, motivo: 'El sorteo ya fue realizado.', total: lista.length };
  }
  if (lista.length < 3) {
    return { ok: false, motivo: 'Se necesitan al menos 3 participantes.', total: lista.length };
  }
  if (!forzar && lista.length < max) {
    return {
      ok: false,
      motivo: `Faltan ${max - lista.length} participante(s) para completar los ${max}.`,
      total: lista.length
    };
  }

  const ronda = forzar && sorteoHecho() ? rondaActual() + 1 : rondaActual();
  const pares = cicloUnico(lista.map(u => u.id));

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM sorteo WHERE ronda = ?').run(ronda);
    const ins = db.prepare('INSERT INTO sorteo (dador_id, recibe_id, ronda) VALUES (?, ?, ?)');
    for (const p of pares) ins.run(p.dador, p.recibe, ronda);
  });
  tx();

  setConfig('ronda_actual', ronda);
  setConfig('sorteo_hecho', '1');
  setConfig('fecha_sorteo', new Date().toLocaleString('es-PE'));

  return { ok: true, motivo: 'Sorteo realizado con exito.', total: lista.length, ronda };
}

// Se llama despues de cada registro: si ya se completo el cupo, sortea solo.
function sortearSiEstaCompleto() {
  const max = parseInt(getConfig('max_participantes') || '8', 10);
  if (sorteoHecho()) return { ok: false, motivo: 'ya_sorteado' };
  if (totalParticipantes() >= max) return ejecutarSorteo();
  return { ok: false, motivo: 'incompleto' };
}

function reiniciarSorteo() {
  db.prepare('DELETE FROM sorteo').run();
  setConfig('sorteo_hecho', '0');
  setConfig('ronda_actual', '1');
  setConfig('fecha_sorteo', '');
}

module.exports = {
  participantes, totalParticipantes, sorteoHecho, rondaActual,
  asignacionDe, marcarVisto, todasLasAsignaciones,
  ejecutarSorteo, sortearSiEstaCompleto, reiniciarSorteo
};
