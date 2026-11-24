'use strict';
/**
 * ============================================================================
 *  memoria.js - MEMORIA DEL DUENDE (corto y largo plazo)
 * ============================================================================
 *
 *  Dos memorias, como las nuestras:
 *
 *  MEMORIA DE CORTO PLAZO (volatil, en RAM)
 *    Lo que esta pasando AHORA en la conversacion: de quien estabamos
 *    hablando, cual era el tema, como venia el animo, que pregunta quedo
 *    abierta. Vive ~40 minutos y se borra. Es a proposito: si se guardara
 *    todo, el duende respondería a un contexto viejo que ya no aplica.
 *
 *  MEMORIA DE LARGO PLAZO (tabla `memorias`)
 *    Lo que vale la pena conservar: datos que la persona pide guardar
 *    expresamente ("registra esto de mi"), su mensaje publico para el grupo
 *    ("si alguien pregunta por mi dile que..."), historias que conto y cosas
 *    que aprendio de ella.
 *
 *  Tres mecanismos la hacen parecer memoria de verdad y no un baul:
 *
 *    1. REFUERZO POR REPETICION. Si alguien cuenta dos veces lo mismo, no se
 *       duplica la fila: se le sube el peso. Lo repetido se recuerda mejor.
 *    2. CURVA DE OLVIDO (Ebbinghaus). La relevancia de un recuerdo decae de
 *       forma exponencial con el tiempo, pero se reinicia cada vez que se usa.
 *       Lo que se evoca seguido se mantiene fresco; lo que no, se hunde.
 *    3. RECUPERACION POR PARECIDO. Para traer un recuerdo no se busca por
 *       palabra exacta sino con TF-IDF + coseno (nlp.js), asi "lo del viaje"
 *       encuentra "fuimos a Cusco el ano pasado".
 *
 *  PRIVACIDAD: cada recuerdo tiene `visibilidad`. Lo `privado` solo se le
 *  cuenta a su dueno (y al duende). Solo lo que la persona marco como
 *  `grupo` se le puede contar a otro. El sorteo no entra nunca a este modulo.
 * ============================================================================
 */

const { all, get, run } = require('./db');
const nlp = require('./nlp');
const navidad = require('./navidad');

const VIDA_CORTO = 40 * 60 * 1000;         // 40 minutos
const SEMIVIDA_DIAS = 45;                  // a los 45 dias un recuerdo pesa la mitad

// ---------------------------------------------------------------------------
// MEMORIA DE CORTO PLAZO
// ---------------------------------------------------------------------------

const corto = new Map();                   // userId -> { datos, visto }

function cortoPlazo(userId) {
  const ahora = Date.now();
  const actual = corto.get(userId);
  if (actual && ahora - actual.visto < VIDA_CORTO) {
    actual.visto = ahora;
    return actual.datos;
  }
  // nace (o renace) vacia
  const datos = {
    tema: null,              // de que venimos hablando
    personaId: null,         // a quien mencionamos ultimo
    personaNombre: null,
    animo: 0,                // valencia promedio del rato
    turnos: 0,
    ultimasFrases: [],       // las ultimas cosas que dijo, para no repetirse
    preguntaAbierta: null,   // pregunta que el duende dejo en el aire
    temasHablados: []
  };
  corto.set(userId, { datos, visto: ahora });
  return datos;
}

function anotarCorto(userId, cambios) {
  const d = cortoPlazo(userId);
  Object.assign(d, cambios);
  return d;
}

/** Registra un turno: mueve el promedio de animo y recuerda el tema. */
function turnoCorto(userId, texto, valencia) {
  const d = cortoPlazo(userId);
  d.turnos++;
  // promedio movil exponencial: el animo de ahora pesa mas que el de hace rato
  d.animo = d.animo * 0.65 + valencia * 0.35;
  const tema = nlp.temaDe(texto);
  if (tema) {
    d.tema = tema;
    if (!d.temasHablados.includes(tema)) d.temasHablados.push(tema);
    if (d.temasHablados.length > 12) d.temasHablados.shift();
  }
  d.ultimasFrases.push(String(texto).slice(0, 120));
  if (d.ultimasFrases.length > 6) d.ultimasFrases.shift();
  return d;
}

