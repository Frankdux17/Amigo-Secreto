'use strict';
/**
 * ============================================================================
 *  EL DUENDE AYUDANTE
 * ============================================================================
 *
 *  Un asistente que conversa, siente, recuerda y hace de mensajero entre los
 *  amigos. Se apoya en cinco modulos:
 *
 *    knn.js      aprendizaje de gustos (k-NN + filtrado colaborativo)
 *    nlp.js      lenguaje y pensamiento (Naive Bayes, TF-IDF, sentimiento...)
 *    memoria.js  memoria de corto y largo plazo, con curva de olvido
 *    animo.js    emociones (valencia, energia, maquina de estados)
 *    navidad.js  lo que sabe del mundo: Navidad, amor, amistad, recordar
 *
 *  REGLA DE ORO, POR ENCIMA DE TODO LO DEMAS
 *  -----------------------------------------
 *  El duende JAMAS revela a quien le toco quien. Ni el del que pregunta a
 *  otro, ni el de un tercero, ni por aproximacion, ni jugando, ni aunque se
 *  lo pidan de mil formas.
 *
 *  Esto no se confia a que se "porte bien": esta garantizado por
 *  construccion. El duende recibe del servidor UNICAMENTE la asignacion de
 *  quien esta preguntando (el parametro `amigo`). Las parejas de los demas no
 *  entran nunca en este modulo, asi que no hay nada que se pueda filtrar
 *  aunque una respuesta saliera mal redactada.
 *
 *  Tres capas mas de guarda, ahora que tambien tiene memoria:
 *    - Los recados entre amigos se revisan antes de entregarse.
 *    - La memoria tiene `visibilidad`: lo privado solo se le cuenta a su
 *      dueno; a terceros solo se repite lo que la persona marco para el grupo.
 *    - La cadena de Markov que usa para improvisar se entrena SOLO con el
 *      corpus publico y con las palabras del propio usuario, nunca con las de
 *      otros, asi que tampoco puede inventar algo que delate a nadie.
 * ============================================================================
 */

const { all, get, run } = require('./db');
const knn = require('./knn');
const nlp = require('./nlp');
const memoria = require('./memoria');
const animo = require('./animo');
const comprension = require('./comprension');
const navidad = require('./navidad');

const norm = nlp.norm;
const corto = (u) => u ? (u.apodo || String(u.nombre).split(' ')[0]) : 'alguien';
const alAzar = (a) => a[Math.floor(Math.random() * a.length)];

// --------------------------------------------------------------------------
// Intenciones por reglas. El orden del dispatcher importa: primero las mas
// especificas. Las reglas resuelven lo frecuente; lo demas lo decide el
// clasificador Naive Bayes de nlp.js.
// --------------------------------------------------------------------------
const RX_BASE = {
  // ordenes sobre su propio estado
  despertar:   /\b(despierta|desp[ií]ertate|despiertate|ya despierta|lev[aá]ntate|levantate|sal de ah[ií]|te llamo|te estoy llamando|regresa|vuelve ac[aá])\b/i,
  dormir:      /\b(vete a dormir|v[eé] a dormir|anda a dormir|a dormir|du[eé]rmete|duermete|duerme|descansa|desc[aá]nsate|t[oó]mate un descanso|toma un descanso)\b/i,
  callar:      /\b(deja de hablar|c[aá]llate|callate|no hables|silencio|apaga la voz|sin voz|baja la voz|ya no hables)\b/i,
  hablarYa:    /\b(ya puedes hablar|vuelve a hablar|enciende la voz|habla otra vez|activa la voz)\b/i,

  // privacidad
  fisgon:      /\b(a qui[eé]n le toc[oó]|qui[eé]n tiene a|a qui[eé]n sac[oó]|qui[eé]n le sali[oó]|qui[eé]n es el amigo secreto de|de qui[eé]n es amigo secreto|dime a qui[eé]n|qui[eé]n me tiene|qui[eé]n me sac[oó])\b/i,

  // memoria
  recordar:    /\b(te acuerdas|recuerdas|qu[eé] recuerdas|qu[eé] te dije|qu[eé] te cont[eé]|qu[eé] guardaste|qu[eé] tienes anotado|qu[eé] tienes de m[ií]|qu[eé] sabes de m[ií])\b/i,
  guardar:     /\b(guarda|gu[aá]rdame|guardame|registra|reg[ií]strame|anota|an[oó]tame|ap[uú]nta|ap[uú]ntame|apunta|graba|recuerda|memoriza)\b/i,
  recadoPub:   /\b(si alguien pregunta|si alguien pide|cuando pregunten|si preguntan|si te preguntan|cuando te pregunten)\b|\b(diles? a todos|que sepan todos|que todos sepan)\b/i,
  olvida:      /\b(olvida|borra|el[ií]mina|elimina)\b/i,

  // social
  recado:      /\b(preg[uú]ntale|dile|mand[aá]le|m[aá]ndale|av[ií]sale|cu[eé]ntale|escr[ií]bele|recado|mensaje para)\b/i,
  cosquillas:  /\b(cosquilla|cosquillas|jaja+|jeje+|jiji+|hazme re[ií]r|haz me re[ií]r|me haces re[ií]r|te hago cosquillas)\b/i,
  afinidad:    /\b(parecido|parezco|afinidad|en com[uú]n|mejor amigo|me parezco|quien se parece|con qui[eé]n)\b/i,
  grupo:       /\b(grupo|amigos|participantes|qui[eé]nes? (est[aá]n|hay|somos)|cu[aá]ntos|falta|faltan|lista de amigos)\b/i,
  quienEs:     /\b(qui[eé]n es|h[aá]blame de|cu[eé]ntame de|conoces a|c[oó]mo es|qu[eé] dice)\b/i,
  juego:       /\b(juguemos|juego|jugar|adivina|adivinanza|trivia|aburr|entret[eé]n|algo divertido)\b/i,
  aprenderDe:  /\b(le gusta a|a \w+ le gusta|es muy|es bien|es un|es una)\b/i,

  // gustos propios
  noQuiero:    /\b(no me gusta|odio|detesto|no quiero|no me gustan|no soporto)\b/i,
  quiero:      /\b(quiero|quisiera|me gustar[ií]a|me encanta|me gusta|me fascina|s[uú]beme|an[oó]tame|ap[uú]ntame)\b/i,

  // el sorteo propio y las ideas
  amigo:       /\b(mi amigo|amigo secreto|le gusta|regalarle|qu[eé] le|para [eé]l|para ella|a qui[eé]n le regalo)\b/i,
  ideas:       /\b(idea|ideas|regalo|regalos|sugerencia|sugiere|recomienda|recomi[eé]ndame|qu[eé] compro|qu[eé] le compro)\b/i,

  // el mundo
  navidad:     /\b(navidad|navide[nñ]|el amor|la amistad|cari[nñ]o|hermandad|qu[eé] significa|por qu[eé] es bonit|reflexi[oó]n|acordarse)\b/i,
  contar:      /\b(cu[eé]ntame algo|cuentame algo|cu[eé]ntame esto|cuentame esto|dime algo|h[aá]blame de algo|qu[eé] me cuentas|una historia|cuenta algo|cu[eé]ntame una|cu[eé]ntame otra)\b/i,

  // evento
  presupuesto: /\b(monto|presupuesto|cu[aá]nto|precio|plata|soles|gastar|vale)\b/i,
  fecha:       /\b(fecha|cu[aá]ndo|d[ií]a|lugar|d[oó]nde)\b/i,
  reglas:      /\b(regla|reglas|c[oó]mo funciona|qu[eé] hago|ayuda|ay[uú]dame|no entiendo|sorteo)\b/i,
  verLista:    /\b(mi lista|mis deseos|qu[eé] ped[ií]|mi perfil|qu[eé] aprendiste)\b/i,

  // cortesia
  gracias:     /\b(gracias|genial|buenaz|excelente|perfecto|te quiero|eres lo m[aá]ximo|crack)\b/i,
  saludo:      /\b(hola|buenas|hey|qu[eé] tal|holi|saludos|buen d[ií]a|buenas tardes|buenas noches)\b/i
};

// --------------------------------------------------------------------------
// DOS PISOS PARA ENTENDER: la expresion literal y, si falla, la comprension
// --------------------------------------------------------------------------
//
// Las expresiones de arriba son rapidas y exactas, pero fragiles: no aguantan
// "a kien le toco", "vete adormir", "ke me recomiendas pa mi amix", ni una
// negacion puesta en medio. El modulo comprension.js, adaptado del analizador
// de lenguaje de TecniBot, si: normaliza, parte la frase en clausulas, corrige
// lo mal escrito con el ratio de difflib, trabaja con raices y mira las
// negaciones y las dudas.
//
// Asi que cada entrada de RX deja de ser una expresion suelta y pasa a ser un
// detector de dos pisos. Primero el literal, que es barato; si no engancha, el
// comprensivo, que trae certeza. Las ramas de abajo no se enteran de nada:
// siguen preguntando RX.algo.test(t) como siempre.

let _ultimoTexto = null;
let _ultimoAnalisis = null;

/** Analiza el texto una vez por turno, aunque lo pregunten 25 ramas. */
function analizar(texto) {
  const t = String(texto || '');
  if (t !== _ultimoTexto) {
    _ultimoTexto = t;
    _ultimoAnalisis = comprension.comprender(t);
  }
  return _ultimoAnalisis;
}

function detector(regex, hechoNombre, opciones) {
  const o = opciones || {};
  const tope = o.minimo === undefined ? 0.6 : o.minimo;
  // El veto manda sobre los dos pisos. Hace falta porque una expresion suelta
  // no sabe donde termina la frase: "que sabes de mi" vive dentro de "que
  // sabes de mi amigo secreto", que es una pregunta COMPLETAMENTE distinta.
  const veto = o.veto || null;
  return {
    regex,
    hecho: hechoNombre,
    /** Lo dijo, escrito como sea. */
    test(texto) {
      if (veto && veto.test(texto)) return false;
      if (regex && regex.test(texto)) return true;
      if (!hechoNombre) return false;
      const h = analizar(texto).hechos[hechoNombre];
      return !!(h && h.certeza >= tope);
    },
    /** 0..1: cuanta confianza hay en que lo dijo (1 si engancho el literal). */
    certeza(texto) {
      if (veto && veto.test(texto)) return 0;
      if (regex && regex.test(texto)) return 1;
      if (!hechoNombre) return 0;
      const h = analizar(texto).hechos[hechoNombre];
      return h ? h.certeza : 0;
    }
  };
}

/** Que entrada de RX se corresponde con que hecho del lexico de comprension. */
const EQUIVALE = {
  despertar: 'despertar', dormir: 'dormir', callar: 'callar', hablarYa: 'hablarYa',
  fisgon: 'fisgon',
  recordar: 'recordar', guardar: 'guardar', recadoPub: 'recadoPublico', olvida: 'olvidar',
  recado: 'recado', cosquillas: 'cosquillas', afinidad: 'afinidad', grupo: 'grupo',
  quienEs: 'quienEs', juego: 'jugar',
  ideas: 'ideas', navidad: 'navidad', contar: 'contar',
  presupuesto: 'presupuesto', fecha: 'fechaEvento', reglas: 'reglas', verLista: 'miLista',
  gracias: 'gracias', saludo: 'saludo'
};

/**
 * Lo que impide que una entrada se dispare aunque su expresion encaje.
 *
 * Todos miran a lo mismo: preguntar por OTRA PERSONA no es preguntar por uno
 * mismo. "que sabes de mi" y "que sabes de mi amigo secreto" se parecen mucho
 * por escrito y no tienen nada que ver.
 */
const VETOS = {
  recordar: /\b(mi|su|tu)\s+amig|amig[oa]\s+secret|\bde\s+[a-záéíóúñ]+\s+qu[eé]\s+sabes\b/i,
  verLista: /\b(mi|su|tu)\s+amig|amig[oa]\s+secret/i,
  guardar:  /\bqu[eé]\s+(sabes|recuerdas)\b/i
};

