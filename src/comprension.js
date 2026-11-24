'use strict';
/**
 * ============================================================================
 *  comprension.js - ENTENDER LO QUE LA PERSONA QUISO DECIR
 * ============================================================================
 *
 *  Este modulo es la adaptacion al duende del analizador de lenguaje de
 *  TecniBot IA (proyecto de Ciencias Cognitivas del Lenguaje). Alla convertia
 *  "mi pc no prende y uele a qemado" en hechos para un sistema experto; aqui
 *  convierte "no me gustan los chcolates pero amo el cafe" en senales de
 *  gustos e intenciones.
 *
 *  Son los mismos cinco pasos, con la misma idea de fondo: la persona escribe
 *  como habla, no como un formulario.
 *
 *   1. NORMALIZAR       minusculas, sin tildes, sin signos.
 *   2. PARTIR EN CLAUSULAS   por comas, puntos y "pero", para que una
 *                       negacion no contamine toda la frase. Es lo que hace
 *                       que "no me gusta el cilantro pero amo el chocolate"
 *                       se entienda como dos cosas distintas.
 *   3. CORREGIR         lo mal escrito contra un vocabulario propio, con el
 *                       ratio de difflib (nlp.ratio): "rgalo" -> "regalo".
 *   4. PATRONES FLEXIBLES   cada palabra del patron es una RAIZ ("regal"
 *                       reconoce regalo, regalos, regalarle) y entre palabra
 *                       y palabra caben hasta 2 de relleno ("dame una idea
 *                       de regalo"). Las palabras de 3 letras o menos tienen
 *                       que coincidir exactas, para no disparar de mas.
 *   5. INTERPRETAR      como lo haria una persona:
 *                       - NEGACION: "no me gusta X" -> el hecho opuesto.
 *                       - DUDA: "creo que me gusta" -> certeza 0.6.
 *                       - NUMEROS: "talla M", "hasta 80 soles", "zapato 42".
 *
 *  Todo sale con CERTEZA, y cuando dos evidencias apuntan a lo mismo se
 *  combinan con la formula de MYCIN (nlp.combinarCerteza): FC = a + b(1-a).
 *  Asi, que alguien diga dos veces que le gusta el cafe sube la confianza
 *  sin pasarse nunca de 1.
 *
 *  PRIVACIDAD: aqui solo se analiza texto. Este modulo no sabe nada del
 *  sorteo ni tiene forma de averiguarlo.
 * ============================================================================
 */

const nlp = require('./nlp');

const norm = nlp.norm;

// ---------------------------------------------------------------------------
// Piezas del analizador
// ---------------------------------------------------------------------------

const NEGADORES = new Set(['no', 'ni', 'sin', 'nunca', 'jamas', 'tampoco', 'nada']);

/**
 * Palabras "puente": al mirar hacia atras buscando una negacion se pueden
 * saltar, porque no cortan el alcance de un "no".
 */
const PUENTE = new Set([
  'es', 'era', 'son', 'esta', 'estan', 'estaba', 'tiene', 'tienen', 'tenia', 'hay', 'habia',
  'se', 'me', 'le', 'lo', 'la', 'las', 'el', 'los', 'un', 'una', 'unos', 'unas',
  'a', 'de', 'del', 'en', 'ha', 'han', 'he', 'hace', 'que', 'y', 'o', 'pero',
  'muy', 'tan', 'mucho', 'mucha', 'para', 'por', 'con', 'mi', 'mis', 'tu', 'tus', 'su', 'sus',
  'yo', 'te', 'nos', 'les', 'realmente', 'siempre', 'todavia', 'aun', 'ya'
]);

/**
 * Como se escribe de verdad en un chat peruano. Esto va ANTES de la
 * correccion por parecido, porque "kien" y "quien" no se parecen lo bastante
 * para que difflib los una (comparten solo "ien": ratio 0.67) y aun asi
 * cualquiera sabe lo que quisieron decir.
 */
