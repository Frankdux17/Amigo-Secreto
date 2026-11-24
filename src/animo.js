'use strict';
/**
 * ============================================================================
 *  animo.js - LAS EMOCIONES DEL DUENDE
 * ============================================================================
 *
 *  El duende no responde siempre igual: tiene estado interno y eso se le nota
 *  en la cara, en la voz y en lo que dice.
 *
 *  Tres variables continuas, al estilo de los modelos de afecto:
 *
 *    valencia  -1..1  que tan bien o mal se siente (contagiado del usuario)
 *    energia    0..1  cuanta cuerda le queda (se gasta hablando, se recupera durmiendo)
 *    animo      -1..1 promedio movil largo: su humor de base con esa persona
 *
 *  Sobre esas variables corre una MAQUINA DE ESTADOS que decide la emocion
 *  visible. Los eventos (cosquillas, un mimo, una sacudida, una ausencia
 *  larga, una frase triste) empujan las variables, y el estado se recalcula.
 *
 *  Contagio emocional: si el usuario escribe triste, el duende baja su
 *  valencia y responde distinto. No finge estar siempre feliz, porque un
 *  amigo que solo sabe estar feliz no acompana en diciembre.
 * ============================================================================
 */

const { all, get, run } = require('./db');

// ---------------------------------------------------------------------------
// Catalogo de emociones: como se ve, como suena y como habla
// ---------------------------------------------------------------------------
const EMOCIONES = {
  risa:      { cara: 'risa',      emoji: '\u{1F602}', tono: { pitch: 1.9, rate: 1.15 }, etiqueta: 'muerto de risa' },
  feliz:     { cara: 'feliz',     emoji: '\u{1F929}', tono: { pitch: 1.8, rate: 1.08 }, etiqueta: 'feliz' },
  contento:  { cara: 'contento',  emoji: '\u{1F60A}', tono: { pitch: 1.7, rate: 1.02 }, etiqueta: 'contento' },
  tierno:    { cara: 'tierno',    emoji: '\u{1F970}', tono: { pitch: 1.75, rate: 0.95 }, etiqueta: 'enternecido' },
  travieso:  { cara: 'travieso',  emoji: '\u{1F60F}', tono: { pitch: 1.85, rate: 1.12 }, etiqueta: 'travieso' },
  sorpresa:  { cara: 'sorpresa',  emoji: '\u{1F62E}', tono: { pitch: 1.95, rate: 1.1 },  etiqueta: 'sorprendido' },
  pensativo: { cara: 'pensativo', emoji: '\u{1F914}', tono: { pitch: 1.6, rate: 0.92 }, etiqueta: 'pensativo' },
  neutral:   { cara: 'neutral',   emoji: '\u{1F9DD}', tono: { pitch: 1.7, rate: 1.0 },  etiqueta: 'tranquilo' },
  cansado:   { cara: 'cansado',   emoji: '\u{1F62A}', tono: { pitch: 1.5, rate: 0.85 }, etiqueta: 'cansadito' },
  triste:    { cara: 'triste',    emoji: '\u{1F622}', tono: { pitch: 1.45, rate: 0.88 }, etiqueta: 'triste' },
  dormido:   { cara: 'dormido',   emoji: '\u{1F634}', tono: { pitch: 1.4, rate: 0.8 },  etiqueta: 'dormido' }
};

/** Frases con las que el duende delata su estado, sin que se lo pregunten. */
const FRASES = {
  risa: ['¡JAJAJA! \u{1F602} para, para, se me caen los cascabeles', 'Jijiji \u{1F606} ay, me da risa hasta el gorro'],
  feliz: ['¡Hoy ando feliz! \u{1F929}', 'Me tienes de buen humor \u{2728}'],
  contento: ['Ando contento \u{1F60A}', 'Todo bien por aquí \u{1F9DD}'],
  tierno: ['Ay... eso me llegó \u{1F970}', 'Qué bonito lo que dices \u{1F49B}'],
  travieso: ['\u{1F60F} se me ocurrió una travesura', 'Ja, mira lo que sé y no cuento \u{1F910}'],
  sorpresa: ['¡Ay! \u{1F62E} me asustaste', '¡Oye! \u{1F633} casi suelto el regalo'],
  pensativo: ['Mmm... dejame pensarlo \u{1F914}', 'Estoy atando cabos \u{1F9E9}'],
  neutral: ['Aquí estoy \u{1F9DD}', 'Te escucho \u{1F442}'],
  cansado: ['Uff, ya llevo muchos regalos hoy \u{1F62A}', 'Se me cierran los ojitos \u{1F634} pero sigo'],
  triste: ['Me puso sentimental eso \u{1F622}', 'Oye... un abrazo \u{1F917}'],
  dormido: ['Zzz... \u{1F634}', 'Zzz \u{1F4A4} (llamame y despierto)']
};