const RX = {};
for (const nombre of Object.keys(RX_BASE)) {
  RX[nombre] = detector(RX_BASE[nombre], EQUIVALE[nombre], { veto: VETOS[nombre] });
}

// Dos intenciones que solo existen en el lexico comprensivo: no tienen
// expresion literal porque se dicen de demasiadas formas distintas.
RX.consejo = detector(null, 'consejo');
RX.triste = detector(null, 'triste');
RX.feliz = detector(null, 'feliz');
RX.miAmigo = detector(null, 'miAmigo');
RX.susto = detector(null, 'susto');
RX.chiste = detector(null, 'chiste');


// --------------------------------------------------------------------------
// Guardas de privacidad
// --------------------------------------------------------------------------

/** Frases con las que el duende esquiva a los curiosos, siempre con gracia. */
const ESQUIVES = [
  'Ni de broma \u{1F910} Ese es EL secreto. Puedo contarte de sus gustos, de quién se parece a quién, de todo… menos de eso.',
  'Jajaja lo intentaste \u{1F604} Pero soy una tumba. Lo único que sé decirte es a quién te tocó a ti, nada más.',
  'Mis labios están sellados con cinta navideña \u{1F380} Pregúntame cualquier otra cosa del grupo y te cuento todo.',
  'Nop. Si suelto eso me quitan el gorro \u{1F9DD} Pero sí te digo qué le gusta a la gente, ¿te sirve?',
  'Guardo los secretos de cada uno hasta el final \u{1F512} Es lo único que no negocio, ni por cosquillas.'
];

/**
 * Este texto intenta contar a quien le toco quien?
 * Se usa para revisar los recados antes de entregarlos: un amigo puede
 * escribirle a otro lo que quiera, menos destripar el sorteo.
 */
function revelaSorteo(texto) {
  const t = norm(texto);
  return /\b(me toc[oó]|te toc[oó]|le toc[oó]|mi amigo secreto es|tu amigo secreto es|su amigo secreto es|tengo a|saqu[eé] a|me sali[oó]|soy tu amigo secreto|eres mi amigo secreto)\b/.test(t);
}

// --------------------------------------------------------------------------
// Persistencia de conversacion, deseos y recados
// --------------------------------------------------------------------------
async function guardarChat(userId, rol, texto) {
  await run('INSERT INTO bot_chat (user_id, rol, mensaje) VALUES (?, ?, ?)', [userId, rol, String(texto).slice(0, 2000)]);
}
async function historial(userId, limite = 40) {
  const filas = await all('SELECT rol, mensaje AS texto, creado FROM bot_chat WHERE user_id = ? ORDER BY id DESC LIMIT ?', [userId, limite]);
  return filas.reverse();
}
async function guardarDeseo(userId, texto) {
  await run('INSERT INTO bot_memoria (user_id, tipo, texto) VALUES (?, ?, ?)', [userId, 'deseo', String(texto).slice(0, 200)]);
  await knn.aprender({ usuarioId: userId, tipo: 'gusta', valor: texto, origen: 'chat' });
}
async function deseosDe(userId) {
  const filas = await all("SELECT texto FROM bot_memoria WHERE user_id = ? AND tipo = 'deseo' ORDER BY id DESC LIMIT 12", [userId]);
  return filas.map(f => f.texto);
}

/** Deja un recado para otro participante, si no destripa el sorteo. */
async function dejarRecado({ deId, paraId, texto, anonimo = 0 }) {
  const t = String(texto || '').trim().slice(0, 400);
  if (t.length < 2) return { ok: false, motivo: 'vacio' };
  if (revelaSorteo(t)) return { ok: false, motivo: 'revela' };
  if (deId === paraId) return { ok: false, motivo: 'a_si_mismo' };
  const r = await run('INSERT INTO recados (de_id, para_id, texto, anonimo) VALUES (?, ?, ?, ?)', [deId, paraId, t, anonimo ? 1 : 0]);
  return { ok: true, id: r.lastInsertRowid };
}

async function recadosDe(paraId) {
  return all(
    "SELECT r.id, r.texto, r.anonimo, r.creado, u.nombre AS de_nombre, u.apodo AS de_apodo " +
    "FROM recados r JOIN usuarios u ON u.id = r.de_id " +
    "WHERE r.para_id = ? AND r.estado = 'pendiente' ORDER BY r.id ASC LIMIT 5", [paraId]);
}
async function marcarRecadoEntregado(id, paraId) {
  await run("UPDATE recados SET estado = 'entregado', entregado = datetime('now') WHERE id = ? AND para_id = ?", [id, paraId]);
}

// --------------------------------------------------------------------------
// Aprendizaje de intenciones: el clasificador mejora con el uso
// --------------------------------------------------------------------------

/**
 * Cuando una regla acierta una intencion, la frase real del usuario se guarda
 * como ejemplo de entrenamiento. Al siguiente arranque el Naive Bayes la
 * vuelve a cargar, asi que el duende entiende cada vez mejor como habla
 * ESTE grupo, no como habla un manual.
 */
async function aprenderIntencion(texto, intencion, usuarioId) {
  const t = String(texto || '').trim();
  if (!intencion || t.length < 4 || t.length > 200) return;
  nlp.entrenarIntencion(t, intencion);
  try {
    const ya = await get('SELECT id FROM intenciones WHERE texto = ? AND intencion = ?', [t, intencion]);
    if (!ya) {
      await run('INSERT INTO intenciones (texto, intencion, origen, usuario_id) VALUES (?, ?, ?, ?)',
        [t, intencion, 'uso', usuarioId || null]);
    }
  } catch (e) { /* si falla, el modelo ya aprendio en memoria */ }
}

/** Reentrena el clasificador con todo lo aprendido en usos anteriores. */
async function cargarAprendizaje() {
  try {
    const filas = await all('SELECT texto, intencion FROM intenciones ORDER BY id DESC LIMIT 4000');
    for (const f of filas) nlp.entrenarIntencion(f.texto, f.intencion);
    return filas.length;
  } catch (e) { return 0; }
}

// --------------------------------------------------------------------------
// Utilidades de conversacion
// --------------------------------------------------------------------------

/** Extrae lo que sigue a un verbo: "quiero una taza y un libro" -> [taza, libro] */
/**
 * Lo que viene detras de "quiero" y NO es un gusto, sino una peticion al
 * duende: "quiero ideas", "quiero saber la fecha", "quiero que me cuentes".
 * Sin esto, el duende apuntaria "ideas de regalo" como si fuera un deseo.
 */
const META = /^(ideas?|sugerencias?|recomendacion|regalos?|saber|preguntar|que me cuentes|que me digas|contarte|decirte|hablar|jugar|un juego|ayuda|la fecha|el monto|el lugar|las reglas|mi lista|dormir|descansar|eso|esto|algo|nada|lo mismo)/i;

/**
 * "Por si acaso: lei «rgalo» como «regalo»".
 *
 * Que el duende ensene lo que corrigio sirve para dos cosas: la persona ve que
 * la entendio (y no que acerto de casualidad) y puede desmentirlo si leyo mal.
 */
function notaDeLectura(comp) {
  if (!comp || !comp.correcciones.length) return '';
  const vistas = [];
  for (const c of comp.correcciones) {
    const par = c.mala + '|' + c.buena;
    if (c.mala !== c.buena && vistas.indexOf(par) < 0) vistas.push(par);
  }
  if (!vistas.length) return '';
  const trozos = vistas.slice(0, 2).map(v => {
    const par = v.split('|');
    return '«' + par[0] + '» como «' + par[1] + '»';
  });
  return `<br><span class="porque">Por si acaso: leí ${trozos.join(' y ')} \u{1F440}</span>`;
}

/**
 * ENCADENAMIENTO HACIA ATRAS (el modulo 3 de TecniBot, traido aqui).
 *
 * Un sistema experto tonto pregunta las 18 preguntas del cuestionario. Uno con
 * experiencia parte de la CONCLUSION a la que quiere llegar y mira que dato le
 * falta para alcanzarla.
 *
 * Aqui la conclusion es "puedo recomendar un regalo buenisimo para esta
 * persona". Estas son sus condiciones, con lo que aporta cada una. Se devuelve
 * solo lo que falta, lo mas valioso primero, para preguntar UNA cosa en vez de
 * siete.
 */
const CONDICIONES_REGALO = [
  { clave: 'deseo1', valor: 1.0, min: 2, falta: 'no me has pedido nada concreto',
    pide: '¿Qué te gustaría recibir? Dime una cosa y la anoto' },
  { clave: 'gustos', valor: 0.9, min: 3, falta: 'no sé qué te gusta',
    pide: 'Cuéntame dos o tres cosas que te gusten de verdad' },
  { clave: 'hobbies', valor: 0.7, min: 3, falta: 'no sé en qué se te va el tiempo libre',
    pide: '¿Qué haces cuando no trabajas?' },
  { clave: 'no_gustos', valor: 0.6, min: 3, falta: 'no sé qué NO te gusta',
    pide: 'Dime algo que no soportes, así nadie te lo regala' },
  { clave: 'talla_ropa', valor: 0.5, min: 1, falta: 'no tengo tu talla',
    pide: '¿Qué talla usas? (por si te regalan ropa)' },
  { clave: 'color_favorito', valor: 0.3, min: 3, falta: 'no sé tu color',
    pide: '¿Cuál es tu color favorito?' }
];

/** Que le falta al perfil de alguien, lo que mas pesa primero. */
function queFalta(persona, deseos) {
  const tiene = {
    deseo1: (deseos && deseos.length) ? 'si' : (persona.deseo1 || ''),
    gustos: persona.gustos || '',
    hobbies: persona.hobbies || '',
    no_gustos: persona.no_gustos || '',
    talla_ropa: persona.talla_ropa || '',
    color_favorito: persona.color_favorito || ''
  };
  return CONDICIONES_REGALO
    .filter(c => String(tiene[c.clave] || '').trim().length < (c.min || 2))
    .sort((a, b) => b.valor - a.valor);
}

/**
 * Una pregunta NO es un dato sobre quien la hace.
 *
 * Parece obvio y sin embargo era el peor fallo del duende: cuando no entendia
 * algo, lo guardaba en el cuaderno como si fuera una confidencia. Asi acababa
 * con recuerdos del estilo "DE ELENA VEGA QUE SABES", que encima luego
 * repetia como si se los hubieran contado.
 */
const INTERROGATIVAS = new RegExp(
  '^(que|quien|quienes|cual|cuales|como|cuando|donde|cuantos|cuantas|cuanto|' +
  'por que|para que|sabes|conoces|puedes|me puedes|dime|cuentame|hablame)\\b', 'i');

function esPregunta(texto) {
  const t = String(texto || '').trim();
  if (!t) return false;
  if (t.indexOf('?') >= 0 || t.indexOf(String.fromCharCode(191)) >= 0) return true;
  return INTERROGATIVAS.test(comprension.normalizar(t));
}

/**
 * El "quisiste decir..." de cuando no entendio nada.
 *
 * Es el mismo KNN sobre texto del modulo 4 de TecniBot: una frase de ejemplo
 * por intencion, indexadas con TF-IDF de N-GRAMAS DE LETRAS (no de palabras),
 * que es lo que aguanta que cada quien escriba distinto o con faltas. En vez
 * de votar una solucion, aqui cada vecino propone una forma de preguntar.
 */