const ABREVIATURAS = {
  kien: 'quien', qien: 'quien', quen: 'quien',
  ke: 'que', k: 'que', q: 'que', qe: 'que',
  xq: 'porque', pq: 'porque', xk: 'porque', porq: 'porque',
  x: 'por', d: 'de', dl: 'del', pa: 'para',
  tmb: 'tambien', tb: 'tambien', tbn: 'tambien',
  toy: 'estoy', ta: 'esta', tas: 'estas', stoy: 'estoy',
  grax: 'gracias', gracs: 'gracias', graxias: 'gracias',
  nmas: 'nomas', ay: 'hay',
  oe: 'oye', ps: 'pues', pe: 'pues',
  ola: 'hola', olas: 'hola', wena: 'buenas', wenas: 'buenas', wenos: 'buenos',
  alo: 'hola', hey: 'hola', ey: 'hola', epa: 'hola', holi: 'hola', holis: 'hola',
  amix: 'amigo', amixs: 'amigos', bro: 'amigo',
  xfa: 'por favor', pls: 'por favor',
  msj: 'mensaje', mnsj: 'mensaje', rgalo: 'regalo',
  navidd: 'navidad', dnd: 'donde', cnd: 'cuando'
};

/**
 * Palabras tan chicas que la gente se las come al escribir. En un patron son
 * OPCIONALES: asi "vete a dormir" tambien reconoce "vete dormir".
 */
const CONECTORES = new Set(['a', 'al', 'de', 'del', 'en', 'lo', 'la', 'el', 'los', 'las', 'un', 'una', 'y', 'o']);

const DUDAS = [
  'creo', 'parece', 'quizas', 'quiza', 'tal vez', 'a veces', 'posiblemente',
  'probablemente', 'como que', 'no estoy seguro', 'capaz', 'puede ser', 'mas o menos'
];

const SEGURIDAD = ['seguro', 'segurisimo', 'obvio', 'claro que', 'por supuesto', 'definitivamente', 'siempre'];

/** Hasta 2 palabras de relleno entre las partes de un patron, salvo negaciones. */
const HUECO = '\\s+(?:(?!(?:no|ni|sin|nunca|jamas|tampoco)\\b)[a-z0-9ñ]+\\s+){0,2}';