// ---------------------------------------------------------------------------
// Lectura y escritura del estado
// ---------------------------------------------------------------------------

const BASE = {
  estado: 'contento', energia: 1, valencia: 0.2, animo: 0.2,
  dormido: 0, callado: 0, interacciones: 0, cosquillas: 0, mimos: 0
};

async function crudo(usuarioId) {
  let f = await get('SELECT * FROM animo WHERE usuario_id = ?', [usuarioId]);
  if (!f) {
    await run(
      `INSERT INTO animo (usuario_id, estado, energia, valencia, animo) VALUES (?, ?, ?, ?, ?)`,
      [usuarioId, BASE.estado, BASE.energia, BASE.valencia, BASE.animo]
    );
    f = await get('SELECT * FROM animo WHERE usuario_id = ?', [usuarioId]);
  }
  return f || Object.assign({ usuario_id: usuarioId, visto: null }, BASE);
}

/** Minutos desde la ultima vez que se vieron. */
function minutosDesde(visto) {
  if (!visto) return 0;
  const t = new Date(String(visto).replace(' ', 'T') + 'Z').getTime();
  if (!t) return 0;
  return Math.max(0, (Date.now() - t) / 60000);
}

/**
 * Deja que el tiempo haga lo suyo antes de decidir nada:
 *   - durmiendo recupera energia rapido
 *   - despierto la recupera lento
 *   - el animo tiende al neutro si no hay noticias (nada dura para siempre)
 *   - una ausencia muy larga le da nostalgia
 */
function conElTiempo(f) {
  const min = minutosDesde(f.visto);
  let energia = Number(f.energia);
  let animo = Number(f.animo);
  const dormido = Number(f.dormido) ? 1 : 0;

  energia += min * (dormido ? 0.012 : 0.004);
  energia = Math.max(0, Math.min(1, energia));

  const horas = min / 60;
  animo *= Math.exp(-horas / 10);                       // regresa al neutro
  if (horas > 20 && !dormido) animo -= 0.18;            // te extrano
  animo = Math.max(-1, Math.min(1, animo));

  return { energia, animo, minutosAusente: min, dormido };
}

/**
 * LA MAQUINA DE ESTADOS. Orden de prioridad: primero lo que manda el usuario
 * (dormir), luego los eventos puntuales, luego el estado de fondo.
 */
function decidirEstado({ dormido, energia, valencia, animo, evento }) {
  if (dormido) return 'dormido';

  if (evento === 'cosquillas') return 'risa';
  if (evento === 'mimo') return 'tierno';
  if (evento === 'sacudida') return 'sorpresa';
  if (evento === 'travesura') return 'travieso';
  if (evento === 'pensando') return 'pensativo';

  if (energia < 0.22) return 'cansado';

  const mezcla = valencia * 0.6 + animo * 0.4;          // ahora pesa mas que el historico
  if (mezcla <= -0.45) return 'triste';
  if (mezcla <= -0.15) return 'pensativo';
  if (mezcla >= 0.6) return 'feliz';
  if (mezcla >= 0.2) return 'contento';
  return 'neutral';
}

/**
 * Registra lo que acaba de pasar y devuelve el estado resultante.
 *
 * @param {number} usuarioId
 * @param {object} opciones
 *   valencia    -1..1  sentimiento del mensaje del usuario (contagio)
 *   intensidad   0..1  cuanta fuerza tenia
 *   evento       cosquillas | mimo | sacudida | travesura | pensando | null
 *   costo        cuanta energia gasta este turno (por defecto 0.02)
 */
