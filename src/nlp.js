'use strict';
/**
 * ============================================================================
 *  nlp.js - LENGUAJE Y PENSAMIENTO DEL DUENDE
 * ============================================================================
 *
 *  Aqui viven los algoritmos clasicos de procesamiento de lenguaje que usa el
 *  duende para entender, recordar y sentir. Todo escrito a mano, sin librerias,
 *  para que se pueda leer y explicar paso a paso:
 *
 *    1. Tokenizacion y stemming  - partir el texto en unidades comparables
 *    2. Levenshtein              - distancia de edicion (tolera errores de tipeo)
 *    3. TF-IDF + coseno          - recuperacion de recuerdos por parecido
 *    4. Naive Bayes              - clasificacion de intenciones, con aprendizaje
 *    5. Analisis de sentimiento  - lexico + intensificadores + negacion
 *    6. Markov de orden 2        - generacion libre, para que improvise
 *    7. TextRank reducido        - resumen extractivo de textos largos
 *
 *  NOTA DE PRIVACIDAD: nada de lo que hay aqui conoce el sorteo. Estos son
 *  algoritmos sobre texto; quien le regala a quien nunca entra a este modulo.
 * ============================================================================
 */

// ---------------------------------------------------------------------------
// 1. TOKENIZACION Y STEMMING
// ---------------------------------------------------------------------------

const sinTildes = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const norm = (s) => sinTildes(s).toLowerCase().trim();

/** Palabras tan comunes que no aportan significado al comparar. */
const VACIAS = new Set([
  'a', 'al', 'algo', 'algun', 'alguna', 'ante', 'aqui', 'asi', 'aun', 'cada', 'como', 'con',
  'cual', 'cuando', 'de', 'del', 'desde', 'donde', 'dos', 'e', 'el', 'ella', 'ellos', 'en',
  'entre', 'era', 'eres', 'es', 'esa', 'ese', 'eso', 'esta', 'este', 'esto', 'estoy', 'fue',
  'ha', 'hay', 'he', 'la', 'las', 'le', 'les', 'lo', 'los', 'mas', 'me', 'mi', 'mis', 'mucho',
  'muy', 'nada', 'ni', 'no', 'nos', 'o', 'otra', 'otro', 'para', 'pero', 'poco', 'por',
  'porque', 'que', 'se', 'segun', 'ser', 'si', 'sin', 'sobre', 'solo', 'son', 'soy', 'su',
  'sus', 'tan', 'te', 'ti', 'tiene', 'todo', 'toda', 'tu', 'tus', 'un', 'una', 'uno', 'unos',
  'y', 'ya', 'yo'
]);

/**
 * Stemmer ligero para espanol. No es Snowball completo: recorta los sufijos
 * mas frecuentes (plurales, verbales, diminutivos, aumentativos) para que
 * "regalito", "regalos" y "regalar" caigan en la misma raiz "regal".
 */
const SUFIJOS = [
  'aciones', 'amientos', 'imientos', 'antes', 'ancia', 'encia',
  'citos', 'citas', 'cillo', 'cilla', 'itos', 'itas', 'ito', 'ita', 'illo', 'illa',
  'ones', 'azos', 'azo', 'ona', 'on',
  'abamos', 'aremos', 'eremos', 'iremos', 'aban', 'aron', 'eron', 'ieron', 'ando', 'iendo',
  'ados', 'adas', 'ado', 'ada',
  'aste', 'iste', 'amos', 'emos', 'imos', 'aba', 'ias', 'ira', 'ire', 'are',
  'ar', 'er', 'ir', 'as', 'es', 'os', 'a', 'e', 'o', 's'
];

function stem(palabra) {
  let p = norm(palabra).replace(/[^a-z0-9ñ]/g, '');
  if (p.length <= 4) return p;
  for (const suf of SUFIJOS) {
    if (p.length - suf.length >= 4 && p.endsWith(suf)) {
      p = p.slice(0, -suf.length);
      break;                                 // un solo recorte: evita pasarse
    }
  }
  return p;
}