function escapar(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Paso 1: normalizar. */
function normalizar(texto) {
  let t = norm(texto);
  t = t.replace(/(\d)[.,](\d)/g, '$1 $2');            // 1.500 -> 1 500
  t = t.replace(/[^a-z0-9%ñ\s]/g, ' ');
  t = t.replace(/\s+/g, ' ').trim();
  // "holaaa" -> "hola", "siii" -> "si": alargar la ultima letra es la forma de
  // gritar por escrito. Solo al final de la palabra: en medio romperia carro,
  // ella, perro.
  t = t.replace(/([a-zñ])\1+\b/g, '$1');
  // y se desarman las abreviaturas del chat
  return t.split(' ').map(w => ABREVIATURAS[w] || w).join(' ');
}

/** Paso 2: partir en clausulas, para que una negacion no contamine el resto. */
function clausulas(texto) {
  return String(texto || '')
    .replace(/(\d)[.,](\d)/g, '$1 $2')
    .split(/[.,;:!?\n()¡¿]+|\bpero\b|\baunque\b|\bsin embargo\b/i)
    .map(c => c.trim())
    .filter(Boolean);
}

/**
 * Paso 4: compila un patron de raices a una expresion regular.
 * Palabras de 3 letras o menos -> coincidencia exacta.
 * Palabras de 4 o mas          -> raiz, admite cualquier terminacion.
 */
function compilarPatron(patron) {
  const palabras = normalizar(patron).split(' ').filter(Boolean);

  // Un conector solo puede sobrar si queda algo mas que acote el patron. En
  // "cuentame de" el "de" ES el patron: sin el queda "cuentame", que engancha
  // con "cuentame un chiste" y con todo lo demas. La regla: se aflojan los
  // conectores unicamente si quedan dos o mas palabras con contenido.
  const conContenido = palabras.filter(w => !CONECTORES.has(w)).length;
  const aflojar = conContenido >= 2;

  const partes = [];
  let opcional = '';                       // conectores que se pegan al siguiente trozo
  for (const w of palabras) {
    if (CONECTORES.has(w) && aflojar) {
      opcional += '(?:' + escapar(w) + '\\s+)?';
      continue;
    }
    // <=3 letras: exacta.  >=4: raiz, admite cualquier terminacion
    partes.push(opcional + (w.length <= 3 ? escapar(w) : escapar(w) + '[a-z0-9ñ]*'));
    opcional = '';
  }
  if (!partes.length) return null;         // un patron de puros conectores no sirve
  return new RegExp('\\b' + partes.join(HUECO) + '\\b');
}


// ---------------------------------------------------------------------------
// EL LEXICO DEL DUENDE
// Cada entrada es un hecho (una intencion) con las formas de decirlo.
// Las raices hacen el trabajo pesado: "regal" cubre regalo, regalos, regalarle.
// ---------------------------------------------------------------------------
const LEXICO = {
  // ── lo que el duende nunca contesta ──
  fisgon: ['a quien le toco', 'a quien le toca', 'quien le toco', 'quien le toca', 'quien tiene a',
    'a quien saco', 'a quien saque', 'quien me saco', 'quien me saque', 'quien saco a',
    'quien le salio', 'a quien le salio', 'quien es el amigo secreto de', 'de quien es amigo secreto',
    'dime a quien', 'quien me tiene', 'dime quien saco', 'quien le dio'],

  // ── ordenes sobre su estado ──
  dormir: ['vete a dormir', 've a dormir', 'anda a dormir', 'a dormir', 'duermete', 'duerme', 'descansa',
    'tomate un descanso', 'toma un descanso', 'echate un rato', 've a descansar'],
  despertar: ['despierta', 'despiertate', 'levantate', 'sal de ahi', 'te llamo', 'te estoy llamando',
    'regresa', 'vuelve aca', 'ya despierta', 'ven aca', 'sal de tu caja'],
  callar: ['deja de hablar', 'callate', 'no hables', 'silencio', 'apaga la voz', 'sin voz', 'baja la voz',
    'ya no hables', 'no quiero que hables'],
  hablarYa: ['ya puedes hablar', 'vuelve a hablar', 'enciende la voz', 'habla otra vez', 'activa la voz',
    'quiero oirte'],

  // ── memoria ──
  guardar: ['guarda esto', 'guarda este', 'guardame esto', 'registra esto', 'registrame', 'registra que',
    'anota esto', 'anota que', 'anotame', 'apunta esto', 'apunta que', 'graba esto', 'memoriza',
    'recuerda esto', 'recuerda que', 'quiero que recuerdes', 'quiero que guardes', 'guarda de mi'],
  recadoPublico: ['si alguien pregunta', 'si alguien pide', 'cuando pregunten', 'si preguntan', 'si te preguntan',
    'cuando te pregunten', 'diles a todos', 'dile a todos', 'que sepan todos', 'que todos sepan',
    'si alguien quiere saber'],
  recordar: ['te acuerdas', 'recuerdas', 'que recuerdas', 'que te dije', 'que te conte', 'que guardaste',
    'que tienes anotado', 'que tienes de mi', 'que sabes de mi', 'me recuerdas'],
  olvidar: ['olvida eso', 'olvida lo', 'borra eso', 'borra lo', 'elimina eso', 'elimina lo', 'olvidalo',
    'borra ese dato', 'olvida ese dato'],

  // ── social ──
  recado: ['preguntale', 'dile', 'digale', 'mandale', 'avisale', 'cuentale', 'escribele', 'un recado',
    'mensaje para', 'de mi parte'],
  cosquillas: ['cosquillas', 'cosquilla', 'hazme reir', 'me haces reir', 'te hago cosquillas', 'jajaja',
    'jejeje', 'jijiji'],
  afinidad: ['con quien me parezco', 'me parezco', 'parecido', 'afinidad', 'en comun', 'mejor amigo',
    'quien se parece', 'quien es como yo', 'quien tiene mis gustos'],
  grupo: ['el grupo', 'los amigos', 'participantes', 'quienes estan', 'quienes somos', 'quienes hay',
    'cuantos somos', 'cuantos faltan', 'cuanto falta', 'lista de amigos', 'ya estamos completos',
    'quienes van'],
  quienEs: ['quien es', 'hablame de', 'cuentame de', 'conoces a', 'como es', 'que dice de', 'descripcion de',
    'quien seria', 'que sabes de', 'que me dices de', 'dime de', 'describeme a', 'informacion de',
    'datos de', 'que le gusta a', 'que quiere', 'que pidio', 'cuentame sobre', 'sabes algo de'],

  // Preguntar por MI AMIGO SECRETO no es preguntar por mi. Esta entrada existe
  // para que no se la coma la rama de la memoria propia, que reconoce
  // "que sabes de mi" y se disparaba tambien con "que sabes de mi amigo".
  miAmigo: ['mi amigo secreto', 'mi amiga secreta', 'mi amigo', 'mi amiga', 'a quien le regalo',
    'a quien tengo que regalar', 'el que me toco', 'la que me toco', 'a quien saque yo',
    'para quien compro', 'a quien le toca mi regalo'],

  // Jugar de verdad: sustos y chistes
  susto: ['asustame', 'dame un susto', 'hazme un susto', 'pegame un susto', 'asusta', 'da miedo',
    'hazme asustar', 'espantame'],
  chiste: ['un chiste', 'cuentame un chiste', 'dime un chiste', 'algo gracioso', 'una broma',
    'hazme reir', 'cuentame una broma', 'dime algo chistoso', 'echate un chiste'],
  jugar: ['juguemos', 'jugar', 'un juego', 'adivina', 'adivinanza', 'trivia', 'estoy aburrido', 'me aburro',
    'entretenme', 'algo divertido', 'hazme jugar'],

  // ── regalos y evento ──
  ideas: ['dame ideas', 'una idea', 'ideas de regalo', 'que le regalo', 'que le compro', 'que compro',
    'sugerencia', 'sugiereme', 'recomiendame', 'recomienda', 'no se que regalar', 'que puedo regalar',
    'ideas para'],
  consejo: ['que hago', 'que me recomiendas', 'aconsejame', 'un consejo', 'que me aconsejas',
    'ayudame a decidir', 'que opinas', 'tu que harias', 'dame un consejo'],
  presupuesto: ['el monto', 'presupuesto', 'cuanto gasto', 'cuanto gastamos', 'cuanto cuesta', 'el precio',
    'cuanto es', 'de cuanto', 'cuanta plata'],
  fechaEvento: ['la fecha', 'cuando es', 'que dia', 'el lugar', 'donde es', 'donde sera', 'a que hora',
    'cuando nos vemos'],
  reglas: ['las reglas', 'como funciona', 'que hago aqui', 'ayudame', 'no entiendo', 'el sorteo',
    'como es esto', 'explicame'],
  miLista: ['mi lista', 'mis deseos', 'que pedi', 'mi perfil', 'que aprendiste', 'que tengo pedido'],

  // ── el mundo ──
  contar: ['cuentame algo', 'cuentame una', 'cuentame otra', 'cuentame esto', 'dime algo', 'hablame de algo',
    'que me cuentas', 'una historia', 'cuenta algo', 'cuentame mas'],
  navidad: ['la navidad', 'navideno', 'el amor', 'la amistad', 'el carino', 'hermandad', 'que significa',
    'por que es bonito', 'reflexion', 'acordarse de alguien', 'el espiritu'],

  // ── como se siente la persona ──
  triste: ['estoy triste', 'me siento triste', 'estoy mal', 'me siento mal', 'estoy bajoneado',
    'estoy deprimido', 'me siento solo', 'estoy solo', 'extrano mucho', 'tengo pena', 'ando triste',
    'me da pena', 'estoy llorando', 'quiero llorar', 'me siento vacio'],
  feliz: ['estoy feliz', 'estoy contento', 'me siento feliz', 'estoy alegre', 'que alegria',
    'estoy emocionado', 'ando feliz', 'me siento bien', 'estoy de buen humor'],

  // ── cortesia ──
  gracias: ['gracias', 'muchas gracias', 'genial', 'excelente', 'perfecto', 'te quiero', 'eres lo maximo',
    'crack', 'buenazo', 'que bueno eres'],
  saludo: ['hola', 'buenas', 'hey', 'que tal', 'holi', 'saludos', 'buen dia', 'buenas tardes',
    'buenas noches', 'buenos dias']
};

/**
 * Si estas palabras estan en la clausula, el hecho NO se toma. Evita los
 * falsos positivos tipicos de buscar patrones sueltos.
 */
const EXCLUSIONES = {
  // "que sabes de MI AMIGO secreto" no es una pregunta sobre uno mismo
  recordar: ['mi amigo', 'mi amiga', 'amigo secreto', 'amiga secreta'],
  miLista: ['mi amigo', 'mi amiga', 'amigo secreto'],
  recado: ['dilema', 'dile a nadie'],
  jugar: ['jugador'],
  navidad: ['feliz navidad', 'navidad a todos'],
  dormir: ['no descanso', 'yo descanso', 'yo me duermo', 'me voy a dormir', 'no puedo dormir'],
  despertar: ['me desperte', 'desperte'],
  grupo: ['grupo de whatsapp'],
  saludo: ['hola que tal te digo']
};

/** El vocabulario con el que se corrige lo mal escrito. */
const VOCABULARIO = (() => {
  const v = new Set();
  for (const lista of Object.values(LEXICO)) {
    for (const patron of lista) {
      for (const p of normalizar(patron).split(' ')) if (p.length >= 4) v.add(p);
    }
  }
  // palabras del dominio que conviene corregir aunque no esten en un patron
  for (const p of ['regalo', 'regalos', 'amigo', 'amiga', 'amigos', 'secreto', 'navidad', 'duende',
    'chocolate', 'cafe', 'libro', 'libros', 'musica', 'pelicula', 'peliculas', 'futbol', 'cerveza',
    'perfume', 'taza', 'audifonos', 'polo', 'camisa', 'zapatillas', 'cumpleanos', 'talla', 'color',
    'gusta', 'gustan', 'encanta', 'odio', 'detesto', 'quiero', 'sorteo', 'grupo', 'nombre']) v.add(p);
  return [...v];
})();

/** Paso 3: corregir lo mal escrito contra el vocabulario (difflib). */
function corregir(clausula) {
  const correcciones = [];
  const palabras = normalizar(clausula).split(' ').map(w => {
    if (w.length < 4 || /^\d+$/.test(w)) return w;
    // si ya es (o empieza como) una palabra conocida, se deja en paz
    if (VOCABULARIO.some(v => w.startsWith(v) || v.startsWith(w))) return w;
    const m = nlp.masParecida(w, VOCABULARIO, 0.82);
    if (m && Math.abs(m.palabra.length - w.length) <= 2) {
      correcciones.push({ mala: w, buena: m.palabra, ratio: m.ratio });
      return m.palabra;
    }
    return w;
  });
  return { texto: palabras.join(' '), correcciones };
}

/**
 * Paso 5a: mira hacia atras para decidir si lo encontrado viene negado.
 * "no es mi regalo" -> negado.  "no prende el regalo" -> no negado, porque
 * entre medio hay una palabra que corta (no es puente).
 */
function estaNegado(antes) {
  const palabras = String(antes).split(/\s+/).filter(Boolean).slice(-4);
  for (let i = palabras.length - 1; i >= 0; i--) {
    const w = palabras[i];
    if (NEGADORES.has(w)) return true;
    if (!PUENTE.has(w)) return false;
  }
  return false;
}

function hayDuda(clausula) {
  return DUDAS.some(d => new RegExp('\\b' + escapar(d) + '\\b').test(clausula));
}
function haySeguridad(clausula) {
  return SEGURIDAD.some(d => new RegExp('\\b' + escapar(d) + '\\b').test(clausula));
}

// patrones compilados una sola vez al cargar el modulo
const PATRONES = {};
for (const [hecho, lista] of Object.entries(LEXICO)) {
  PATRONES[hecho] = lista.map(p => ({ patron: p, regex: compilarPatron(p) })).filter(x => x.regex);
}

// ---------------------------------------------------------------------------
// GUSTOS: la parte abierta, donde el valor no esta en ningun diccionario
// ---------------------------------------------------------------------------
const VERBOS_GUSTO = [
  'me gustan', 'me gusta', 'me encantan', 'me encanta', 'me fascinan', 'me fascina',
  'me muero por', 'soy fan de', 'soy hincha de', 'soy fanatico de', 'soy adicto a',
  'me apasiona', 'adoro', 'amo', 'prefiero', 'disfruto', 'colecciono',
  'quisiera', 'me gustaria', 'quiero', 'pidele', 'necesito', 'sueno con'
];
const VERBOS_DISGUSTO = [
  'no me gustan', 'no me gusta', 'odio', 'detesto', 'no soporto', 'aborrezco',
  'me da asco', 'no aguanto', 'no quiero', 'me molesta', 'me chocan', 'me choca'
];

const RELLENO_INICIAL = /^(?:el|la|los|las|un|una|unos|unas|de|del|al|a|que|mucho|mucha|muy|bastante|tanto|tanta)\s+/i;

/** Limpia el valor de un gusto: "el chocolate amargo" -> "chocolate amargo". */
function limpiarValor(v) {
  let t = String(v || '').trim();
  let antes;
  do { antes = t; t = t.replace(RELLENO_INICIAL, ''); } while (t !== antes);
  return t.replace(/\s+/g, ' ').replace(/[.!?]+$/, '').trim();
}

/**
 * Saca los gustos de una frase, clausula por clausula y con la negacion
 * aplicada: "no me gusta el cilantro pero amo el chocolate" devuelve dos
 * senales de signo contrario.
 */
function extraerGustos(texto, certezaBase) {
  const base = certezaBase === undefined ? 1 : certezaBase;
  const salida = [];

  for (const cruda of clausulas(texto)) {
    const { texto: c } = corregir(cruda);
    if (!c) continue;
    const duda = hayDuda(c);
    const seguro = haySeguridad(c);
    const factor = base * (duda ? 0.6 : seguro ? 1 : 0.9);

    // primero los verbos de disgusto, que son mas especificos
    let encontrado = false;
    for (const lista of [VERBOS_DISGUSTO, VERBOS_GUSTO]) {
      const negativoDeFabrica = lista === VERBOS_DISGUSTO;
      for (const verbo of lista) {
        const rx = new RegExp('\\b' + escapar(verbo) + '\\b');
        const m = rx.exec(c);
        if (!m) continue;

        // la negacion da la vuelta al signo: "no odio" es, en el fondo, gusta
        const negado = !negativoDeFabrica && estaNegado(c.slice(0, m.index));
        const tipo = (negativoDeFabrica !== negado) ? 'no_gusta' : 'gusta';

        const resto = limpiarValor(c.slice(m.index + m[0].length));
        if (resto.length >= 3) {
          for (const trozo of resto.split(/\s+y\s+|\s+ni\s+|\s+o\s+|,/)) {
            const v = limpiarValor(trozo);
            if (v.length >= 3 && v.length <= 80) {
              salida.push({
                valor: v, tipo,
                certeza: Number(factor.toFixed(2)),
                duda, evidencia: m[0] + ' ' + v
              });
            }
          }
        }
        encontrado = true;
        break;
      }
      if (encontrado) break;
    }
  }
  return salida;
}

// ---------------------------------------------------------------------------
// NUMEROS Y DATOS CONCRETOS
// ---------------------------------------------------------------------------
function reglasNumericas(t) {
  const datos = {};
  let m;

  // "mi talla es M", "talla de ropa L", "uso talla 38": el verbo y los
  // articulos de en medio se saltan, y una palabra de relleno no es una talla.
  if ((m = /\btalla\s+(?:de\s+)?(?:ropa\s+)?(?:es\s+|la\s+|una\s+)?([a-z0-9]{1,4})\b/.exec(t)) &&
      !['es', 'la', 'de', 'del', 'en', 'una', 'un', 'y', 'mi', 'que'].includes(m[1])) {
    datos.talla_ropa = m[1].toUpperCase();
  }
  if ((m = /\b(?:zapato|calzado|zapatilla[a-z]*)\s*(?:talla\s*)?(\d{2})\b/.exec(t))) datos.talla_zapato = m[1];
  if ((m = /\b(?:hasta|maximo|tope|como|unos|son)?\s*(\d{1,4})\s*(?:soles|s\/|lucas)\b/.exec(t))) datos.presupuesto = Number(m[1]);
  if ((m = /\bs\s*\/?\s*(\d{1,4})\b/.exec(t))) datos.presupuesto = datos.presupuesto || Number(m[1]);
  if ((m = /\btengo\s+(\d{1,2})\s*anos\b/.exec(t))) datos.edad = Number(m[1]);
  if ((m = /\bcolor\s+(?:favorito\s+)?(?:es\s+)?([a-z]{3,12})\b/.exec(t))) datos.color = m[1];
  if (/\b(no se|ni idea|no tengo idea|cualquier cosa)\b/.test(t)) datos.indeciso = true;

  return datos;
}

// ---------------------------------------------------------------------------
// LA FUNCION PRINCIPAL
// ---------------------------------------------------------------------------

/**
 * Frase libre -> lo que el duende entendio.
 *
 * @param  {string} texto
 * @param  {object} opciones  { certezaBase, origen }
 * @return {object} {
 *   hechos:       { intencion: { certeza, evidencia, duda, clausula } },
 *   gustos:       [ { valor, tipo, certeza, evidencia } ],
 *   datos:        { talla_ropa, presupuesto, ... },
 *   correcciones: [ { mala, buena, ratio } ],
 *   clausulas:    [...],
 *   duda:         bool
 * }
 */
function comprender(texto, opciones) {
  const base = (opciones && opciones.certezaBase) || 1;
  const origen = (opciones && opciones.origen) || 'texto';

  const hechos = {};
  const correcciones = [];
  const partes = [];
  let dudaGlobal = false;

  const agregar = (hecho, certeza, evidencia, clausula, duda) => {
    if (hechos[hecho]) {
      // dos evidencias de lo mismo se combinan al estilo MYCIN
      hechos[hecho].certeza = nlp.combinarCerteza(hechos[hecho].certeza, certeza);
      if (evidencia.length > hechos[hecho].evidencia.length) hechos[hecho].evidencia = evidencia;
    } else {
      hechos[hecho] = {
        certeza: Number(certeza.toFixed(2)), evidencia, clausula, duda: !!duda, origen
      };
    }
  };

  for (const cruda of clausulas(texto)) {
    const cor = corregir(cruda);
    const c = cor.texto;
    if (!c) continue;
    correcciones.push(...cor.correcciones);
    partes.push(c);

    const duda = hayDuda(c);
    if (duda) dudaGlobal = true;
    const certeza = base * (duda ? 0.6 : 1);

    for (const [hecho, lista] of Object.entries(PATRONES)) {
      const fuera = EXCLUSIONES[hecho];
      if (fuera && fuera.some(x => c.includes(normalizar(x)))) continue;

      for (const { regex } of lista) {
        const m = regex.exec(c);
        if (!m) continue;
        // una intencion negada no es una intencion: "no me cuentes nada"
        if (estaNegado(c.slice(0, m.index))) break;
        agregar(hecho, certeza, m[0], c, duda);
        break;
      }
    }
  }

  const plano = normalizar(texto);
  return {
    hechos,
    gustos: extraerGustos(texto, base),
    datos: reglasNumericas(plano),
    correcciones,
    clausulas: partes,
    duda: dudaGlobal,
    texto: plano
  };
}

/**
 * Orden de desempate cuando una frase dispara varias intenciones a la vez.
 * No es un gusto estetico: "si alguien pregunta por mi DILE que..." lleva
 * dentro un "dile", que es la forma de pedir un recado. Lo de arriba manda.
 *
 * Primero lo que nunca se contesta (fisgon), luego las ordenes, luego la
 * memoria, y al final la charla.
 */
const PRIORIDAD = [
  'fisgon',
  'despertar', 'dormir', 'hablarYa', 'callar',
  'recadoPublico', 'guardar', 'olvidar', 'recordar',
  'recado', 'cosquillas', 'triste', 'feliz',
  'afinidad', 'grupo', 'miAmigo', 'quienEs', 'jugar', 'susto', 'chiste',
  'ideas', 'consejo', 'miLista', 'presupuesto', 'fechaEvento', 'reglas',
  'contar', 'navidad',
  'gracias', 'saludo'
];

function rangoDe(hecho) {
  const i = PRIORIDAD.indexOf(hecho);
  return i < 0 ? 999 : i;
}

/**
 * La intencion por la que conviene empezar a responder: primero la certeza
 * (si la diferencia es clara) y, cuando van parejas, el orden de PRIORIDAD.
 */
function intencionPrincipal(r, minimo) {
  const tope = minimo === undefined ? 0.5 : minimo;
  let mejor = null;
  for (const [hecho, info] of Object.entries(r.hechos)) {
    if (info.certeza < tope) continue;
    const cand = Object.assign({ hecho, rango: rangoDe(hecho) }, info);
    if (!mejor ||
        cand.certeza > mejor.certeza + 0.15 ||
        (Math.abs(cand.certeza - mejor.certeza) <= 0.15 && cand.rango < mejor.rango)) {
      mejor = cand;
    }
  }
  return mejor;
}

/** Todas las intenciones que pasaron el umbral, en orden de prioridad. */
function intenciones(r, minimo) {
  const tope = minimo === undefined ? 0.5 : minimo;
  return Object.entries(r.hechos)
    .filter(function (e) { return e[1].certeza >= tope; })
    .map(function (e) { return Object.assign({ hecho: e[0], rango: rangoDe(e[0]) }, e[1]); })
    .sort(function (a, b) { return a.rango - b.rango; });
}

/**
 * La traza, en cristiano: que entendio y que corrigio. Es el equivalente a
 * mostrar el razonamiento del motor de inferencia, pero para que lo lea la
 * persona y pueda corregir al duende si se equivoco.
 */
function explicar(r) {
  const trozos = [];
  if (r.correcciones.length) {
    const vistas = [];
    for (const c of r.correcciones) {
      const clave = c.mala + '>' + c.buena;
      if (!vistas.includes(clave)) { vistas.push(clave); }
    }
    trozos.push('leí <i>' + vistas.slice(0, 3).map(v => {
      const [mala, buena] = v.split('>');
      return '«' + mala + '» como «' + buena + '»';
    }).join(', ') + '</i>');
  }
  if (r.duda) trozos.push('me sonó a que no estabas del todo seguro');
  const g = r.gustos.filter(x => x.tipo === 'gusta').map(x => x.valor);
  const n = r.gustos.filter(x => x.tipo === 'no_gusta').map(x => x.valor);
  if (g.length) trozos.push('te gusta <b>' + g.slice(0, 3).join('</b>, <b>') + '</b>');
  if (n.length) trozos.push('NO te va <b>' + n.slice(0, 3).join('</b>, <b>') + '</b>');
  return trozos.length ? trozos.join(' · ') : null;
}

module.exports = {
  LEXICO, EXCLUSIONES, VOCABULARIO, NEGADORES, PUENTE, DUDAS, ABREVIATURAS, CONECTORES, PRIORIDAD,
  normalizar, clausulas, corregir, compilarPatron, estaNegado, hayDuda,
  extraerGustos, reglasNumericas, comprender, intencionPrincipal, intenciones, explicar
};