function olvidarCorto(userId) { corto.delete(userId); }

// ---------------------------------------------------------------------------
// MEMORIA DE LARGO PLAZO
// ---------------------------------------------------------------------------

/**
 * Guarda algo en la memoria larga. Si ya hay un recuerdo muy parecido del
 * mismo tipo, lo refuerza en vez de duplicarlo.
 *
 * @param {number}  usuarioId    de quien es el recuerdo
 * @param {number?} autorId      quien lo conto (puede ser otro del grupo)
 * @param {string}  tipo         dato | historia | recado_publico | emocion | gusto
 * @param {string}  texto        el recuerdo en si
 * @param {string}  visibilidad  'privado' (solo su dueno) | 'grupo'
 * @param {number}  animo        valencia con la que se dijo (-1..1)
 */
async function recordar({ usuarioId, autorId = null, tipo = 'dato', texto, visibilidad = 'privado', animo = 0 }) {
  let t = String(texto || '').trim();
  if (t.length < 3) return { ok: false, motivo: 'vacio' };
  if (t.length > 600) t = nlp.resumir(t, 3).slice(0, 600);     // se queda con la esencia

  const clave = nlp.temaDe(t) || null;
  const previos = await all(
    'SELECT id, texto, peso, veces FROM memorias WHERE usuario_id = ? AND tipo = ? ORDER BY id DESC LIMIT 40',
    [usuarioId, tipo]
  );

  // dedupe semantico: busco el mas parecido con TF-IDF
  if (previos.length) {
    const idx = new nlp.TfIdf();
    previos.forEach((p, i) => idx.agregar(i, p.texto));
    const hit = idx.buscar(t, 1, 0.55);
    if (hit.length) {
      const viejo = previos[hit[0].id];
      await run(
        "UPDATE memorias SET peso = peso + 1, veces = veces + 1, ultimo_uso = datetime('now') WHERE id = ?",
        [viejo.id]
      );
      return { ok: true, id: Number(viejo.id), reforzado: true, parecido: hit[0].score };
    }
  }

  const r = await run(
    `INSERT INTO memorias (usuario_id, autor_id, tipo, clave, texto, visibilidad, animo)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [usuarioId, autorId, tipo, clave, t, visibilidad, Number(animo) || 0]
  );
  return { ok: true, id: r.lastInsertRowid, reforzado: false };
}

/**
 * Relevancia de un recuerdo = peso x curva de olvido.
 * exp(-dias / semivida) decae suave; `ultimo_uso` reinicia el reloj, asi que
 * evocar un recuerdo lo mantiene vivo.
 */
function relevancia(fila) {
  const ref = fila.ultimo_uso || fila.creado;
  const dias = Math.max(0, (Date.now() - new Date(String(ref).replace(' ', 'T') + 'Z').getTime()) / 86400000);
  const fresco = Math.exp(-dias / SEMIVIDA_DIAS);
  return (Number(fila.peso) || 1) * (0.35 + 0.65 * fresco);
}

/** Recuerdos de alguien, ya ordenados por relevancia. */
async function memoriasDe(usuarioId, { tipo = null, visibilidad = null, limite = 20 } = {}) {
  let sql = 'SELECT * FROM memorias WHERE usuario_id = ?';
  const args = [usuarioId];
  if (tipo) { sql += ' AND tipo = ?'; args.push(tipo); }
  if (visibilidad) { sql += ' AND visibilidad = ?'; args.push(visibilidad); }
  sql += ' ORDER BY id DESC LIMIT 120';
  const filas = await all(sql, args);
  return filas
    .map(f => ({ ...f, id: Number(f.id), relevancia: Number(relevancia(f).toFixed(3)) }))
    .sort((a, b) => b.relevancia - a.relevancia)
    .slice(0, limite);
}

/**
 * Busca en la memoria de alguien por parecido semantico.
 * `soloGrupo` fuerza que solo se consideren recuerdos que su dueno marco como
 * publicos: es lo que se usa cuando OTRA persona pregunta por el.
 */
async function buscar(usuarioId, consulta, { n = 2, soloGrupo = false } = {}) {
  const filas = await memoriasDe(usuarioId, { visibilidad: soloGrupo ? 'grupo' : null, limite: 80 });
  if (!filas.length) return [];
  const idx = new nlp.TfIdf();
  filas.forEach((f, i) => idx.agregar(i, f.texto + ' ' + (f.clave || '')));
  const hits = idx.buscar(consulta, n, 0.09);
  const salida = hits.map(h => ({ ...filas[h.id], score: Number(h.score.toFixed(3)) }));
  // usar un recuerdo lo refresca (reinicia su curva de olvido)
  for (const s of salida) {
    await run("UPDATE memorias SET usado = usado + 1, ultimo_uso = datetime('now') WHERE id = ?", [s.id]);
  }
  return salida;
}

/**
 * El mensaje que alguien dejo para que el duende repita cuando pregunten por
 * el. Es lo unico de su memoria que se le cuenta a terceros.
 */
async function presentacionDe(usuarioId) {
  const filas = await memoriasDe(usuarioId, { tipo: 'recado_publico', visibilidad: 'grupo', limite: 3 });
  return filas.map(f => f.texto);
}

async function olvidar(id, usuarioId) {
  const r = await run('DELETE FROM memorias WHERE id = ? AND usuario_id = ?', [id, usuarioId]);
  return r.rowsAffected > 0;
}

async function contar(usuarioId) {
  const f = await get(
    `SELECT COUNT(*) AS n, COALESCE(SUM(veces), 0) AS repasos, COALESCE(MAX(peso), 0) AS tope
     FROM memorias WHERE usuario_id = ?`, [usuarioId]
  );
  return { total: Number(f.n || 0), repasos: Number(f.repasos || 0), tope: Number(f.tope || 0) };
}

// ---------------------------------------------------------------------------
// IMPROVISACION (Markov) - entrenada solo con texto que el dueno puede leer
// ---------------------------------------------------------------------------

const cadenas = new Map();                 // userId -> { markov, visto }

/**
 * Cadena de Markov personal: el corpus navideno (publico y curado) mas las
 * propias palabras del usuario. Al no incluir texto de otros, por
 * construccion no puede improvisar algo que delate a nadie mas.
 */
async function improvisar(usuarioId) {
  const ahora = Date.now();
  const cache = cadenas.get(usuarioId);
  let m;
  if (cache && ahora - cache.visto < 10 * 60 * 1000) {
    m = cache.markov;
  } else {
    m = new nlp.Markov(2);
    m.entrenar(navidad.corpus());
    const mios = await all(
      "SELECT mensaje FROM bot_chat WHERE user_id = ? AND rol = 'user' ORDER BY id DESC LIMIT 60",
      [usuarioId]
    );
    for (const f of mios) m.entrenar(f.mensaje);
    const recuerdos = await memoriasDe(usuarioId, { limite: 40 });
    for (const r of recuerdos) m.entrenar(r.texto);
    cadenas.set(usuarioId, { markov: m, visto: ahora });
  }
  return m.generar({ maximo: 20 });
}

module.exports = {
  // corto plazo
  cortoPlazo, anotarCorto, turnoCorto, olvidarCorto,
  // largo plazo
  recordar, memoriasDe, buscar, presentacionDe, olvidar, contar, relevancia,
  // improvisacion
  improvisar,
  SEMIVIDA_DIAS
};
