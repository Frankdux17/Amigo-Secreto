'use strict';
/**
 * ============================================================================
 *  navidad.js - LO QUE EL DUENDE SABE DEL MUNDO
 * ============================================================================
 *
 *  El duende no solo responde sobre regalos: tambien tiene algo que decir
 *  sobre la Navidad, la amistad, el amor y el valor de acordarse de alguien.
 *
 *  Este modulo es su "conocimiento de base": un corpus tematico que se indexa
 *  con TF-IDF (ver nlp.js) para que, cuando alguien le hable de cualquier
 *  tema, pueda recuperar lo que mejor calza y responder con sentido en vez de
 *  con una frase al azar. Tambien alimenta la cadena de Markov para que
 *  improvise con vocabulario navideno propio.
 *
 *  Y guarda sus preguntas: el duende es preguntón a proposito, porque cada
 *  respuesta que recibe es una senal nueva que aprende (knn.js).
 * ============================================================================
 */

const nlp = require('./nlp');

// ---------------------------------------------------------------------------
// El corpus: cada entrada tiene un tema, el texto y de que habla
// ---------------------------------------------------------------------------
const SABER = [
  {
    tema: 'navidad',
    texto: 'La Navidad no es el arbol ni las luces. Es la unica epoca del ano en que todos se acuerdan de todos al mismo tiempo. Esta hecha para recordar el amor: a quien lo dio, a quien lo recibio y a quien todavia nos espera.',
    etiquetas: 'navidad diciembre fiesta arbol luces amor recordar'
  },
  {
    tema: 'navidad',
    texto: 'Lo bonito de la Navidad es que obliga a parar. Durante once meses uno corre; en diciembre uno se sienta, mira alrededor y se da cuenta de a quien tiene y a quien extrana.',
    etiquetas: 'navidad diciembre parar tiempo familia extranar'
  },
  {
    tema: 'amor',
    texto: 'El amor no siempre se dice con palabras grandes. A veces es acordarse de que a alguien le gusta el cafe sin azucar, o guardarle el ultimo pedazo. Un regalo pensado es una carta de amor sin letras.',
    etiquetas: 'amor carino detalle regalo pensar acordarse'
  },
  {
    tema: 'amor',
    texto: 'Querer a alguien es querer que le vaya bien incluso cuando no estas mirando. Eso vale para la pareja, para la familia y para los amigos.',
    etiquetas: 'amor querer bien amistad familia pareja'
  },
  {
    tema: 'amistad',
    texto: 'Los amigos de verdad no se miden por cuanto se ven, sino por lo facil que es retomar. Hay gente con la que no hablas en meses y al primer mensaje es como si nunca se hubieran separado.',
    etiquetas: 'amistad amigos tiempo distancia retomar hermanos'
  },
  {
    tema: 'amistad',
    texto: 'Un amigo es el que estuvo cuando no habia nada que ganar. Por eso los companeros de trabajo que siguen siendo amigos despues de cambiar de empresa son los mas valiosos: ya nadie los obliga a quedarse.',
    etiquetas: 'amistad amigos trabajo empresa companeros lealtad hermanos'
  },
  {
    tema: 'amistad',
    texto: 'Todos los amigos son buenos para algo distinto: uno para reir, otro para escuchar, otro para sacarte de un apuro a medianoche. El grupo completo es el que te sostiene.',
    etiquetas: 'amistad amigos grupo reir escuchar apoyo'
  },
  {
    tema: 'recordar',
    texto: 'Acordarse de alguien es la forma mas barata y mas valiosa de querer. No cuesta plata y no se acaba. Cuando le dices a una persona "me acorde de ti", le estas diciendo que ocupa espacio en tu cabeza aunque no este presente.',
    etiquetas: 'recordar memoria acordarse querer presente ausencia'
  },
  {
    tema: 'recordar',
    texto: 'La memoria es lo unico que no te pueden quitar. Las aventuras que compartiste con tu gente ya pasaron, pero el recuerdo sigue siendo tuyo y de ellos al mismo tiempo. Eso es lo mas parecido a tener algo en comun para siempre.',
    etiquetas: 'memoria recuerdo aventuras compartir pasado comun'
  },
  {
    tema: 'regalar',
    texto: 'Regalar bien no es gastar mas, es escuchar mejor. El mejor regalo es el que le dice a la otra persona "te presto atencion todo el ano, no solo hoy".',
    etiquetas: 'regalo regalar escuchar atencion dinero monto'
  },
  {
    tema: 'regalar',
    texto: 'El amigo secreto es un juego con truco: parece que se trata de comprar algo, pero en realidad te obliga a averiguar quien es la otra persona. Al final aprendes mas de tu amigo que lo que gastas.',
    etiquetas: 'amigo secreto sorteo juego regalo conocer averiguar'
  },
  {
    tema: 'gratitud',
    texto: 'Dar gracias en voz alta cambia el ambiente de una mesa entera. Prueba esta Navidad: dile a cada uno una cosa concreta por la que lo agradeces. Vas a ver caras que no olvidas.',
    etiquetas: 'gracias gratitud agradecer mesa cena navidad decir'
  },
  {
    tema: 'tristeza',
    texto: 'En Navidad tambien se extrana, y eso no esta mal. La silla vacia duele porque alguien importante la lleno. Extranar es la factura del carino: si no hubieras querido tanto, no dolerian las fiestas.',
    etiquetas: 'triste tristeza extranar ausencia duelo silla vacia navidad soledad'
  },
  {
    tema: 'tristeza',
    texto: 'Si estas bajoneado, hablalo con alguien del grupo. La tristeza compartida pesa la mitad, y la alegria compartida vale el doble. Para eso existen los amigos.',
    etiquetas: 'triste bajon animo hablar compartir amigos apoyo'
  },
  {
    tema: 'duende',
    texto: 'Yo soy un duende de taller. Llevo siglos envolviendo regalos y aprendi que el papel importa poco: lo que la gente recuerda es la cara de quien se los dio. Por eso me gusta tanto este trabajo.',
    etiquetas: 'duende taller santa trabajo envolver regalos quien soy'
  },
  {
    tema: 'duende',
    texto: 'Mi trabajo favorito no es cargar el trineo: es escuchar. Mientras ustedes conversan yo voy anotando, y cuando llega diciembre ya se lo que cada uno necesita. Guardo todos los secretos hasta el final.',
    etiquetas: 'duende escuchar anotar secretos aprender memoria'
  }
];