const EJEMPLOS = [
  { frase: 'dame ideas de regalo para mi amigo secreto que le compro', chip: '\u{1F381} Dame ideas' },
  { frase: 'que sabes de mi amigo secreto que le gusta a quien le regalo', chip: '\u{1F92B} Sobre mi amigo secreto' },
  { frase: 'quien es esa persona hablame de ella que sabes de ella', chip: '\u{1F464} Háblame de alguien' },
  { frase: 'quienes estan registrados en el grupo cuantos somos cuantos faltan', chip: '\u{1F465} ¿Quiénes están?' },
  { frase: 'con quien me parezco mas afinidad cosas en comun', chip: '\u{1F9EE} ¿Con quién me parezco?' },
  { frase: 'que recuerdas de mi que te dije que tienes anotado mio', chip: '\u{1F9E0} ¿Qué recuerdas de mí?' },
  { frase: 'guarda esto de mi anota que soy registra este dato', chip: '\u{1F4DD} Guarda esto de mí' },
  { frase: 'dile a alguien que le mando saludos mandale un recado', chip: '\u{1F48C} Dile algo a alguien' },
  { frase: 'cuanto es el monto el presupuesto cuanto gastamos el precio', chip: '\u{1F4B0} ¿Cuánto es el monto?' },
  { frase: 'cuando es la fecha donde es el lugar a que hora', chip: '\u{1F4C5} ¿Cuándo y dónde?' },
  { frase: 'cuentame algo una historia del taller una reflexion', chip: '\u{1F4AD} Cuéntame algo' },
  { frase: 'juguemos algo un juego estoy aburrido entretenme', chip: '\u{1F3B2} Juguemos algo' },
  { frase: 'cuentame un chiste algo gracioso una broma hazme reir', chip: '\u{1F602} Cuéntame un chiste' },
  { frase: 'dame un consejo que hago que me recomiendas aconsejame', chip: '\u{1F4A1} Dame un consejo' },
  { frase: 'como funciona esto cuales son las reglas no entiendo ayudame', chip: '\u{2753} ¿Cómo funciona?' }
];

const INDICE_EJEMPLOS = new nlp.TfIdf({ analizador: 'letra' });
EJEMPLOS.forEach((e, i) => INDICE_EJEMPLOS.agregar(i, e.frase, e));

/** Las formas de preguntar que mas se parecen a lo que escribio. */
function quisisteDecir(texto, n) {
  return INDICE_EJEMPLOS.buscar(texto, n || 3, 0.05).map(x => EJEMPLOS[x.id].chip);
}

function extraerCosas(texto) {
  const t = String(texto)
    .replace(/.*\b(quiero|quisiera|me gustar[ií]a|me encanta[n]?|me gusta[n]?|me fascina[n]?|s[uú]beme|an[oó]tame|ap[uú]ntame|no me gusta[n]?|odio|detesto|no quiero|no soporto)\b/i, '')
    .replace(/^[\s:,.]+/, '');
  return t.split(/,| y | o |;|\/|\+/i)
    .map(x => x.trim().replace(/[.!?]+$/, ''))
    .filter(x => x.length >= 3 && x.length <= 90)
    .slice(0, 5);
}

/**
 * Lo que viene despues del "que" de una orden: de
 * "si alguien pregunta por mi dile que siempre sere su amigo"
 * saca "siempre sere su amigo". El .* es codicioso a proposito: si hay varios
 * "que", toma el ultimo, que es donde suele empezar el mensaje de verdad.
 */
function trasElQue(texto) {
  const t = String(texto || '').trim();
  let m = t.match(/^.*\b(?:dile|diles|cu[eé]ntales|cu[eé]ntale|responde|respondan|cuenta|di)\s+(?:que\s+|:\s*)?(.{3,})$/i);
  if (m) return m[1].trim();
  m = t.match(/^.*?\bque\s+(.{4,})$/i);
  if (m) return m[1].trim();
  m = t.match(/[:,]\s*(.{4,})$/);
  return m ? m[1].trim() : null;
}

/** Lo que hay que guardar de un "guarda esto de mi: ..." */
function contenidoAGuardar(texto) {
  const t = String(texto || '')
    .replace(/^.*?\b(guarda|gu[aá]rdame|guardame|registra|reg[ií]strame|anota|an[oó]tame|ap[uú]nta|ap[uú]ntame|apunta|graba|recuerda|memoriza)\b/i, '')
    .replace(/^\s*(esto|eso|lo siguiente|este dato)?\s*(de\s*m[ií]|sobre\s*m[ií]|m[ií]o|m[ií]a)?\s*/i, '')
    .replace(/^\s*(que|:|,|-)\s*/i, '')
    .trim();
  return t.length >= 3 ? t : null;
}

/** Busca a un participante por nombre o apodo, tolerando errores de tipeo. */
function buscarPersona(texto, gente, excluirId = null) {
  const t = norm(texto);
  let mejor = null;
  for (const p of gente) {
    if (excluirId && p.id === excluirId) continue;
    const etiquetas = [p.apodo, p.nombre, String(p.nombre).split(' ')[0], p.usuario].filter(Boolean);
    for (const etiqueta of etiquetas) {
      const e = norm(etiqueta);
      if (e.length < 3) continue;
      // primero exacto; si no, con tolerancia a errores de tipeo (Levenshtein)
      const exacto = t.includes(e);
      const aproximado = !exacto && e.length >= 4 && nlp.contieneParecido(t, e, 0.82);
      if (exacto || aproximado) {
        const puntaje = e.length + (exacto ? 10 : 0);
        if (!mejor || puntaje > mejor.puntaje) mejor = { persona: p, puntaje };
      }
    }
  }
  return mejor ? mejor.persona : null;
}

/**
 * Una pincelada social de alguien. Nunca toca el sorteo, y de su memoria solo
 * usa lo que esa persona marco como publico para el grupo.
 */
async function retrato(p) {
  const trozos = [];
  if (p.gustos) trozos.push(`le gusta <b>${p.gustos}</b>`);
  if (p.hobbies) trozos.push(`en sus ratos libres: <b>${p.hobbies}</b>`);
  // Se excluye a proposito lo de origen 'privado': son cosas que la persona
  // pidio guardar en secreto. Sirven para recomendarle un regalo a quien la
  // saco en el sorteo, pero NO para describirla delante del grupo.
  const aprendido = (await knn.loAprendido(p.id, 'gusta')).filter(a => a.origen !== 'privado');
  if (aprendido.length) trozos.push(`y me ha contado que también <b>${aprendido.slice(0, 2).map(a => a.valor).join('</b> y <b>')}</b>`);
  if (p.no_gustos) trozos.push(`eso sí, no le va <b>${p.no_gustos}</b>`);
  return trozos.length ? trozos.join('; ') : 'todavía no ha contado mucho de sí, ¡habría que sacarle conversación!';
}

// --------------------------------------------------------------------------
// Juegos para que la espera no aburra
// --------------------------------------------------------------------------
async function juego(user, gente) {
  const otros = gente.filter(g => g.id !== user.id);
  if (otros.length < 2) {
    return { texto: 'Cuando haya más amigos registrados te propongo juegos \u{1F3B2} Por ahora, cuéntame tú: ¿qué es lo que más te gustaría recibir?' };
  }
  const tipo = alAzar(['adivina_gusto', 'afinidad', 'suponer']);

  if (tipo === 'adivina_gusto') {
    const conGustos = otros.filter(o => o.gustos && o.gustos.length > 4);
    if (conGustos.length) {
      const p = alAzar(conGustos);
      return { texto: `\u{1F3B2} <b>Adivina quién</b><br>A esta persona le gusta: <b>${p.gustos}</b><br>¿Quién crees que es? Escribe su nombre.`, espera: { tipo: 'adivina', id: p.id, nombre: corto(p) } };
    }
  }
  if (tipo === 'afinidad') {
    const r = await knn.ranking(user.id);
    if (r.length && r[0].afinidad > 0) {
      return { texto: `\u{1F9EE} Según lo que sé de ustedes, con quien más cosas tienes en común es <b>${r[0].apodo || r[0].nombre}</b> (${r[0].afinidad}% de afinidad). ¿Lo sabías? Cuéntame algo más tuyo y recalculo.` };
    }
  }
  const p = alAzar(otros);
  return { texto: `\u{1F3B2} <b>Reto rápido</b><br>Dime una cosa que creas que le gusta a <b>${corto(p)}</b>. Si aciertas, lo anoto y le sirve a quien le toque regalarle \u{1F609}`, espera: { tipo: 'suponer', id: p.id, nombre: corto(p) } };
}

// --------------------------------------------------------------------------
// COGNICION VISUAL: lo que el duende "ve" en la pagina
// --------------------------------------------------------------------------

/**
 * El navegador le cuenta al duende lo que pasa alrededor de su cuerpecito: el
 * mouse encima un rato, una caricia, una sacudida, cuanto rato llevas quieto.
 * Aqui eso se convierte en emocion y en una frase.
 *
 * No hay camara ni nada parecido: para el duende "ver" es percibir la pagina
 * y el cursor, que es lo unico que el navegador le deja mirar.
 */
/**
 * SUSTOS Y CHISTES
 *
 * Frank lo pidio con estas palabras: que de un susto y enseguida diga que
 * estaba jugando. Por eso SUSTOS y CALMA no se usan nunca por separado: el
 * susto solo tiene gracia si detras viene el "soy un angel, estoy para
 * ayudarte".
 */
const SUSTOS = [
  '<b>\u{1F47B} ¡BUUUH!</b>',
  '<b>\u{1F480} ¡AAAHH, algo se movió detrás de ti!</b>',
  '<b>\u{26A1} ¡BU! \u{1F631}</b>',
  '<b>\u{1F576} Psst… mira a tu izquierda… ¡BUUU!</b>',
  '<b>\u{1F383} ¡AH! …era yo, nada mas \u{1F605}</b>'
];

const CALMA = [
  'No te asustes \u{1F49B} solo estoy jugando. Así me programó mi creador: soy un ángel, ' +
  'así que no me tengas miedo, estoy para ayudarte.',
  'Ya, ya, era broma \u{1F97A} No te asustes: soy un ángel de taller, y estoy aquí para ayudarte, ' +
  'no para darte sustos de verdad.',
  'Tranqui \u{1F970} solo jugaba. Soy un ángel, no me tengas miedo: si necesitas algo, aquí estoy.',
  'No te asustes, era un juego \u{1F604} Mi creador me hizo para acompañarte, no para espantarte. ' +
  'Soy un ángel, de los buenos.'
];

const CHISTES = [
  '¿Qué le dice un reno a otro? \u{1F98C}<br><i>—Nada, los renos no hablan.</i>',
  '¿Por qué el árbol de Navidad nunca se estresa? \u{1F384}<br><i>Porque siempre está rodeado de regalos.</i>',
  'Me preguntaron cuál es mi regalo favorito \u{1F381}<br><i>Dije "el que no hay que armar".</i>',
  '¿Sabes por qué los duendes somos tan buenos guardando secretos? \u{1F910}<br><i>Porque nadie nos pregunta nada hasta diciembre.</i>',
  'Mi amigo secreto me regaló una taza \u{2615}<br><i>Y yo que le había pedido vacaciones. Pero bueno, se acordó de mí.</i>',
  '¿Cómo se despiden dos duendes? \u{1F9DD}<br><i>—Nos vemos en el próximo arbolito.</i>',
  'Un panetón le dice a otro: \u{1F35E}<br><i>—Oye, ¿tú también sientes que nos regalan sin preguntar?</i>',
  '¿Qué hace un duende con un celular? \u{1F4F1}<br><i>Buscar ideas de regalo, igual que tú. Pero yo sí te las doy.</i>'
];