/** Texto a lista de raices utiles. */
function tokenizar(texto, opciones) {
  const conVacias = !!(opciones && opciones.conVacias);
  return norm(texto)
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .split(/\s+/)
    .filter(p => p.length >= 2 && (conVacias || !VACIAS.has(p)))
    .map(stem)
    .filter(Boolean);
}

/** Bigramas: capturan frases hechas ("no me gusta", "amigo secreto"). */
function bigramas(tokens) {
  const salida = [];
  for (let i = 0; i < tokens.length - 1; i++) salida.push(tokens[i] + '_' + tokens[i + 1]);
  return salida;
}

/** Tokens + bigramas, que es lo que consumen los modelos de abajo. */
function rasgos(texto) {
  const t = tokenizar(texto);
  return t.concat(bigramas(t));
}

// ---------------------------------------------------------------------------
// 2. DISTANCIA DE EDICION (Levenshtein)
//    Para reconocer nombres mal escritos: "pyna" se parece a "pina".
// ---------------------------------------------------------------------------

function levenshtein(a, b) {
  a = norm(a); b = norm(b);
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  // una sola fila en memoria: O(min(a,b)) de espacio
  let previa = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const actual = [i];
    for (let j = 1; j <= b.length; j++) {
      const costo = a[i - 1] === b[j - 1] ? 0 : 1;
      actual[j] = Math.min(
        previa[j] + 1,            // borrar
        actual[j - 1] + 1,        // insertar
        previa[j - 1] + costo     // sustituir
      );
    }
    previa = actual;
  }
  return previa[b.length];
}

/**
 * Ratio de difflib.SequenceMatcher, portado de Python.
 *
 * Es la medida que uso en TecniBot para corregir lo mal escrito, y no es lo
 * mismo que Levenshtein: aqui se suman las longitudes de los bloques que
 * COINCIDEN y se divide entre el total de caracteres de las dos palabras,
 *   ratio = 2 * M / T
 * donde M son los caracteres emparejados. Por eso "qemado"/"quemado" sale muy
 * alto (comparten el bloque "emado") aunque falte una letra en medio.
 */
function bloquesIguales(a, b, i1, i2, j1, j2, acum) {
  // bloque comun mas largo entre a[i1..i2) y b[j1..j2)
  let mejorI = i1, mejorJ = j1, mejorN = 0;
  for (let i = i1; i < i2; i++) {
    for (let j = j1; j < j2; j++) {
      let n = 0;
      while (i + n < i2 && j + n < j2 && a[i + n] === b[j + n]) n++;
      if (n > mejorN) { mejorN = n; mejorI = i; mejorJ = j; }
    }
  }
  if (!mejorN) return acum;
  // a la izquierda y a la derecha del bloque, se busca recursivamente
  acum = bloquesIguales(a, b, i1, mejorI, j1, mejorJ, acum);
  acum += mejorN;
  return bloquesIguales(a, b, mejorI + mejorN, i2, mejorJ + mejorN, j2, acum);
}

function ratio(a, b) {
  const x = norm(a), y = norm(b);
  const total = x.length + y.length;
  if (!total) return 1;
  if (x === y) return 1;
  return (2 * bloquesIguales(x, y, 0, x.length, 0, y.length, 0)) / total;
}

/**
 * Equivalente de difflib.get_close_matches(n=1): la palabra del vocabulario
 * mas parecida, si pasa el umbral. Se usa para corregir lo que el usuario
 * escribio mal antes de intentar entenderlo.
 */
function masParecida(palabra, vocabulario, corte) {
  const umbral = corte === undefined ? 0.82 : corte;
  let mejor = null, mejorR = umbral;
  for (const v of vocabulario) {
    const r = ratio(palabra, v);
    if (r >= mejorR) { mejorR = r; mejor = v; }
  }
  return mejor ? { palabra: mejor, ratio: Number(mejorR.toFixed(3)) } : null;
}

/**
 * Combinacion de certezas de MYCIN:  FC = a + b * (1 - a)
 *
 * Dos evidencias independientes de lo mismo se refuerzan sin pasarse de 1:
 * si el perfil dice que le gusta el cafe (0.7) y ademas lo dijo en el chat
 * (0.6), la certeza combinada es 0.88, no 1.3.
 */
