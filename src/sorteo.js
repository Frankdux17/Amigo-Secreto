'use strict';

const crypto = require('crypto');
const { all, get, run, batch, getConfig, setConfig } = require('./db');

// Entero aleatorio criptográficamente seguro en [0, max)
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

// Permutación SIN puntos fijos (nadie se saca a sí mismo).
// Usa un ciclo único: así tampoco se forman parejas que se regalan entre sí
// (A->B y B->A), que es lo que más arruina la sorpresa en un intercambio real.
function cicloUnico(ids) {
  const orden = shuffle(ids);
  const pares = [];
  for (let i = 0; i < orden.length; i++) {
    pares.push({ dador: orden[i], recibe: orden[(i + 1) % orden.length] });
  }
  return pares;
}

function participantes() {
  return all("SELECT id, nombre, usuario FROM usuarios WHERE rol = 'participante' AND activo = 1 ORDER BY id");
}

async function totalParticipantes() {
  const r = await get("SELECT COUNT(*) AS n FROM usuarios WHERE rol = 'participante' AND activo = 1");
  return Number(r.n);
}

function sorteoHecho() {
  return getConfig('sorteo_hecho') === '1';
}

function rondaActual() {
  return parseInt(getConfig('ronda_actual') || '1', 10);
}

function asignacionDe(userId) {
  return get(
    `SELECT s.id AS sorteo_id, s.visto, u.*
       FROM sorteo s JOIN usuarios u ON u.id = s.recibe_id
      WHERE s.dador_id = ? AND s.ronda = ?`,
    [userId, rondaActual()]
  );
}

function marcarVisto(userId) {
  return run('UPDATE sorteo SET visto = 1 WHERE dador_id = ? AND ronda = ?', [userId, rondaActual()]);
}

function todasLasAsignaciones() {
  return all(
    `SELECT d.id AS dador_id, d.nombre AS dador, d.usuario AS dador_usuario, d.foto AS dador_foto,
            r.id AS recibe_id, r.nombre AS recibe, r.usuario AS recibe_usuario, r.foto AS recibe_foto,
            s.visto, s.ronda
       FROM sorteo s
       JOIN usuarios d ON d.id = s.dador_id
       JOIN usuarios r ON r.id = s.recibe_id
      WHERE s.ronda = ?
      ORDER BY d.nombre`,
    [rondaActual()]
  );
}

// Ejecuta el sorteo. Devuelve { ok, motivo, total }
async function ejecutarSorteo({ forzar = false } = {}) {
  const max = parseInt(getConfig('max_participantes') || '8', 10);
  const lista = await participantes();

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

  const ronda = (forzar && sorteoHecho()) ? rondaActual() + 1 : rondaActual();
  const pares = cicloUnico(lista.map(u => Number(u.id)));

  await batch([
    { sql: 'DELETE FROM sorteo WHERE ronda = ?', args: [ronda] },
    ...pares.map(p => ({
      sql: 'INSERT INTO sorteo (dador_id, recibe_id, ronda) VALUES (?, ?, ?)',
      args: [p.dador, p.recibe, ronda]
    }))
  ]);

  await setConfig('ronda_actual', ronda);
  await setConfig('sorteo_hecho', '1');
  await setConfig('fecha_sorteo', new Date().toLocaleString('es-PE', { timeZone: 'America/Lima' }));

  return { ok: true, motivo: 'Sorteo realizado con éxito.', total: lista.length, ronda };
}

// Se llama después de cada registro: si ya se completó el cupo, sortea solo.
async function sortearSiEstaCompleto() {
  const max = parseInt(getConfig('max_participantes') || '8', 10);
  if (sorteoHecho()) return { ok: false, motivo: 'ya_sorteado' };
  if (await totalParticipantes() >= max) return ejecutarSorteo();
  return { ok: false, motivo: 'incompleto' };
}

async function reiniciarSorteo() {
  await run('DELETE FROM sorteo');
  await setConfig('sorteo_hecho', '0');
  await setConfig('ronda_actual', '1');
  await setConfig('fecha_sorteo', '');
}

module.exports = {
  participantes, totalParticipantes, sorteoHecho, rondaActual,
  asignacionDe, marcarVisto, todasLasAsignaciones,
  ejecutarSorteo, sortearSiEstaCompleto, reiniciarSorteo
};