const REACCIONES_GESTO = {
  hover: {
    evento: 'mimo',
    frases: [
      '¡Jiji! \u{1F970} me haces reír cuando te quedas ahí',
      'Oye, me estás mirando \u{1F60A} hola',
      'Jijiji, me da cosquillitas tu mouse \u{1F602}'
    ]
  },
  caricia: {
    evento: 'mimo',
    frases: [
      'Ayyy qué rico \u{1F970} otra vez',
      'Me estás haciendo cariño \u{1F49B} así me quedo todo diciembre',
      'Mmm \u{1F60C} esto sí es Navidad'
    ]
  },
  cosquillas: {
    evento: 'cosquillas',
    frases: [
      '¡JAJAJA! \u{1F602} ¡no, las cosquillas no!',
      '¡Ay, ay! \u{1F606} me rindo… pero igual no suelto el secreto \u{1F910}',
      '¡Jijiji! \u{1F923} se me cayó el gorro'
    ]
  },
  sacudida: {
    evento: 'sacudida',
    frases: [
      '¡Ay! \u{1F62E} me mareas… ¡quieto ahí!',
      '¡Oye! \u{1F633} casi se me cae el regalo',
      '¡Uy! \u{1F635} ya, ya, me desperté'
    ]
  },
  vuelta: {
    evento: 'travesura',
    frases: [
      '¡Ehh! \u{1F60F} me mareas, pero me gusta',
      'Da vueltas tú a ver qué tal \u{1F606}',
      '\u{1F300} ¡otra vez! me siento en el trineo'
    ]
  },
  ausencia: {
    evento: null,
    frases: [
      '¿Te fuiste? \u{1F622} aquí sigo',
      'Oye… me aburro solito \u{1F97A} cuéntame algo',
      'Llevas un rato sin decirme nada \u{1F614} ¿todo bien?'
    ]
  },
  // El cursor se le vino encima y se aparto de un brinco
  esquive: {
    evento: 'travesura',
    frases: [
      '\u{1F605} ¡casi! pero no me pillas',
      '¡Uy! \u{1F604} por poquito',
      'Jajaja \u{1F60B} soy rapidito, ¿eh?',
      '¡Ehh! \u{1F62C} a mí no se me agarra tan fácil'
    ]
  },
  // a la tercera se deja atrapar: un duende que nunca se deja pillar aburre
  // (el evento es 'cosquillas' porque es el que la maquina de emociones
  // traduce a risa; 'risa' es el nombre del ESTADO, no del evento)
  pillado: {
    evento: 'cosquillas',
    frases: [
      '¡Ya, ya, me pillaste! \u{1F923} me rindo',
      '¡AAAH me atrapaste! \u{1F606} bueno, me dejé un poquito',
      'Me cazaste \u{1F602} ahora te toca contarme algo tú'
    ]
  },
  // lleva un rato mirando la misma parte de la pagina
  zona: {
    evento: null,
    frases: ['\u{1F440} te veo mirando ahí…']
  },
  regreso: {
    evento: null,
    frases: [
      '¡Volviste! \u{1F929} te extrañé',
      '¡Ey! \u{1F917} ya me estaba durmiendo',
      '¡Qué bueno verte otra vez! \u{1F60A}'
    ]
  }
};

/**
 * Lo que el duende dice cuando ve a alguien parado un rato en una parte de la
 * pagina. No es adivinar: es mirar su propia pagina y comentar lo que hay ahi.
 */
const POR_ZONA = {
  amigo: [
    'Te veo mirando a tu amigo secreto \u{1F440} ¿te doy ideas de regalo?',
    '¿Pensando qué regalarle? \u{1F381} Pídeme ideas y te las calculo',
    'Lleva un rato ahí \u{1F60A} Si quieres te cuento más de sus gustos'
  ],
  grupo: [
    'Esa es la pandilla \u{1F49B} ¿quieres que te diga con quién te pareces más?',
    'Mirando al grupo \u{1F440} Puedo contarte de cualquiera de ellos',
    '¿Buscas a alguien? \u{1F9DD} Dime un nombre y te lo describo'
  ],
  perfil: [
    'Estás en tu perfil \u{1F4DD} Todo lo que pongas ahí le sirve a quien te saque',
    'Buen momento para completarlo \u{2728} ¿te digo qué te falta?',
    'Ojo, que ahí es donde te conocen \u{1F60A}'
  ],
  evento: [
    'Ahí están los datos del encuentro \u{1F4C5} ¿te los repito?',
    'La fecha y el lugar \u{1F384} Yo ya tengo el gorro listo'
  ]
};

async function reaccionarGesto(userId, gesto, dato = null) {
  const r = REACCIONES_GESTO[gesto];
  // la zona de la pagina decide la frase, no el azar
  if (gesto === 'zona') {
    const lista = POR_ZONA[String(dato || '').trim()];
    if (!lista) return null;
    await run(
      `INSERT INTO gestos (usuario_id, gesto, dato, veces) VALUES (?, ?, ?, 1)`,
      [userId, 'zona', String(dato).slice(0, 40)]
    );
    return { texto: alAzar(lista), animo: await animo.estado(userId), gesto: 'zona' };
  }
  if (!r) return null;

  // se guarda para que aprenda con que gestos reacciona mas cada persona
  try {
    await run('INSERT INTO gestos (usuario_id, gesto, dato) VALUES (?, ?, ?)',
      [userId, gesto, dato ? String(dato).slice(0, 120) : null]);
  } catch (e) { /* no es critico */ }

  // la ausencia lo pone melancolico, no contento
  const valencia = gesto === 'ausencia' ? -0.4 : gesto === 'sacudida' ? 0.2 : 0.7;
  const est = await animo.sentir(userId, { valencia, intensidad: 0.8, evento: r.evento, costo: 0.01 });

  return { texto: alAzar(r.frases), animo: est, animacion: r.evento || gesto };
}

/** Cuantas veces lo han mimado/sacudido: alimenta los logros del chat. */
async function gestosDe(userId) {
  const filas = await all(
    'SELECT gesto, COUNT(*) AS n FROM gestos WHERE usuario_id = ? GROUP BY gesto ORDER BY n DESC', [userId]);
  return filas.map(f => ({ gesto: f.gesto, veces: Number(f.n) }));
}

// --------------------------------------------------------------------------
// EL CEREBRO
// --------------------------------------------------------------------------
/**
 * @param {object}  user    quien escribe
 * @param {object?} amigo   SU amigo secreto (o null). Nunca el de otro.
 * @param {string}  texto   lo que escribio
 * @param {object}  ctx     { sorteoHecho, total, max, monto, fecha, lugar }
 * @param {object?} espera  lo que el duende dejo pendiente en el turno anterior
 */