function combinarCerteza(a, b) {
  const x = Math.max(0, Math.min(1, a || 0));
  const y = Math.max(0, Math.min(1, b || 0));
  return Number((x + y * (1 - x)).toFixed(4));
}

/** 0..1, cuanto se parecen dos palabras. */
function parecido(a, b) {
  const largo = Math.max(norm(a).length, norm(b).length);
  if (!largo) return 0;
  return 1 - levenshtein(a, b) / largo;
}

/** Aparece "aguja" (o algo muy parecido) dentro de "pajar"? */
function contieneParecido(pajar, aguja, umbral) {
  const tope = umbral === undefined ? 0.8 : umbral;
  const objetivo = norm(aguja);
  if (!objetivo || objetivo.length < 3) return false;
  const t = norm(pajar);
  if (t.includes(objetivo)) return true;
  const palabras = t.split(/\s+/);
  const n = objetivo.split(/\s+/).length;
  for (let i = 0; i + n <= palabras.length; i++) {
    if (parecido(palabras.slice(i, i + n).join(' '), objetivo) >= tope) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// 3. TF-IDF + SIMILITUD COSENO
//    El buscador de recuerdos: "te acuerdas de lo que te conte del viaje?"
// ---------------------------------------------------------------------------

/**
 * N-gramas de letras, al estilo de analyzer="char_wb" de scikit-learn.
 *
 * Cada palabra se rodea de espacios y se parte en trozos de n letras. Es mas
 * tolerante que trabajar con palabras enteras: "parpadea" y "parpadeo"
 * comparten casi todos sus trozos, y "chcolate" sigue pareciendose a
 * "chocolate" aunque falte una letra. Por eso aguanta la forma de escribir de
 * cada persona sin tener que listar todas las variantes.
 */
function ngramasLetras(texto, min, max) {
  const desde = min || 3, hasta = max || 5;
  const salida = [];
  for (const palabra of norm(texto).replace(/[^a-z0-9ñ\s]/g, ' ').split(/\s+/)) {
    if (!palabra) continue;
    const p = ' ' + palabra + ' ';
    for (let n = desde; n <= hasta; n++) {
      if (p.length < n) break;
      for (let i = 0; i + n <= p.length; i++) salida.push(p.slice(i, i + n));
    }
  }
  return salida;
}

class TfIdf {
  /**
   * @param {object} opciones
   *   analizador: 'palabra' (por defecto, tokens + bigramas) o 'letra'
   *               (n-gramas de caracteres, que aguantan faltas de ortografia)
   */
  constructor(opciones) {
    this.analizador = (opciones && opciones.analizador) || 'palabra';
    this.n = (opciones && opciones.n) || [3, 5];
    this.docs = [];        // { id, meta, texto, tf: Map(termino -> frecuencia) }
    this.df = new Map();   // termino -> en cuantos documentos aparece
    this._cache = new Map();
  }

  /** Los rasgos con los que trabaja este indice, segun su analizador. */
  rasgosDe(texto) {
    return this.analizador === 'letra'
      ? ngramasLetras(texto, this.n[0], this.n[1])
      : rasgos(texto);
  }

  agregar(id, texto, meta) {
    const t = this.rasgosDe(texto);
    if (!t.length) return;
    const tf = new Map();
    for (const x of t) tf.set(x, (tf.get(x) || 0) + 1);
    for (const x of tf.keys()) this.df.set(x, (this.df.get(x) || 0) + 1);
    this.docs.push({ id, meta: meta || {}, tf, texto: String(texto) });
    this._cache.clear();                       // cambio el corpus: idf cambia
  }

  /** idf suavizado: log(1 + N/df). Un termino raro pesa mas que uno comun. */
  idf(termino) {
    const df = this.df.get(termino) || 0;
    return Math.log(1 + this.docs.length / (1 + df));
  }

  vector(tf) {
    const v = new Map();
    let suma = 0;
    for (const [t, f] of tf) {
      // tf logaritmico: la decima repeticion no vale como la primera
      const peso = (1 + Math.log(f)) * this.idf(t);
      v.set(t, peso);
      suma += peso * peso;
    }
    const n = Math.sqrt(suma) || 1;
    for (const t of v.keys()) v.set(t, v.get(t) / n);    // normalizacion L2
    return v;
  }

  vectorDoc(i) {
    if (!this._cache.has(i)) this._cache.set(i, this.vector(this.docs[i].tf));
    return this._cache.get(i);
  }

  static coseno(a, b) {
    const corto = a.size <= b.size ? a : b;
    const largo = a.size <= b.size ? b : a;
    let p = 0;
    for (const [t, x] of corto) if (largo.has(t)) p += x * largo.get(t);
    return p;
  }

  /** Documentos mas parecidos a la consulta, de mayor a menor. */
  buscar(consulta, n, minimo) {
    const cuantos = n === undefined ? 3 : n;
    const umbral = minimo === undefined ? 0.08 : minimo;
    const t = this.rasgosDe(consulta);
    if (!t.length || !this.docs.length) return [];
    const tf = new Map();
    for (const x of t) tf.set(x, (tf.get(x) || 0) + 1);
    const q = this.vector(tf);
    return this.docs
      .map((d, i) => ({ id: d.id, meta: d.meta, texto: d.texto, score: TfIdf.coseno(q, this.vectorDoc(i)) }))
      .filter(x => x.score >= umbral)
      .sort((a, b) => b.score - a.score)
      .slice(0, cuantos);
  }
}

// ---------------------------------------------------------------------------
// 4. NAIVE BAYES MULTINOMIAL
//    Clasifica la intencion del mensaje. Se entrena con frases semilla y
//    sigue aprendiendo de lo que la gente escribe de verdad.
// ---------------------------------------------------------------------------

class NaiveBayes {
  constructor() {
    this.clases = new Map();    // clase -> { docs, total, conteo: Map(term -> n) }
    this.vocab = new Set();
    this.docs = 0;
  }

  entrenar(texto, clase) {
    const t = rasgos(texto);
    if (!t.length) return;
    if (!this.clases.has(clase)) this.clases.set(clase, { docs: 0, total: 0, conteo: new Map() });
    const c = this.clases.get(clase);
    c.docs++; this.docs++;
    for (const x of t) {
      c.conteo.set(x, (c.conteo.get(x) || 0) + 1);
      c.total++;
      this.vocab.add(x);
    }
  }

  /**
   * Devuelve { clase, confianza, ranking }. Se trabaja con logaritmos para no
   * multiplicar probabilidades diminutas y perder precision, y con suavizado
   * de Laplace para que una palabra nunca vista no anule la clase entera.
   */
  clasificar(texto) {
    const t = rasgos(texto);
    if (!t.length || !this.docs) return { clase: null, confianza: 0, ranking: [] };
    const V = this.vocab.size;
    const puntos = [];

    for (const [clase, c] of this.clases) {
      let log = Math.log(c.docs / this.docs);          // probabilidad a priori
      for (const x of t) {
        const n = c.conteo.get(x) || 0;
        log += Math.log((n + 1) / (c.total + V));      // verosimilitud suavizada
      }
      puntos.push({ clase, log });
    }
    puntos.sort((a, b) => b.log - a.log);

    // softmax sobre los logaritmos para leer la confianza como porcentaje
    const techo = puntos[0].log;
    const exp = puntos.map(p => Math.exp(p.log - techo));
    const suma = exp.reduce((a, b) => a + b, 0) || 1;
    const ranking = puntos.map((p, i) => ({ clase: p.clase, p: Number((exp[i] / suma).toFixed(4)) }));

    return { clase: ranking[0].clase, confianza: ranking[0].p, ranking: ranking.slice(0, 3) };
  }
}

/**
 * Frases semilla: el conjunto de entrenamiento inicial. Pocas pero variadas.
 * Cada vez que alguien escribe algo y una regla acierta la intencion, esa
 * frase se agrega al modelo y el clasificador mejora con el uso.
 */
const SEMILLAS = {
  ideas: [
    'dame ideas de regalo', 'que le compro', 'sugiereme algo', 'no se que regalar',
    'recomiendame un regalo', 'ideas para mi amigo secreto', 'que le gustaria recibir'
  ],
  guardar: [
    'guarda esto de mi', 'registra lo siguiente', 'quiero que recuerdes esto',
    'apunta esto sobre mi', 'graba este dato', 'anota que soy', 'recuerda que yo',
    'registra esto de mi persona', 'quiero que guardes este recuerdo'
  ],
  recadoPublico: [
    'si alguien pregunta por mi dile que', 'cuando pregunten por mi cuentales',
    'diles a todos que', 'si preguntan de mi responde', 'que sepan todos que',
    'si alguien pregunta de mi cuenta que'
  ],
  recordar: [
    'te acuerdas de lo que te conte', 'que recuerdas de mi', 'que te dije ayer',
    'recuerdas cuando hablamos de', 'que guardaste de mi', 'que sabes de mi',
    'que tienes anotado de mi'
  ],
  grupo: [
    'quienes estan en el grupo', 'cuantos amigos somos', 'cuantos faltan',
    'dame la lista de participantes', 'ya estamos completos'
  ],
  afinidad: [
    'con quien me parezco', 'quien tiene mis gustos', 'cuanta afinidad tengo',
    'quien es mi mejor amigo aqui', 'con quien tengo cosas en comun'
  ],
  persona: [
    'quien es juan', 'hablame de maria', 'cuentame de pedro', 'como es ella',
    'conoces a carlos', 'que me dices de ese amigo'
  ],
  juego: [
    'juguemos algo', 'estoy aburrido', 'una adivinanza', 'proponme un juego',
    'hazme algo divertido', 'quiero jugar contigo'
  ],
  navidad: [
    'que es la navidad para ti', 'cuentame de la navidad', 'hablame del amor',
    'por que es bonita la navidad', 'que significa la amistad', 'cuentame algo bonito',
    'por que es bueno acordarse de alguien'
  ],
  cosquillas: [
    'cosquillas', 'te hago cosquillas', 'jajaja', 'me haces reir', 'que risa'
  ],
  animoTriste: [
    'estoy triste', 'me siento mal', 'he tenido un dia horrible', 'estoy bajoneado',
    'me siento solo', 'ando desanimado', 'extrano a mi gente'
  ],
  animoAlegre: [
    'estoy feliz', 'que alegria', 'me fue genial', 'estoy emocionado',
    'tengo muchas ganas de la navidad', 'hoy fue un gran dia'
  ],
  dormir: [
    'vete a dormir', 'descansa un rato', 'duerme', 'tomate un descanso',
    'ya no molestes un rato', 'descansa duende'
  ],
  despertar: [
    'despierta', 'duende ven', 'te llamo', 'sal de ahi', 'oye duende', 'regresa'
  ],
  callar: [
    'deja de hablar', 'callate', 'no hables', 'silencio', 'apaga la voz'
  ],
  contar: [
    'cuentame esto', 'cuentame algo', 'cuentame una historia', 'que me cuentas',
    'dime algo interesante', 'hablame de algo'
  ],
  presupuesto: ['cual es el monto', 'cuanto gastamos', 'de cuanto es el regalo', 'presupuesto'],
  fecha: ['cuando es el intercambio', 'que dia nos vemos', 'donde sera', 'la fecha del evento'],
  reglas: ['como funciona esto', 'cuales son las reglas', 'no entiendo', 'ayudame', 'que hago aqui'],
  gracias: ['gracias', 'muchas gracias', 'eres genial', 'que bueno eres', 'te quiero duende'],
  saludo: ['hola', 'buenas', 'hey duende', 'buenos dias', 'que tal', 'buenas noches']
};

/** Modelo global, entrenado al cargar el modulo. */
const clasificador = new NaiveBayes();
for (const clase of Object.keys(SEMILLAS)) {
  for (const f of SEMILLAS[clase]) clasificador.entrenar(f, clase);
}

function clasificar(texto) { return clasificador.clasificar(texto); }
function entrenarIntencion(texto, clase) { clasificador.entrenar(texto, clase); }
function tamanoModelo() {
  return { docs: clasificador.docs, vocabulario: clasificador.vocab.size, clases: clasificador.clases.size };
}

// ---------------------------------------------------------------------------
// 5. ANALISIS DE SENTIMIENTO
//    Lexico con pesos + intensificadores + negacion + emojis.
// ---------------------------------------------------------------------------

const LEXICO = {
  // positivos
  feliz: 2, felices: 2, alegre: 2, alegria: 2, contento: 2, encanta: 2, encantan: 2,
  amor: 2.5, amo: 2.5, querido: 2, carino: 2.2, carinoso: 2, abrazo: 2,
  gracias: 1.5, genial: 2, excelente: 2, bueno: 1.2, buena: 1.2, buenos: 1.2, buenas: 1.2,
  lindo: 1.8, linda: 1.8, bonito: 1.8, bonita: 1.8, hermoso: 2, divertido: 1.8, chistoso: 1.5,
  risa: 1.5, reir: 1.5, jaja: 1.5, jeje: 1.2, emocionado: 2, ilusion: 2, esperanza: 1.8,
  amistad: 2.2, amigo: 1.5, amigos: 1.5, hermano: 2, hermanos: 2, familia: 2,
  gusta: 1.5, gustan: 1.5, aventura: 1.5, aventuras: 1.5, recuerdo: 1.2,
  navidad: 1.5, regalo: 1.2, fiesta: 1.5, celebrar: 1.5, orgulloso: 2, agradecido: 2,
  ayudamos: 1.8, apoyo: 1.8, siempre: 0.6,
  // negativos
  triste: -2.2, tristeza: -2.2, mal: -1.5, malo: -1.5, pena: -2, llorar: -2.2, lloro: -2.2,
  soledad: -2, extrano: -1.2, extranar: -1.2, nostalgia: -0.8,
  odio: -2.5, odiar: -2.5, detesto: -2.2, horrible: -2.2, terrible: -2.2, feo: -1.5,
  aburrido: -1.5, aburre: -1.5, cansado: -1.2, harto: -1.8, molesto: -1.8, enojado: -2,
  miedo: -1.8, preocupado: -1.5, problema: -1.2, problemas: -1.2, dificil: -1,
  nadie: -1.2, peor: -2, duele: -2, dolor: -2, murio: -2.5
};

const INTENSIFICA = {
  muy: 1.5, mucho: 1.5, mucha: 1.5, bastante: 1.3, super: 1.7,
  demasiado: 1.6, tan: 1.4, bien: 1.3
};
const NIEGA = new Set(['no', 'ni', 'nunca', 'jamas', 'tampoco', 'sin', 'nada']);

const EMOJIS_POS = /[\u{1F600}-\u{1F60F}\u{1F617}-\u{1F61D}\u{1F638}-\u{1F63D}\u{1F495}-\u{1F49F}\u{1F970}\u{1F929}\u{1F973}]|❤/u;
const EMOJIS_NEG = /[\u{1F61E}-\u{1F62D}\u{1F630}-\u{1F63F}\u{1F612}]|\u{1F494}/u;

/**
 * Devuelve { valencia: -1..1, emocion, intensidad: 0..1, palabras }.
 * La negacion invierte la palabra siguiente ("no me gusta" no es "me gusta")
 * y un intensificador multiplica su peso ("muy triste" pesa mas que "triste").
 */
function sentimiento(texto) {
  const crudo = String(texto || '');
  const palabras = norm(crudo).replace(/[^a-z0-9ñ\s]/g, ' ').split(/\s+/).filter(Boolean);
  let suma = 0, encontradas = 0;
  const palabrasClave = [];

  // indice por raiz, para que valga tambien la palabra conjugada
  for (let i = 0; i < palabras.length; i++) {
    const p = palabras[i];
    let base = LEXICO[p];
    if (base === undefined) base = LEXICO_RAIZ[stem(p)];
    if (base === undefined) continue;

    let valor = base;
    // mira las dos palabras anteriores en busca de modificadores
    for (let j = Math.max(0, i - 2); j < i; j++) {
      if (INTENSIFICA[palabras[j]]) valor *= INTENSIFICA[palabras[j]];
      if (NIEGA.has(palabras[j])) valor *= -0.85;
    }
    suma += valor;
    encontradas++;
    palabrasClave.push(p);
  }

  if (EMOJIS_POS.test(crudo)) { suma += 1.2; encontradas++; }
  if (EMOJIS_NEG.test(crudo)) { suma -= 1.2; encontradas++; }
  if (/!{2,}/.test(crudo)) suma *= 1.15;                 // grita: mas intenso

  // tanh comprime a -1..1 de forma suave, sin cortes bruscos
  const valencia = encontradas ? Math.tanh(suma / 3) : 0;
  const intensidad = Math.min(1, Math.abs(suma) / 5);

  let emocion = 'neutral';
  if (valencia >= 0.55) emocion = 'feliz';
  else if (valencia >= 0.18) emocion = 'contento';
  else if (valencia <= -0.55) emocion = 'triste';
  else if (valencia <= -0.18) emocion = 'bajon';

  return {
    valencia: Number(valencia.toFixed(3)),
    emocion,
    intensidad: Number(intensidad.toFixed(3)),
    palabras: palabrasClave
  };
}

/** Lexico indexado por raiz: se arma una sola vez al cargar el modulo. */
const LEXICO_RAIZ = {};
for (const k of Object.keys(LEXICO)) {
  const r = stem(k);
  if (LEXICO_RAIZ[r] === undefined) LEXICO_RAIZ[r] = LEXICO[k];
}

// ---------------------------------------------------------------------------
// 6. CADENA DE MARKOV DE ORDEN 2
//    Para que el duende improvise frases con el vocabulario que ha oido.
//
//    IMPORTANTE: cada cadena se entrena SOLO con texto que el destinatario
//    puede leer (sus propias palabras y el corpus navideno). Asi, por
//    construccion, no puede "inventar" algo que delate a otra persona.
// ---------------------------------------------------------------------------

class Markov {
  constructor(orden) {
    this.orden = orden || 2;
    this.tabla = new Map();     // "a b" -> [siguientes]
    this.inicios = [];
    this.frases = 0;
  }

  entrenar(texto) {
    for (const frase of String(texto || '').split(/[.!?¡¿\n]+/)) {
      const palabras = frase.trim().split(/\s+/).filter(Boolean);
      if (palabras.length < this.orden + 2) continue;
      this.frases++;
      this.inicios.push(palabras.slice(0, this.orden).join(' '));
      for (let i = 0; i + this.orden < palabras.length; i++) {
        const clave = palabras.slice(i, i + this.orden).join(' ');
        if (!this.tabla.has(clave)) this.tabla.set(clave, []);
        this.tabla.get(clave).push(palabras[i + this.orden]);
      }
      const ultimo = palabras.slice(-this.orden).join(' ');
      if (!this.tabla.has(ultimo)) this.tabla.set(ultimo, []);
      this.tabla.get(ultimo).push(null);                 // marca de fin
    }
    return this;
  }

  generar(opciones) {
    const maximo = (opciones && opciones.maximo) || 22;
    const intentos = (opciones && opciones.intentos) || 6;
    if (this.frases < 3 || !this.inicios.length) return null;

    for (let intento = 0; intento < intentos; intento++) {
      let clave = this.inicios[Math.floor(Math.random() * this.inicios.length)];
      const salida = clave.split(' ');
      for (let i = 0; i < maximo; i++) {
        const opts = this.tabla.get(clave);
        if (!opts || !opts.length) break;
        const sig = opts[Math.floor(Math.random() * opts.length)];
        if (sig === null) break;
        salida.push(sig);
        clave = salida.slice(-this.orden).join(' ');
      }
      if (salida.length >= this.orden + 4) {
        const frase = salida.join(' ').replace(/\s+([,.;])/g, '$1').trim();
        return frase.charAt(0).toUpperCase() + frase.slice(1);
      }
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// 7. RESUMEN EXTRACTIVO (TextRank reducido)
//    Si alguien le cuenta un parrafo largo, guarda la esencia.
// ---------------------------------------------------------------------------

function resumir(texto, maximo) {
  const tope = maximo === undefined ? 2 : maximo;
  const frases = String(texto || '').split(/(?:[.!?]+\s+|\n+)/).map(f => f.trim()).filter(f => f.length > 15);
  if (frases.length <= tope) return String(texto || '').trim();

  const tfidf = new TfIdf();
  frases.forEach((f, i) => tfidf.agregar(i, f));
  const vectores = tfidf.docs.map((d, i) => tfidf.vectorDoc(i));

  // puntaje = cuanto se parece cada frase a todas las demas (centralidad)
  const puntos = vectores.map((v, i) => {
    let s = 0;
    vectores.forEach((w, j) => { if (i !== j) s += TfIdf.coseno(v, w); });
    return { i, s };
  });

  return puntos
    .sort((a, b) => b.s - a.s)
    .slice(0, tope)
    .sort((a, b) => a.i - b.i)
    .map(p => frases[p.i])
    .join('. ')
    .replace(/\.\.+/g, '.');
}

// ---------------------------------------------------------------------------
// Utilidades de redaccion
// ---------------------------------------------------------------------------

/** Tema principal de una frase: el termino con mas peso informativo. */
function temaDe(texto) {
  const tokens = tokenizar(texto);
  if (!tokens.length) return null;
  const cuenta = new Map();
  for (const t of tokens) cuenta.set(t, (cuenta.get(t) || 0) + 1);
  return [...cuenta.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0][0];
}

/**
 * Pasa una frase de primera a tercera persona, para que el duende pueda
 * repetir lo que alguien dijo de si mismo: "siempre sere su mejor amigo"
 * se convierte en "siempre sera su mejor amigo".
 */
const PRIMERA_A_TERCERA = [
  [/\bnos ayudamos\b/gi, 'se ayudan'],
  [/\bnos vemos\b/gi, 'se ven'],
  [/\bnos conocemos\b/gi, 'se conocen'],
  [/\bya no trabajamos\b/gi, 'ya no trabajan'],
  [/\btrabajamos\b/gi, 'trabajan'],
  [/\bcompartimos\b/gi, 'comparten'],
  [/\bser[eé]\b/gi, 'será'],
  [/\bestar[eé]\b/gi, 'estará'],
  [/\bcompart[ií]\b/gi, 'compartió'],
  [/\baprend[ií]\b/gi, 'aprendió'],
  [/\bviv[ií]\b/gi, 'vivió'],
  [/\bconsidero\b/gi, 'considera'],
  [/\bsiento\b/gi, 'siente'],
  [/\bquiero\b/gi, 'quiere'],
  [/\bpienso\b/gi, 'piensa'],
  [/\bcreo\b/gi, 'cree'],
  [/\bsé\b/gi, 'sabe'],              // solo con tilde: "se" sin tilde es pronombre
  [/\bsoy\b/gi, 'es'],
  [/\bestoy\b/gi, 'está'],
  [/\btengo\b/gi, 'tiene'],
  [/\bvoy\b/gi, 'va'],
  [/\bpuedo\b/gi, 'puede'],
  [/\bdigo\b/gi, 'dice'],
  [/\bconmigo\b/gi, 'con él'],
  [/\bmis\b/gi, 'sus'],
  [/\bmi\b/gi, 'su'],
  [/\bme\b/gi, 'le'],
  [/\byo\b/gi, '']
];

function aTercera(texto) {
  let t = ' ' + String(texto || '').trim() + ' ';
  for (const par of PRIMERA_A_TERCERA) t = t.replace(par[0], par[1]);
  return t.replace(/\s+/g, ' ').trim();
}

module.exports = {
  // texto
  sinTildes, norm, stem, tokenizar, bigramas, rasgos, VACIAS,
  // distancias y certezas
  levenshtein, parecido, contieneParecido, ratio, masParecida, combinarCerteza,
  // recuperacion
  TfIdf, ngramasLetras,
  // intenciones
  NaiveBayes, clasificador, clasificar, entrenarIntencion, tamanoModelo, SEMILLAS,
  // sentimiento
  sentimiento, LEXICO,
  // generacion y resumen
  Markov, resumir, temaDe, aTercera
};