// ---------------------------------------------------------------------------
// Historias cortas para "cuentame algo"
// ---------------------------------------------------------------------------
const HISTORIAS = [
  'Te cuento una del taller 🧝 Una vez un nino pidio "nada, que mi mama descanse". Fue el unico pedido que no pudimos envolver, y el unico que todos recordamos. Desde ese dia anoto tambien lo que la gente no se atreve a pedir.',
  'Hay un trineo viejo en el fondo del taller que ya no vuela. No lo botamos porque en su madera estan talladas las iniciales de todos los duendes que pasaron por aqui. Las cosas valen por quien las toco, no por si funcionan.',
  'Una vez envolvi un regalo durante tres horas: un pedazo de papel con una frase escrita. Era de un senor para su amigo de toda la vida, al que no veia en veinte anos. Decia solo "me acorde de ti". Nunca vi a nadie llorar tanto por tan poco papel.',
  'Los duendes tenemos una regla: nunca se revela quien dio que. No por misterio, sino porque cuando no sabes de quien viene el carino, lo repartes entre todos. Y asi el grupo entero se quiere un poquito mas.',
  'En el taller medimos la Navidad en cascabeles. Cada vez que alguien se acuerda de otra persona sin motivo, suena uno. Diciembre es ruidosisimo 🔔'
];

// ---------------------------------------------------------------------------
// Preguntas: el duende es preguntón porque cada respuesta le ensena algo
// ---------------------------------------------------------------------------
const PREGUNTAS = [
  { texto: 'Cuentame una cosa: si pudieras pedir algo que no se compra con plata, que pedirias?', aprende: 'deseo' },
  { texto: 'Que es lo mejor que te ha regalado alguien? No vale decir "nada" 😄', aprende: 'gusta' },
  { texto: 'Cual es tu recuerdo favorito con esta gente del grupo?', aprende: 'historia' },
  { texto: 'Que te hace reir sin falla, siempre?', aprende: 'gusta' },
  { texto: 'Hay algo que NO quieres que te regalen nunca? Lo apunto para protegerte 😅', aprende: 'no_gusta' },
  { texto: 'Si tuvieras que describirte en tres palabras para que te conozcan, cuales serian?', aprende: 'dato' },
  { texto: 'Que sueles hacer un domingo cuando nadie te apura?', aprende: 'hobbie' },
  { texto: 'Para ti, que es lo que no puede faltar en una Navidad?', aprende: 'gusta' },
  { texto: 'Hay alguien del grupo con quien te gustaria conversar mas? Puedo llevarle un recado 💌', aprende: null },
  { texto: 'Que cancion te suena a diciembre?', aprende: 'gusta' }
];

// ---------------------------------------------------------------------------
// Indice TF-IDF del corpus: se arma una sola vez al cargar el modulo
// ---------------------------------------------------------------------------
const indice = new nlp.TfIdf();
SABER.forEach((s, i) => indice.agregar(i, s.texto + ' ' + s.etiquetas, { tema: s.tema }));

/** Lo que el duende sabe que mas se parece a lo que le preguntaron. */
function consultar(texto, n) {
  const res = indice.buscar(texto, n === undefined ? 1 : n, 0.05);
  return res.map(r => ({ tema: r.meta.tema, texto: SABER[r.id].texto, score: Number(r.score.toFixed(3)) }));
}

/** Una reflexion de un tema concreto (o de cualquiera). */
function reflexion(tema) {
  const pool = tema ? SABER.filter(s => s.tema === tema) : SABER;
  const lista = pool.length ? pool : SABER;
  return lista[Math.floor(Math.random() * lista.length)].texto;
}

function historia() {
  return HISTORIAS[Math.floor(Math.random() * HISTORIAS.length)];
}

function pregunta() {
  return PREGUNTAS[Math.floor(Math.random() * PREGUNTAS.length)];
}

/**
 * Corpus plano para entrenar la cadena de Markov. Es texto publico y
 * curado: ninguna frase de aqui pertenece a un participante, asi que el
 * duende puede improvisar con el sin riesgo de filtrar nada de nadie.
 */
function corpus() {
  return SABER.map(s => s.texto).concat(HISTORIAS).join(' ');
}

/** Temas de los que el duende puede hablar, para ofrecerlos como sugerencia. */
const TEMAS = [...new Set(SABER.map(s => s.tema))];

module.exports = { SABER, HISTORIAS, PREGUNTAS, TEMAS, consultar, reflexion, historia, pregunta, corpus };