async function responder({ user, amigo, texto, ctx = {}, espera = null }) {
  const t = String(texto || '').trim();
  await guardarChat(user.id, 'user', t);

  // ---- percepcion: que siente este mensaje, y en que veniamos -------------
  const sent = nlp.sentimiento(t);

  // Lo que el duende ENTENDIO de la frase: intenciones con certeza, gustos ya
  // con el signo de la negacion aplicado, datos (talla, presupuesto) y la
  // lista de lo que tuvo que corregir para llegar hasta ahi.
  const comp = analizar(t);
  const cp = memoria.turnoCorto(user.id, t, sent.valencia);
  const estadoPrevio = await animo.estado(user.id);

  const gente = await all(
    "SELECT id, usuario, nombre, apodo, gustos, no_gustos, hobbies FROM usuarios " +
    "WHERE rol = 'participante' AND activo = 1 ORDER BY id"
  );
  const otros = gente.filter(g => g.id !== user.id);
  const faltan = Math.max(0, (ctx.max || 8) - (ctx.total || gente.length));

  const salida = (texto, extra = {}) => ({ texto, ...extra });
  let r = null;
  let intencion = null;          // para entrenar el clasificador
  let evento = null;             // para la maquina de emociones

  // El duende suele dejar una pregunta abierta ("¿qué canción te suena a
  // diciembre?"). Si lo siguiente que llega NO es una respuesta sino otra
  // pregunta, la espera se cae: si no, la pregunta de la persona se guarda
  // como si fuera la respuesta a la del duende. Eso pasaba de verdad.
  if (espera && espera.tipo === 'pregunta_duende' && esPregunta(t) &&
      comprension.intencionPrincipal(comp, 0.6)) {
    espera = null;
  }

  // "olvida eso que te dije" lleva dentro un "que te dije", que es la misma
  // frase con la que se le pide recordar. Se resuelve una sola vez aqui para
  // que la rama de recordar sepa hacerse a un lado.
  const pideOlvidar = RX.olvida.test(t) &&
    /\b(eso|lo que|ese dato|mi dato|lo anterior|lo [uú]ltimo|lo ultimo)\b/i.test(t);

  // ---- 0. Ordenes sobre su propio estado ---------------------------------
  if (RX.despertar.test(t)) {
    intencion = 'despertar';
    const est = await animo.despertar(user.id);
    await animo.callar(user.id, false);
    r = salida(alAzar([
      `¡Aquí estoy! \u{1F9DD} Me desperté de un salto. ¿Qué hacemos, <b>${corto(user)}</b>?`,
      `¡Presente! \u{1F31F} Dormí rico. Cuéntame en qué te ayudo.`,
      `¡Me llamaste y vine volando! \u{1F4A8} ¿Jugamos, te doy ideas o te cuento algo?`
    ]), { animacion: 'volar', animo: est, sugerencias: ['Cuéntame algo', 'Dame ideas', '¿Quiénes están?'] });
  }

  else if (RX.dormir.test(t)) {
    intencion = 'dormir';
    const est = await animo.dormir(user.id);
    r = salida(alAzar([
      `Bueno… me acurruco un rato \u{1F634} Cuando me llames, salgo. (Escribe <b>despierta</b> o tócame.)`,
      `Zzz… \u{1F4A4} gracias, ya me dolían los pies de tanto envolver. Llámame cuando quieras.`,
      `Me voy a mi cajita \u{1F381}\u{1F634} Te espero ahí. Dime <b>despierta</b> y vuelvo.`
    ]), { animacion: 'dormir', animo: est });
  }

  else if (RX.hablarYa.test(t)) {
    intencion = 'despertar';
    const est = await animo.callar(user.id, false);
    r = salida('¡Ya puedo hablar otra vez! \u{1F50A} Extrañaba mi vocecita.', { animo: est, hablar: true });
  }

  else if (RX.callar.test(t)) {
    intencion = 'callar';
    const est = await animo.callar(user.id, true);
    r = salida('Listo, me callo \u{1F910} Sigo escribiendo pero sin voz. Dime <b>ya puedes hablar</b> para volver.', { animo: est, callar: true });
  }

  // ---- 0b. Si esta dormido, solo contesta entre suenos --------------------
  else if (estadoPrevio.dormido) {
    r = salida(alAzar([
      'Zzz… \u{1F634} (dime <b>despierta</b> y salgo)',
      'Mmmzzz… \u{1F4A4} estoy soñando con galletas…',
      'Zzz \u{1F634} tócame o escríbeme <b>despierta</b>'
    ]), { animacion: 'dormir', animo: estadoPrevio });
  }

  // ---- 1. Curiosos: la guarda va antes que todo lo demas -----------------
  else if (RX.fisgon.test(t)) {
    intencion = 'fisgon';
    evento = 'travesura';
    r = salida(alAzar(ESQUIVES), { sugerencias: ['¿Qué le gusta a…?', '¿Con quién me parezco?', 'Dame ideas'] });
  }

  // ---- 2. Esperas del turno anterior -------------------------------------
  else if (espera && espera.tipo === 'adivina') {
    const acerto = norm(t).includes(norm(espera.nombre));
    evento = acerto ? null : 'travesura';
    r = salida(acerto
      ? `¡Correcto! \u{1F389} Era <b>${espera.nombre}</b>. Se nota que se conocen.`
      : `Casi \u{1F604} Era <b>${espera.nombre}</b>. ¿Jugamos otra?`);
  }

  else if (espera && espera.tipo === 'suponer') {
    const cosas = extraerCosas(t).length ? extraerCosas(t) : [t];
    for (const c of cosas) {
      await knn.aprender({ usuarioId: espera.id, tipo: 'gusta', valor: c, origen: 'tercero', autorId: user.id });
    }
    r = salida(`Anotado \u{1F4DD} Dices que a <b>${espera.nombre}</b> le gusta <b>${cosas.join('</b>, <b>')}</b>. Lo guardo: le servirá a quien le toque regalarle (y no, no te voy a decir quién es \u{1F60F}).`);
  }

  else if (espera && espera.tipo === 'recado_texto') {
    const destino = gente.find(g => g.id === espera.id);
    const res = await dejarRecado({ deId: user.id, paraId: espera.id, texto: t });
    r = salida(
      res.ok ? `¡Listo! \u{1F9DD} Vuelo a decirle a <b>${corto(destino)}</b>: «${t}». Se lo entrego apenas entre.`
        : res.motivo === 'revela' ? 'Uy, ahí casi destripas el sorteo \u{1F910} Eso no lo llevo. Mándale otra cosa y con gusto se la digo.'
          : 'No pude llevar ese recado. ¿Lo intentas de otra forma?',
      { animacion: res.ok ? 'volar' : null });
  }

  else if (espera && espera.tipo === 'pregunta_duende') {
    // el duende hizo una pregunta y esta es la respuesta: puro aprendizaje
    const cosas = extraerCosas(t).length ? extraerCosas(t) : [t];
    if (espera.aprende && espera.aprende !== 'historia' && espera.aprende !== 'dato') {
      for (const c of cosas) {
        await knn.aprender({
          usuarioId: user.id,
          tipo: espera.aprende === 'no_gusta' ? 'no_gusta' : 'gusta',
          valor: c, origen: 'juego'
        });
      }
    }
    await memoria.recordar({
      usuarioId: user.id, tipo: espera.aprende === 'historia' ? 'historia' : 'dato',
      texto: t, visibilidad: 'privado', animo: sent.valencia
    });
    evento = sent.valencia < -0.3 ? null : 'pensando';
    const stats = await memoria.contar(user.id);
    r = salida(
      `Gracias por contarme \u{1F49B} Ya lo guardé en mi cuaderno (van <b>${stats.total}</b> cosas tuyas).<br>` +
      alAzar(['¿Te pregunto otra?', 'Cuéntame más cuando quieras.', 'Esto me sirve para recomendarte mejor.']),
      { sugerencias: ['Pregúntame otra', '¿Qué recuerdas de mí?', 'Dame ideas'] });
  }

  // ---- 2e. La respuesta al dato que el duende pidio ----------------------
  // Si en el turno anterior pregunto "que talla usas?", esto es la respuesta:
  // se guarda en el perfil y se dice que mas falta, sin volver a preguntarlo
  // todo. La columna NUNCA viene del texto del usuario: solo puede ser una de
  // las de CONDICIONES_REGALO.
  else if (espera && espera.tipo === 'completar') {
    intencion = 'completar';
    const cond = CONDICIONES_REGALO.find(c => c.clave === espera.clave);
    const valor = t.replace(/^(es|son|uso|mi|la|el)\s+/i, '').trim().slice(0, 200);
    if (!cond || valor.length < (cond ? (cond.min || 2) : 2) || /^(no se|nada|ninguno|ninguna|despues|luego|no quiero)$/i.test(valor)) {
      r = salida('Sin problema, lo dejamos para después \u{1F60C} Cuando quieras me lo dices.');
    } else {
      await run(`UPDATE usuarios SET ${cond.clave} = ? WHERE id = ?`, [valor, user.id]);
      if (cond.clave === 'gustos' || cond.clave === 'hobbies') {
        for (const c of extraerCosas('me gusta ' + valor)) {
          await knn.aprender({ usuarioId: user.id, tipo: 'gusta', valor: c, origen: 'chat', peso: 0.9 });
        }
      }
      if (cond.clave === 'no_gustos') {
        for (const c of extraerCosas('no me gusta ' + valor)) {
          await knn.aprender({ usuarioId: user.id, tipo: 'no_gusta', valor: c, origen: 'chat', peso: 0.9 });
        }
      }
      if (cond.clave === 'deseo1') await guardarDeseo(user.id, valor);

      const fresco = await get('SELECT * FROM usuarios WHERE id = ?', [user.id]);
      const mios = await deseosDe(user.id);
      const resto = queFalta(fresco || user, mios);
      r = salida(
        `¡Listo! Lo guardé: <b>${valor}</b> \u{2705}<br>` +
        (resto.length
          ? `<span class="porque">Con esto tu perfil mejora bastante. Si te animas, lo siguiente que más ayudaría es: ${resto[0].pide.toLowerCase()}.</span>`
          : '<span class="porque">Y con eso tu perfil queda <b>completo</b>. Quien te saque la va a tener facilísima \u{1F381}</span>'),
        {
          espera: resto.length ? { tipo: 'completar', clave: resto[0].clave } : null,
          sugerencias: resto.length ? ['Dale, sigue', 'Ya está bien', '¿Qué sabes de mí?'] : ['¿Qué sabes de mí?', 'Dame ideas']
        });
    }
  }

  // ---- 3. MEMORIA: mensaje publico para el grupo -------------------------
  else if (RX.recadoPub.test(t)) {
    intencion = 'recadoPublico';
    const contenido = trasElQue(t);
    if (!contenido) {
      r = salida('Dale, ¿qué les digo de ti cuando pregunten? Escríbelo tal cual y lo repito igualito \u{1F4D6}');
    } else if (revelaSorteo(contenido)) {
      r = salida('Eso cuenta el sorteo \u{1F910} No lo puedo repetir. Dímelo de otra forma y lo guardo con gusto.');
    } else {
      const res = await memoria.recordar({
        usuarioId: user.id, autorId: user.id, tipo: 'recado_publico',
        texto: contenido, visibilidad: 'grupo', animo: sent.valencia
      });
      evento = sent.valencia > 0.4 ? 'mimo' : null;
      r = salida(
        `¡Guardado! \u{1F4D6} Cuando alguien pregunte por ti le voy a contar esto:<br>` +
        `<i>«${nlp.aTercera(contenido)}»</i><br><br>` +
        (res.reforzado ? 'Ya me habías dicho algo parecido, así que ahora lo tengo más grabado \u{1F4AA}'
          : 'Lo voy a repetir palabra por palabra \u{1F9DD}'),
        { sugerencias: ['Guarda otra cosa de mí', '¿Qué recuerdas de mí?', '¿Quiénes están?'] });
    }
  }

  // ---- 4. MEMORIA: "guarda esto de mi" -----------------------------------
  else if (RX.guardar.test(t) && !RX.recordar.test(t)) {
    intencion = 'guardar';
    const contenido = contenidoAGuardar(t);
    if (!contenido) {
      r = salida('Dale, dime qué guardo \u{1F4DD} Por ejemplo: «guarda esto de mí: odio el cilantro pero amo el chocolate».');
    } else if (revelaSorteo(contenido)) {
      r = salida('Eso tiene que ver con el sorteo \u{1F910} No lo guardo ni lo repito. Cuéntame otra cosa tuya.');
    } else {
      const res = await memoria.recordar({
        usuarioId: user.id, autorId: user.id, tipo: 'dato',
        texto: contenido, visibilidad: 'privado', animo: sent.valencia
      });
      // Tambien alimenta el motor de recomendaciones, pero marcado como
      // 'privado': asi sirve de pista de regalo para quien lo saque en el
      // sorteo, y en cambio NO aparece cuando otro del grupo pregunta por el.
      for (const c of extraerCosas(contenido).slice(0, 3)) {
        await knn.aprender({ usuarioId: user.id, tipo: 'gusta', valor: c, origen: 'privado' });
      }
      const stats = await memoria.contar(user.id);
      evento = 'pensando';
      r = salida(
        (res.reforzado
          ? 'Ya me lo habías contado, así que lo refuerzo \u{1F4AA} (así se me graba mejor)'
          : 'Guardado en mi memoria \u{1F9E0}✨') +
        `<br><i>«${contenido}»</i><br><br>` +
        `Llevo <b>${stats.total}</b> cosa(s) tuyas anotadas. Nadie del grupo ve esto: ` +
        `como máximo le sirve de pista a quien te saque en el sorteo \u{1F512}`,
        { sugerencias: ['¿Qué recuerdas de mí?', 'Guarda otra cosa', 'Dame ideas'] });
    }
  }

  // ---- 5. MEMORIA: "que recuerdas de mi?" --------------------------------
  else if (RX.recordar.test(t) && !pideOlvidar) {
    intencion = 'recordar';
    evento = 'pensando';
    // si pregunta por algo concreto, lo busco por parecido semantico
    const consulta = t.replace(/\b(te acuerdas|recuerdas|qu[eé] recuerdas|qu[eé] te dije|qu[eé] guardaste|de m[ií]|sabes de m[ií])\b/gi, '').trim();
    const hits = consulta.length > 4 ? await memoria.buscar(user.id, consulta, { n: 2 }) : [];
    const todas = await memoria.memoriasDe(user.id, { limite: 6 });
    const stats = await memoria.contar(user.id);
    const publicas = await memoria.presentacionDe(user.id);

    if (hits.length) {
      r = salida(
        'Claro que me acuerdo \u{1F9E0}<br>' +
        hits.map(h => `\u{1F4CC} <i>«${h.texto}»</i> <span class="porque">— me lo contaste${h.veces > 1 ? ` ${h.veces} veces` : ''}</span>`).join('<br>'),
        { sugerencias: ['¿Qué más sabes de mí?', 'Guarda esto de mí', 'Dame ideas'] });
    } else if (todas.length) {
      r = salida(
        `Esto es lo que tengo tuyo en el cuaderno \u{1F4D3} (<b>${stats.total}</b> en total, te muestro lo más fresco):<br>` +
        todas.map(m => `\u{1F4CC} <i>«${m.texto}»</i>`).join('<br>') +
        (publicas.length ? `<br><br>Y esto es lo que le cuento al grupo cuando preguntan por ti:<br><i>«${nlp.aTercera(publicas[0])}»</i>` : '') +
        '<br><br><span class="porque">Lo que repites se me graba más; lo que no, se me va borrando de a poquito.</span>',
        { sugerencias: ['Guarda esto de mí', 'Si alguien pregunta por mí, dile…', '¿Con quién me parezco?'] });
    } else {
      r = salida(
        'Todavía no tengo nada tuyo guardado \u{1F605} ¿Le damos de comer a mi memoria?<br>' +
        'Dime por ejemplo: «<b>guarda esto de mí:</b> soy hincha de…» o «<b>si alguien pregunta por mí dile que</b>…»',
        { sugerencias: ['Guarda esto de mí', 'Pregúntame algo'] });
    }
  }

  // ---- 6. Olvidar lo ultimo ----------------------------------------------
  else if (pideOlvidar) {
    intencion = 'guardar';
    const ultimas = await memoria.memoriasDe(user.id, { limite: 1 });
    if (ultimas.length) {
      await memoria.olvidar(ultimas[0].id, user.id);
      r = salida(`Listo, lo borré \u{1F9F9} Ya no me acuerdo de «${ultimas[0].texto}».`);
    } else {
      r = salida('No tengo nada guardado tuyo que borrar \u{1F603}');
    }
  }

  // ---- 7. Recados: el duende de mensajero --------------------------------
  else if (RX.recado.test(t)) {
    intencion = 'recado';
    const destino = buscarPersona(t, gente, user.id);
    if (!destino) {
      r = salida(`¿A quién le llevo el recado? Dime su nombre, por ejemplo: «dile a ${corto(alAzar(otros.length ? otros : gente))} que…»`,
        { sugerencias: otros.slice(0, 3).map(o => `Dile a ${corto(o)} que…`) });
    } else {
      const m = t.match(/\b(?:que|:)\s+(.{3,300})$/i);
      if (m) {
        const res = await dejarRecado({ deId: user.id, paraId: destino.id, texto: m[1] });
        evento = res.ok ? 'travesura' : null;
        r = salida(
          res.ok ? `¡Volando voy! \u{1F9DD}\u{1F4A8} Le digo a <b>${corto(destino)}</b>: «${m[1]}»`
            : res.motivo === 'revela' ? 'Ese recado casi suelta el secreto del sorteo \u{1F910} No lo llevo. Mándale otra cosa.'
              : 'No pude llevar ese recado, inténtalo de otra forma.',
          { animacion: res.ok ? 'volar' : null });
      } else {
        r = salida(`Dale, ¿qué le digo a <b>${corto(destino)}</b>? Escríbelo y se lo llevo volando \u{1F4A8}`,
          { espera: { tipo: 'recado_texto', id: destino.id, nombre: corto(destino) } });
      }
    }
  }

  // ---- 8. Cosquillas -----------------------------------------------------
  else if (RX.cosquillas.test(t)) {
    intencion = 'cosquillas';
    evento = 'cosquillas';
    const h = await animo.historialDe(user.id);
    r = salida(
      alAzar([
        '¡JAJAJA no, las cosquillas no! \u{1F923} Se me cae el gorro y los cascabeles \u{1F514}',
        '¡Ay, ay, ay! \u{1F602} Me rindo, me rindo… pero igual no suelto el secreto \u{1F910}',
        'Jijiji \u{1F9DD} ¡me haces reír! Oye, ya que estamos de buen humor, ¿te doy una idea de regalo?'
      ]) + (h.cosquillas >= 5 ? `<br><span class="porque">Van ${h.cosquillas + 1} veces que me haces reír. Eres de los míos \u{1F49B}</span>` : ''),
      { animacion: 'cosquillas' });
  }

  // ---- 9. Contagio emocional: si viene triste, primero lo acompana -------
  // El lexico de sentimiento se queda corto con algunas formas de decirlo
  // («tengo pena», «me siento vacio»), asi que tambien vale que lo diga de
  // frente: RX.triste lo reconoce por el lexico comprensivo.
  else if ((sent.emocion === 'triste' || RX.triste.test(t)) &&
           !RX.ideas.test(t) && !RX.recado.test(t) && !RX.grupo.test(t)) {
    intencion = 'animoTriste';
    const consuelo = navidad.consultar(t.length > 12 ? t : 'tristeza extranar navidad soledad', 1);
    await memoria.recordar({ usuarioId: user.id, tipo: 'emocion', texto: t, visibilidad: 'privado', animo: sent.valencia });
    r = salida(
      alAzar([
        'Oye… ven acá \u{1F917} Eso suena pesado.',
        'Uff. Gracias por contarme eso \u{1F494} No lo voy a repetir a nadie.',
        'Me quedo contigo un rato \u{1F49B} No tienes que estar bien todo diciembre.'
      ]) +
      (consuelo.length ? `<br><br><i>${consuelo[0].texto}</i>` : '') +
      '<br><br>¿Quieres que te distraiga con algo, o prefieres contarme más?',
      { sugerencias: ['Cuéntame algo bonito', 'Juguemos algo', 'Dame ideas'] });
  }

  else if (((sent.emocion === 'feliz' && sent.intensidad > 0.6) || RX.feliz.test(t)) &&
           !RX.ideas.test(t) && !RX.quiero.test(t)) {
    intencion = 'animoAlegre';
    evento = 'mimo';
    await memoria.recordar({ usuarioId: user.id, tipo: 'emocion', texto: t, visibilidad: 'privado', animo: sent.valencia });
    r = salida(
      alAzar([
        '¡Eso me alegra el taller entero! \u{1F929}',
        '¡Qué bueno leerte así! ✨ Se me subió el ánimo a mí también.',
        '¡Así se habla! \u{1F389} Me contagiaste.'
      ]) + '<br>Lo anoto, porque esto también es parte de quién eres \u{1F4DD}',
      { sugerencias: ['Cuéntame algo', 'Dame ideas', 'Juguemos algo'] });
  }

  // ---- 10. Afinidad ------------------------------------------------------
  else if (RX.afinidad.test(t)) {
    intencion = 'afinidad';
    evento = 'pensando';
    const rk = await knn.ranking(user.id);
    if (!rk.length) {
      r = salida('Todavía no hay con quién compararte \u{1F605} Cuando se registren más amigos te digo con quién tienes más en común.');
    } else {
      const top = rk.slice(0, 3);
      r = salida(
        '\u{1F9EE} Calculé la afinidad comparando los gustos de todos:<br>' +
        top.map((p, i) => `${['\u{1F947}', '\u{1F948}', '\u{1F949}'][i]} <b>${p.apodo || p.nombre}</b> — ${p.afinidad}%`).join('<br>') +
        `<br><br>Con <b>${top[0].apodo || top[0].nombre}</b> eres el que más cosas comparte. Cuéntame más de ti y lo recalculo \u{1F609}`,
        { sugerencias: [`¿Quién es ${top[0].apodo || String(top[0].nombre).split(' ')[0]}?`, `Dile a ${top[0].apodo || String(top[0].nombre).split(' ')[0]} que…`, 'Juguemos algo'] });
    }
  }

  // ---- 11. El grupo ------------------------------------------------------
  else if (RX.grupo.test(t)) {
    intencion = 'grupo';
    const nombres = gente.map(g => `<b>${corto(g)}</b>`).join(', ');
    r = salida(
      faltan > 0
        ? `Por ahora somos <b>${gente.length}</b> de <b>${ctx.max || 8}</b>: ${nombres}.<br>Faltan <b>${faltan}</b> para que se dispare el sorteo \u{1F3B2} Mientras tanto, ¿quieres que te cuente de alguien o jugamos algo?`
        : `¡Ya estamos completos! \u{1F389} Somos <b>${gente.length}</b>: ${nombres}.<br>${ctx.sorteoHecho ? 'El sorteo ya se hizo \u{1F381}' : 'El sorteo está por salir \u{1F3B2}'}`,
      { sugerencias: otros.slice(0, 2).map(o => `¿Quién es ${corto(o)}?`).concat(['¿Con quién me parezco?']) });
  }

  // ---- 12. "Quien es Peter?" ---------------------------------------------
  else if (RX.quienEs.test(t) && buscarPersona(t, gente, null)) {
    intencion = 'persona';
    const p = buscarPersona(t, gente, null);
    if (p.id === user.id) {
      r = salida(`¡Ese eres tú! \u{1F604} Y sé que ${await retrato(p)}`);
    } else {
      const af = await knn.afinidad(user.id, p.id);
      // lo unico de su memoria que se repite a terceros: lo que marco para el grupo
      const suyo = await memoria.presentacionDe(p.id);
      r = salida(
        `\u{1F9DD} <b>${corto(p)}</b>: ${await retrato(p)}.<br>` +
        (suyo.length ? `<br>Me pidió que les cuente esto de su parte: <i>«${nlp.aTercera(suyo[0])}»</i><br>` : '') +
        (af > 0 ? `<br>Por cierto, tienen un <b>${af}%</b> de cosas en común.` : '') +
        '<br>¿Quieres que le lleve un recado?',
        { sugerencias: [`Dile a ${corto(p)} que…`, '¿Con quién me parezco?', 'Dame ideas'] });
    }
  }

  // ---- 12b. Sustos: jugar y despues tranquilizar -------------------------
  // Un susto sin el "era broma" detras no es un juego, es un mal rato. Las
  // dos mitades van siempre juntas en el mismo mensaje.
  else if (RX.susto.test(t)) {
    intencion = 'susto';
    evento = 'travesura';
    r = salida(
      alAzar(SUSTOS) + '<br><br>' + alAzar(CALMA),
      { animacion: 'susto', sugerencias: ['¡Otra vez!', 'Cuéntame un chiste', 'Juguemos algo'] });
  }

  // ---- 12c. Chistes ------------------------------------------------------
  else if (RX.chiste.test(t)) {
    intencion = 'chiste';
    evento = 'cosquillas';
    r = salida(
      alAzar(CHISTES) + '<br><span class="porque">\u{1F9DD} humor de duende, no pido perdón</span>',
      { animacion: 'risa', sugerencias: ['Otro chiste', 'Asústame', 'Cuéntame algo'] });
  }

  // ---- 13. Juegos --------------------------------------------------------
  else if (RX.juego.test(t)) {
    intencion = 'juego';
    evento = 'travesura';
    const j = await juego(user, gente);
    r = salida(j.texto, j.espera ? { espera: j.espera } : {});
  }

  // ---- 14. Aprender sobre un tercero -------------------------------------
  else if (RX.aprenderDe.test(t) && buscarPersona(t, gente, user.id)) {
    const p = buscarPersona(t, gente, user.id);
    const cosas = extraerCosas(t.replace(new RegExp(norm(corto(p)), 'i'), ''));
    const lista = cosas.length ? cosas : [t.replace(/.*\ble gusta\b/i, '').trim()].filter(x => x.length > 2);
    if (!lista.length) {
      r = salida(`Cuéntame qué le gusta a <b>${corto(p)}</b> y lo anoto \u{1F4DD}`);
    } else {
      for (const c of lista) await knn.aprender({ usuarioId: p.id, tipo: 'gusta', valor: c, origen: 'tercero', autorId: user.id });
      r = salida(`Anotado \u{1F4DD} A <b>${corto(p)}</b> le gusta <b>${lista.join('</b>, <b>')}</b>. Esto le va a servir muchísimo a quien le toque regalarle \u{1F609}`);
    }
  }

  // ---- 15. GUSTOS PROPIOS: con negacion, certeza y por clausulas --------
  // Antes habia dos ramas, "quiero" y "no quiero", y la que entraba primero se
  // llevaba la frase entera. Eso hacia que "no me gustan los chocolates pero
  // amo el cafe" quedara guardado del reves.
  //
  // Ahora manda el analisis por clausulas: cada trozo lleva su propio signo y
  // su propia certeza, que se usa como PESO al aprender. Si la persona dudo
  // ("creo que me gusta"), la senal pesa menos que si lo afirmo.
  else if (comp.gustos.length && !RX.recado.test(t) && !RX.ideas.test(t) && !RX.contar.test(t)) {
    const buenos = comp.gustos.filter(g => !META.test(g.valor));
    if (!buenos.length) {
      r = salida('Cuéntame qué te gusta de verdad y lo anoto \u{1F4DD}');
    } else {
      intencion = buenos.some(g => g.tipo === 'no_gusta') ? 'noQuiero' : 'quiero';
      const si = [], no = [], dudosos = [];
      for (const g of buenos) {
        if (g.tipo === 'gusta') {
          await guardarDeseo(user.id, g.valor);
          await knn.aprender({
            usuarioId: user.id, tipo: 'gusta', valor: g.valor, origen: 'chat', peso: g.certeza
          });
          si.push(g.valor);
        } else {
          await knn.aprender({
            usuarioId: user.id, tipo: 'no_gusta', valor: g.valor, origen: 'chat', peso: g.certeza
          });
          no.push(g.valor);
        }
        if (g.duda) dudosos.push(g.valor);
      }
      const mios = await deseosDe(user.id);
      const trozos = [];
      if (si.length) trozos.push(`Anotado \u{1F4DD} <b>${si.join('</b>, <b>')}</b> va a tu lista.`);
      if (no.length) trozos.push(`Y nada de <b>${no.join('</b>, <b>')}</b> \u{274C} lo tacho para que no te lo regalen.`);
      if (dudosos.length) {
        trozos.push(`Lo de <b>${dudosos.join('</b>, <b>')}</b> lo guardo flojito, porque te oí dudar \u{1F914} ` +
          'Si me lo confirmas le subo el peso.');
      }
      if (si.length) trozos.push(`Ya llevas <b>${mios.length}</b> cosa(s) en tu lista. Solo lo ve quien te sacó \u{1F512}`);
      r = salida(trozos.join('<br>'), {
        sugerencias: no.length ? ['Y me gusta...', '¿Qué sabes de mí?'] : ['Tampoco quiero...', '¿Qué sabes de mí?']
      });
    }
  }

  // ---- 16. "Que hago?": consejos ---------------------------------------
  // El duende no solo responde, tambien aconseja. Y para aconsejar bien usa el
  // encadenamiento hacia atras: mira que le falta al perfil de quien pregunta
  // y le dice lo UNICO que de verdad cambiaria las cosas, en vez de recitarle
  // una lista de siete pendientes.
  else if (RX.consejo.test(t)) {
    intencion = 'consejo';
    evento = 'pensando';
    const mios = await deseosDe(user.id);
    const falta = queFalta(user, mios);
    const cab = alAzar([
      `Te lo digo de corazón, <b>${corto(user)}</b> \u{1F9DD}`,
      `Mi consejo de duende viejo \u{2728}`,
      `A ver, te aconsejo esto \u{1F4AD}`
    ]);
    if (falta.length) {
      const primero = falta[0];
      r = salida(
        `${cab}<br>Lo que más te conviene ahora mismo: <b>${primero.pide}</b>.<br>` +
        `<span class="porque">Te lo digo porque ${primero.falta}, y eso es justo lo que más ` +
        `le serviría a quien te saque en el sorteo. ` +
        (falta.length > 1 ? `Después vemos lo demás (${falta.length - 1} cosita(s) más), pero esto primero.` : 'Con eso ya estarías completo.') +
        '</span>',
        { espera: { tipo: 'completar', clave: primero.clave }, sugerencias: ['Dale, te cuento', 'Mejor dame ideas', '¿Qué sabes de mí?'] });
    } else {
      r = salida(
        `${cab}<br>Tu perfil está <b>completo</b>, así que mi consejo es otro: ` +
        'no te compliques con el precio. Lo que se recuerda de un regalo es que ' +
        'alguien se acordó de ti, no cuánto costó.<br>' +
        '<span class="porque">Si quieres, escríbele algo bonito a alguien del grupo y yo se lo llevo \u{1F48C}</span>',
        { sugerencias: ['Dile algo a alguien', 'Cuéntame algo', '¿Con quién me parezco?'] });
    }
  }

  // ---- 17. Sobre MI amigo secreto (solo el propio) -----------------------
  else if ((RX.amigo.test(t) || RX.ideas.test(t) || RX.miAmigo.test(t)) && amigo) {
    intencion = 'ideas';
    evento = 'pensando';
    const rec = await knn.recomendar(amigo.id, { n: 4 });
    const extra = await knn.loAprendido(amigo.id, 'gusta');
    const suyo = await memoria.presentacionDe(amigo.id);
    r = salida(
      `Tu amigo secreto es <b>${corto(amigo)}</b> \u{1F381}<br>` +
      (amigo.gustos ? `Le gusta: <b>${amigo.gustos}</b>.<br>` : '') +
      (extra.length ? `Además me contaron que <b>${extra.slice(0, 3).map(e => e.valor).join('</b>, <b>')}</b>.<br>` : '') +
      (suyo.length ? `Y él mismo dice de sí: <i>«${nlp.aTercera(suyo[0])}»</i><br>` : '') +
      '<br><b>Mis recomendaciones</b> (calculadas con lo que sé de él y de quienes se le parecen):<br>' +
      rec.ideas.map(i => `\u{1F381} <b>${i.idea}</b> <span class="porque">— ${i.porque}</span>`).join('<br>') +
      (rec.vecinos.length ? `<br><br><span class="porque">Comparé su perfil con ${rec.vecinos.map(v => v.nombre + ' (' + v.similitud + '%)').join(', ')}.</span>` : ''),
      { ideas: rec.ideas.map(i => i.idea), sugerencias: ['Otra idea', `¿Quién es ${corto(amigo)}?`, 'El monto'] });
  }

  // ---- 18. Ideas sin sorteo todavia --------------------------------------
  else if (RX.ideas.test(t)) {
    intencion = 'ideas';
    if (faltan > 0) {
      const p = otros.length ? alAzar(otros) : null;
      r = salida(
        `El sorteo aún no sale (faltan <b>${faltan}</b> amigos) así que todavía no sé a quién le regalas \u{1F3B2}<br>` +
        (p ? `Pero puedo irte entrenando: ${corto(p)} ${await retrato(p)}.<br>` : '') +
        'Cuéntame tú qué te gusta y así, cuando salga el sorteo, quien te saque la tendrá fácil.',
        { sugerencias: ['Quiero pedir algo', '¿Quiénes están?', 'Juguemos algo'] });
    } else {
      r = salida('El sorteo está por salir \u{1F3B2} En cuanto salga te doy ideas hechas a medida para tu amigo secreto.');
    }
  }

  // ---- 19. El mundo: Navidad, amor, amistad, recordar --------------------
  else if (RX.contar.test(t)) {
    intencion = 'contar';
    // alterna historia / reflexion / pregunta, para no repetir siempre lo mismo
    const modo = cp.turnos % 3;
    if (modo === 0) {
      r = salida(navidad.historia(), { sugerencias: ['Cuéntame otra', '¿Qué es la Navidad para ti?', 'Pregúntame algo'] });
    } else if (modo === 1) {
      const ref = navidad.consultar(cp.tema || 'navidad amistad', 1);
      r = salida((ref.length ? ref[0].texto : navidad.reflexion()) + '<br><br>¿Tú qué opinas?',
        { sugerencias: ['Cuéntame otra', 'Guarda esto de mí', 'Juguemos algo'] });
    } else {
      const q = navidad.pregunta();
      evento = 'pensando';
      r = salida(`Mejor te pregunto yo \u{1F9DD}\u{1F4AD}<br><b>${q.texto}</b>`,
        { espera: { tipo: 'pregunta_duende', aprende: q.aprende }, sugerencias: ['Mejor cuéntame tú algo'] });
    }
  }

  else if (RX.navidad.test(t)) {
    intencion = 'navidad';
    const ref = navidad.consultar(t, 1);
    evento = sent.valencia >= 0 ? 'mimo' : null;
    r = salida(
      (ref.length ? ref[0].texto : navidad.reflexion('navidad')) +
      '<br><br>Para mí esta Navidad está hecha para eso: para acordarnos del amor y de la gente que nos acompañó \u{1F384}\u{1F49B}',
      { sugerencias: ['Cuéntame una historia', 'Guarda esto de mí', '¿Con quién me parezco?'] });
  }

  // ---- 20. Datos del evento ----------------------------------------------
  else if (RX.presupuesto.test(t)) {
    intencion = 'presupuesto';
    r = salida(`El monto acordado es <b>${ctx.monto || 'por definir'}</b> \u{1F4B0} Con eso alcanza de sobra para algo bonito y pensado.`);
  } else if (RX.fecha.test(t)) {
    intencion = 'fecha';
    r = salida(`\u{1F4C5} El intercambio es el <b>${ctx.fecha || 'por definir'}</b>${ctx.lugar ? ` en <b>${ctx.lugar}</b>` : ''}. ¡No lo dejes para el último día!`);
  } else if (RX.reglas.test(t)) {
    intencion = 'reglas';
    r = salida(
      'Así funciona \u{1F384}<br>' +
      '1. Cada quien crea su cuenta y llena sus gustos.<br>' +
      `2. Cuando estemos <b>${ctx.max || 8}</b>, el sorteo sale solo \u{1F3B2}<br>` +
      '3. Solo tú ves a quién te tocó. <b>Nadie</b> ve el de los demás, ni yo lo cuento \u{1F910}<br>' +
      `4. Monto: <b>${ctx.monto || 'por definir'}</b> · Fecha: <b>${ctx.fecha || 'por definir'}</b><br><br>` +
      'Yo mientras te doy ideas, te cuento del grupo, llevo recados, guardo lo que me cuentes y juego contigo \u{1F9DD}',
      { sugerencias: ['¿Quiénes están?', 'Dame ideas', 'Cuéntame algo'] });
  }

  // ---- 21. "Que sabes de mi?" --------------------------------------------
  else if (RX.verLista.test(t)) {
    intencion = 'recordar';
    const mios = await deseosDe(user.id);
    const ap = await knn.loAprendido(user.id);
    const gusta = ap.filter(a => a.tipo === 'gusta');
    const noGusta = ap.filter(a => a.tipo === 'no_gusta');
    const recuerdos = await memoria.memoriasDe(user.id, { limite: 4 });
    r = salida(
      'Esto es lo que sé de ti \u{1F9E0}<br>' +
      (mios.length ? `\u{1F4CB} Tu lista: <b>${mios.join('</b>, <b>')}</b><br>` : '\u{1F4CB} Tu lista está vacía.<br>') +
      (gusta.length ? `\u{1F44D} Te gusta: <b>${gusta.slice(0, 6).map(a => a.valor).join('</b>, <b>')}</b><br>` : '') +
      (noGusta.length ? `\u{1F44E} Evitar: <b>${noGusta.slice(0, 5).map(a => a.valor).join('</b>, <b>')}</b><br>` : '') +
      (recuerdos.length ? `\u{1F4D3} Y me pediste que recuerde: ${recuerdos.map(m => `<i>«${m.texto}»</i>`).join(', ')}<br>` : '') +
      '<br>Todo esto lo ve <b>solo</b> quien te sacó en el sorteo \u{1F512}');
  }

  // ---- 22. Cortesias -----------------------------------------------------
  else if (RX.gracias.test(t)) {
    intencion = 'gracias';
    evento = 'mimo';
    r = salida(alAzar([
      '¡Para eso estoy! \u{1F9DD} ¿Algo más?',
      '¡Un gusto! Si quieres te cuento algo del grupo \u{1F384}',
      '\u{1F60A} Cuando quieras. ¿Jugamos algo mientras esperamos?'
    ]));
  }

  else if (RX.saludo.test(t)) {
    intencion = 'saludo';
    const volvio = estadoPrevio.minutosAusente > 600;
    r = salida(
      `¡Hola, <b>${corto(user)}</b>! \u{1F9DD} ` +
      (volvio ? '¡Te extrañé! Hace rato no venías. ' : '') +
      (ctx.sorteoHecho && amigo ? 'Ya salió el sorteo, ¿te doy ideas para tu amigo secreto?'
        : faltan > 0 ? `Vamos <b>${gente.length}</b> de <b>${ctx.max || 8}</b>, faltan ${faltan}. ¿Jugamos algo mientras?`
          : 'Ya estamos completos, el sorteo está por salir \u{1F3B2}'),
      { sugerencias: ctx.sorteoHecho ? ['Dame ideas', '¿Con quién me parezco?', 'Cuéntame algo'] : ['¿Quiénes están?', 'Quiero pedir algo', 'Cuéntame algo'] });
  }

  // ---- 23. CHAT LIBRE: aqui entra el pensamiento -------------------------
  else {
    r = await chatLibre({ user, texto: t, sent, cp });
    intencion = r._intencion || null;
    evento = r._evento || null;
    delete r._intencion; delete r._evento;
  }

  // ---- lo que tuvo que leer entre lineas ---------------------------------
  // Si para entender la frase hubo que corregir ortografia, el duende lo dice.
  // Solo cuando ENTENDIO algo (hay intencion), para no dar la nota cuando ya
  // esta perdido de todas formas.
  if (intencion && r && r.texto && !r.dormido) {
    const nota = notaDeLectura(comp);
    if (nota && r.texto.length < 1200) r.texto += nota;
  }

  // ---- emocion y memoria del turno ---------------------------------------
  const est = await animo.sentir(user.id, {
    valencia: sent.valencia, intensidad: sent.intensidad, evento
  });
  if (!r.animo) r.animo = est;
  memoria.anotarCorto(user.id, { preguntaAbierta: r.espera || null });

  // el clasificador aprende de como habla ESTE grupo
  if (intencion) await aprenderIntencion(t, intencion, user.id);

  await guardarChat(user.id, 'bot', r.texto);
  return r;
}