async function sentir(usuarioId, { valencia = 0, intensidad = 0.5, evento = null, costo = 0.02 } = {}) {
  const f = await crudo(usuarioId);
  const t = conElTiempo(f);

  let dormido = t.dormido;
  // los eventos fuertes lo despiertan solos
  if (dormido && (evento === 'cosquillas' || evento === 'sacudida')) dormido = 0;

  // contagio: la valencia del duende se acerca a la del usuario
  const peso = 0.3 + 0.4 * intensidad;
  let nuevaValencia = Number(f.valencia) * (1 - peso) + valencia * peso;
  if (evento === 'cosquillas') nuevaValencia = Math.max(nuevaValencia, 0.8);
  if (evento === 'mimo') nuevaValencia = Math.max(nuevaValencia, 0.55);
  nuevaValencia = Math.max(-1, Math.min(1, nuevaValencia));

  // animo: promedio movil lento, su humor de base con esta persona
  const animo = Math.max(-1, Math.min(1, t.animo * 0.9 + nuevaValencia * 0.1));

  const energia = Math.max(0, Math.min(1, t.energia - costo));

  const estado = decidirEstado({ dormido, energia, valencia: nuevaValencia, animo, evento });

  await run(
    `UPDATE animo SET estado = ?, energia = ?, valencia = ?, animo = ?, dormido = ?,
       interacciones = interacciones + 1,
       cosquillas = cosquillas + ?, mimos = mimos + ?,
       visto = datetime('now')
     WHERE usuario_id = ?`,
    [estado, energia, nuevaValencia, animo, dormido,
      evento === 'cosquillas' ? 1 : 0, evento === 'mimo' ? 1 : 0, usuarioId]
  );

  return armar({ ...f, estado, energia, valencia: nuevaValencia, animo, dormido, callado: f.callado }, t.minutosAusente);
}

/** Solo consultar, sin registrar interaccion. */
async function estado(usuarioId) {
  const f = await crudo(usuarioId);
  const t = conElTiempo(f);
  const est = decidirEstado({
    dormido: t.dormido, energia: t.energia, valencia: Number(f.valencia), animo: t.animo, evento: null
  });
  return armar({ ...f, estado: est, energia: t.energia, animo: t.animo, dormido: t.dormido }, t.minutosAusente);
}

function armar(f, minutosAusente) {
  const nombre = EMOCIONES[f.estado] ? f.estado : 'neutral';
  const e = EMOCIONES[nombre];
  return {
    estado: nombre,
    cara: e.cara,
    emoji: e.emoji,
    tono: e.tono,
    etiqueta: e.etiqueta,
    frase: FRASES[nombre] ? FRASES[nombre][Math.floor(Math.random() * FRASES[nombre].length)] : null,
    energia: Number(Number(f.energia).toFixed(3)),
    valencia: Number(Number(f.valencia).toFixed(3)),
    animo: Number(Number(f.animo).toFixed(3)),
    dormido: !!Number(f.dormido),
    callado: !!Number(f.callado),
    interacciones: Number(f.interacciones || 0),
    cosquillas: Number(f.cosquillas || 0),
    mimos: Number(f.mimos || 0),
    minutosAusente: Math.round(minutosAusente || 0)
  };
}

// ---------------------------------------------------------------------------
// Ordenes directas
// ---------------------------------------------------------------------------

async function dormir(usuarioId) {
  await crudo(usuarioId);
  await run("UPDATE animo SET dormido = 1, estado = 'dormido', visto = datetime('now') WHERE usuario_id = ?", [usuarioId]);
  return estado(usuarioId);
}

async function despertar(usuarioId) {
  await crudo(usuarioId);
  // despierta con energia renovada y de buen humor
  await run(
    "UPDATE animo SET dormido = 0, estado = 'contento', energia = MIN(1, energia + 0.35), visto = datetime('now') WHERE usuario_id = ?",
    [usuarioId]
  );
  return estado(usuarioId);
}

async function callar(usuarioId, callado = true) {
  await crudo(usuarioId);
  await run('UPDATE animo SET callado = ? WHERE usuario_id = ?', [callado ? 1 : 0, usuarioId]);
  return estado(usuarioId);
}

/** Cuantas veces le han hecho cosquillas/mimos: para los logros del chat. */
async function historialDe(usuarioId) {
  const f = await crudo(usuarioId);
  return {
    interacciones: Number(f.interacciones || 0),
    cosquillas: Number(f.cosquillas || 0),
    mimos: Number(f.mimos || 0)
  };
}

module.exports = { EMOCIONES, FRASES, sentir, estado, dormir, despertar, callar, historialDe };