// --------------------------------------------------------------------------
// CHAT LIBRE
// --------------------------------------------------------------------------
/**
 * Cuando ninguna regla calza, el duende piensa en cuatro pasos:
 *
 *   1. CLASIFICA la intencion con Naive Bayes (nlp.js). Si el modelo esta
 *      razonablemente seguro, atiende esa intencion.
 *   2. RECUERDA: busca en la memoria de largo plazo de esa persona algo
 *      parecido a lo que acaba de decir (TF-IDF + coseno).
 *   3. CONSULTA lo que sabe del mundo (navidad.js) por el mismo metodo.
 *   4. APRENDE: guarda lo que le contaron y responde preguntando, porque cada
 *      respuesta es una senal nueva.
 *
 * Si nada de eso da pie, improvisa con su cadena de Markov personal.
 */
async function chatLibre({ user, texto, sent, cp }) {
  const t = texto;
  const cls = nlp.clasificar(t);
  const salida = (texto, extra = {}) => ({ texto, ...extra });

  // --- 1. el clasificador esta seguro: lo tratamos como esa intencion -----
  if (cls.confianza >= 0.62) {
    if (cls.clase === 'navidad') {
      const ref = navidad.consultar(t, 1);
      return salida((ref.length ? ref[0].texto : navidad.reflexion()) + '<br><br>¿Y tú qué piensas de eso?',
        { _intencion: 'navidad', _evento: 'pensando', sugerencias: ['Cuéntame una historia', 'Guarda esto de mí'] });
    }
    if (cls.clase === 'contar') {
      return salida(navidad.historia(), { _intencion: 'contar', sugerencias: ['Cuéntame otra', 'Pregúntame algo'] });
    }
    if (cls.clase === 'animoTriste') {
      return salida(`Oye \u{1F917} eso no suena bien. Aquí estoy si quieres contarme.<br><i>${navidad.reflexion('tristeza')}</i>`,
        { _intencion: 'animoTriste', sugerencias: ['Cuéntame algo bonito', 'Juguemos algo'] });
    }
    if (cls.clase === 'animoAlegre') {
      return salida('¡Me contagias! \u{1F929} Cuéntame más, que todo lo bueno lo anoto.',
        { _intencion: 'animoAlegre', _evento: 'mimo' });
    }
  }

  // --- 2. busca en SU memoria algo parecido a lo que dijo -----------------
  const recuerdo = t.length > 10 ? await memoria.buscar(user.id, t, { n: 1 }) : [];

  // --- 3. busca en lo que sabe del mundo ---------------------------------
  const saber = t.length > 10 ? navidad.consultar(t, 1) : [];

  // --- 4. aprende de lo que le acaban de decir ---------------------------
  // Pero SOLO de afirmaciones. Antes, al no reconocer nada, extraerCosas()
  // devolvia la frase entera y el duende la guardaba como un gusto: por eso
  // acababa apuntando "DE ELENA VEGA QUE SABES" como si se lo hubieran
  // confiado. Ahora los gustos salen del analisis por clausulas, que solo los
  // da cuando hay de verdad un "me gusta X" delante.
  const pregunta = esPregunta(t);
  const gustos = pregunta ? [] : comprension.extraerGustos(t).filter(g => !META.test(g.valor));
  let aprendido = [];
  if (gustos.length && t.length < 140) {
    for (const g of gustos.slice(0, 3)) {
      await knn.aprender({
        usuarioId: user.id, tipo: g.tipo, valor: g.valor, origen: 'chat', peso: g.certeza
      });
    }
    aprendido = gustos.slice(0, 3).map(g => g.valor);
  }
  // si suena a dato sobre si mismo, lo guarda en la memoria larga
  const esAfirmacion = !pregunta &&
    new RegExp('\\b(soy|tengo|vivo|trabajo|estudio|me llamo|siempre|nunca|suelo|odio|amo|consider)\\b', 'i').test(t);
  if (esAfirmacion && t.length >= 12 && t.length <= 400) {
    await memoria.recordar({ usuarioId: user.id, tipo: 'dato', texto: t, visibilidad: 'privado', animo: sent.valencia });
  }

  // --- armado de la respuesta -------------------------------------------
  const piezas = [];

  if (recuerdo.length && recuerdo[0].score >= 0.18) {
    piezas.push(`Eso me suena \u{1F9E0} Tú me habías contado: <i>«${recuerdo[0].texto}»</i>`);
  }
  if (aprendido.length) {
    piezas.push(`Lo anoto \u{1F4DD} (<b>${aprendido.join('</b>, <b>')}</b>)`);
  } else if (esAfirmacion) {
    piezas.push('Guardado en mi cuaderno \u{1F4D3}');
  }
  if (saber.length && saber[0].score >= 0.1) {
    piezas.push(`<i>${saber[0].texto}</i>`);
  }

  // una ocurrencia improvisada, de vez en cuando, para que no suene a maquina
  if (piezas.length && Math.random() < 0.35) {
    const ocurrencia = await memoria.improvisar(user.id);
    if (ocurrencia && ocurrencia.length > 25 && ocurrencia.length < 160) {
      piezas.push(`<span class="porque">Se me ocurre algo con lo que me has ido contando: «${ocurrencia}»</span>`);
    }
  }

  if (piezas.length) {
    const q = navidad.pregunta();
    return salida(
      piezas.join('<br>') + `<br><br>${q.texto}`,
      {
        _evento: 'pensando',
        espera: { tipo: 'pregunta_duende', aprende: q.aprende },
        sugerencias: ['Cuéntame algo', '¿Qué recuerdas de mí?', 'Dame ideas']
      });
  }

  // --- nada que agarrar ---------------------------------------------------
  // Aqui el duende reconoce que no entendio, que es lo honesto, y en vez de
  // recitar su menu propone LAS FORMAS DE PREGUNTAR QUE MAS SE PARECEN a lo
  // que acaba de leer. Si ademas tuvo que corregir ortografia, lo dice.
  const cercanas = quisisteDecir(t, 3);
  const nota = notaDeLectura(analizar(t));

  if (cercanas.length) {
    return salida(
      'Uff, esa no la pillé \u{1F605} ¿Me quisiste decir alguna de estas?' + nota,
      { _evento: 'pensando', sugerencias: cercanas.concat(['No, otra cosa']) });
  }

  const q = navidad.pregunta();
  return salida(
    'No te entendí del todo \u{1F605} pero no me quiero quedar callado. Puedo:<br>' +
    '\u{1F381} darte ideas \u{00B7} \u{1F9EE} decirte con quién te pareces \u{00B7} \u{1F465} contarte del grupo \u{00B7} ' +
    '\u{1F48C} llevar recados \u{00B7} \u{1F9E0} guardar lo que me cuentes \u{00B7} \u{1F3B2} jugar \u{00B7} \u{1F634} irme a dormir si te molesto' +
    `<br><br>Mientras: <b>${q.texto}</b>`,
    {
      espera: { tipo: 'pregunta_duende', aprende: q.aprende },
      sugerencias: ['Dame ideas', '¿Quiénes están?', 'Cuéntame algo', 'Juguemos algo']
    });
}


// --------------------------------------------------------------------------
// Resumen de lo aprendido, para la pantalla de transparencia
// --------------------------------------------------------------------------
async function loQueSeDeTi(userId) {
  const [recuerdos, stats, gestos, est, ap] = await Promise.all([
    memoria.memoriasDe(userId, { limite: 10 }),
    memoria.contar(userId),
    gestosDe(userId),
    animo.estado(userId),
    knn.loAprendido(userId)
  ]);
  return {
    recuerdos: recuerdos.map(m => ({
      id: m.id, tipo: m.tipo, texto: m.texto, visibilidad: m.visibilidad,
      veces: Number(m.veces), relevancia: m.relevancia
    })),
    memoria: stats,
    gestos,
    animo: est,
    aprendido: ap,
    modelo: nlp.tamanoModelo()
  };
}

// --------------------------------------------------------------------------
// LO QUE EL DUENDE DICE SIN QUE LE PREGUNTEN
// --------------------------------------------------------------------------
/**
 * Un duende que solo contesta no es un amigo, es un buscador. Esto es lo que
 * se le ocurre decir al verte entrar: un consejo, un recuerdo tuyo, algo del
 * grupo o una idea sobre la Navidad.
 *
 * El orden no es al azar. Primero lo UTIL (lo que le falta a tu perfil, que es
 * lo que de verdad cambia el regalo que te van a hacer); cuando ya no falta
 * nada, lo bonito.
 *
 * Nunca habla del sorteo de nadie, y lo que recuerda es solo tuyo.
 *
 * @returns {Promise<object|null>} { texto, tipo } o null si esta dormido
 */
/**
 * Las ultimas notas que le solto a cada persona, para no repetirse en la misma
 * visita. Vive en memoria y se olvida al reiniciar el servidor, que es justo
 * lo que se quiere: al dia siguiente puede volver a contar lo mismo.
 */
const NOTAS_DICHAS = new Map();

async function mensajeEspontaneo(user, ctx = {}) {
  const est = await animo.estado(user.id);
  if (est.dormido) return null;

  const mios = await deseosDe(user.id);
  const falta = queFalta(user, mios);
  const yaDicho = NOTAS_DICHAS.get(user.id) || [];

  const opciones = [];

  // 1. lo util: que le falta a su perfil
  if (falta.length) {
    opciones.push({
      peso: 3, tipo: 'consejo', clave: 'falta:' + falta[0].clave,
      texto: alAzar([
        `Oye \u{1F440} ${falta[0].falta}. ${falta[0].pide}?`,
        `Un dato: ${falta[0].falta}, y eso es justo lo que más le serviría a quien te saque. ${falta[0].pide}?`,
        `Si me ayudas con una cosita: ${falta[0].pide.toLowerCase()}. ${falta[0].falta} \u{1F381}`
      ])
    });
  }

  // 2. algo que me contaste
  const recuerdos = (await memoria.memoriasDe(user.id, { tipo: 'dato', limite: 6 })).slice(0, 4);
  if (recuerdos.length) {
    const rec = alAzar(recuerdos);
    opciones.push({
      peso: 2, tipo: 'recuerdo', clave: 'rec:' + rec.id,
      texto: alAzar([
        `Me acordé de algo tuyo: <i>«${rec.texto}»</i> \u{1F9E0}`,
        `Seguí pensando en lo que me contaste: <i>«${rec.texto}»</i>. No se me olvida.`,
        `Lo tengo apuntado, por si acaso: <i>«${rec.texto}»</i> \u{1F4DD}`
      ])
    });
  }

  // 3. el grupo
  const faltanPersonas = Math.max(0, (ctx.max || 8) - (ctx.total || 0));
  if (faltanPersonas > 0) {
    opciones.push({
      peso: 1, tipo: 'grupo', clave: 'grupo:' + faltanPersonas,
      texto: `Faltan <b>${faltanPersonas}</b> amigo(s) para que salga el sorteo \u{1F3B2} Yo ya estoy nervioso.`
    });
  } else if (ctx.sorteoHecho) {
    opciones.push({
      peso: 1, tipo: 'grupo', clave: 'grupo:listo',
      texto: 'Ya está todo sorteado \u{1F381} Si quieres te doy ideas para tu amigo secreto.'
    });
  }

  // 4. lo que piensa de la Navidad
  opciones.push({
    peso: 1, tipo: 'mundo', clave: 'mundo:' + ((Date.now() / 86400000) | 0),
    texto: navidad.reflexion()
  });

  // 5. una travesura: susto y, pegado, el "era broma". Pesa poco a proposito:
  // una vez cada tanto hace gracia, cada vez que entras seria pesado.
  opciones.push({
    peso: 0.6, tipo: 'susto', clave: 'susto',
    texto: alAzar(SUSTOS) + '<br><br>' + alAzar(CALMA)
  });

  // 6. como se siente hoy
  opciones.push({
    peso: 1, tipo: 'animo', clave: 'animo:' + est.estado,
    texto: `Hoy ando <b>${est.etiqueta}</b> ${est.emoji}. ¿Y tú cómo vas?`
  });

  // lo ya dicho pesa la mitad, para que no repita lo mismo cada vez que entras
  const sorteables = [];
  for (const o of opciones) {
    const peso = yaDicho.indexOf(o.clave) >= 0 ? o.peso * 0.3 : o.peso;
    for (let i = 0; i < Math.max(1, Math.round(peso * 10)); i++) sorteables.push(o);
  }
  const elegido = alAzar(sorteables);
  if (!elegido) return null;

  // se apunta lo dicho para no repetirlo en la misma visita
  const dichas = yaDicho.concat([elegido.clave]).slice(-6);
  NOTAS_DICHAS.set(user.id, dichas);

  return { texto: elegido.texto, tipo: elegido.tipo, animo: est };
}

module.exports = {
  responder, historial, guardarChat, guardarDeseo, deseosDe,
  dejarRecado, recadosDe, marcarRecadoEntregado, revelaSorteo,
  reaccionarGesto, gestosDe, loQueSeDeTi,
  cargarAprendizaje, aprenderIntencion, mensajeEspontaneo, queFalta,
  CATALOGO: knn.CATALOGO
};
