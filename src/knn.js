'use strict';
/**
 * ============================================================================
 *  MOTOR DE APRENDIZAJE DEL DUENDE
 *  k-NN (k vecinos más cercanos) + filtrado colaborativo, sin dependencias.
 * ============================================================================
 *
 *  La idea en una línea: a cada amigo lo convertimos en un VECTOR de intereses
 *  y, para recomendarle un regalo, miramos qué piden los amigos que más se le
 *  parecen. Eso es exactamente k-NN aplicado a recomendación.
 *
 *  El recorrido completo:
 *
 *   1. VECTORIZAR. Cada texto ("me gusta la guitarra y el café") se convierte
 *      en un vector disperso {dimensión: peso}. Las dimensiones son de dos
 *      clases: categorías del catálogo (cat:musica) y palabras sueltas
 *      (tok:guitarra). Las categorías generalizan, los tokens dan precisión.
 *
 *   2. PESAR. No todas las señales valen igual: lo que alguien escribe en su
 *      perfil pesa más que una palabra suelta del chat, y lo que repite varias
 *      veces pesa más que lo que dijo una vez. Los "no me gusta" entran con
 *      peso negativo, así restan en vez de sumar.
 *
 *   3. NORMALIZAR. Se divide cada vector por su norma euclídea, de modo que
 *      quien escribió mucho no gane solo por hablar más que los demás.
 *
 *   4. SIMILITUD DEL COSENO. sim(a,b) = (a·b) / (|a|·|b|). Como ya están
 *      normalizados, basta el producto punto. Da 1 si apuntan igual, 0 si no
 *      tienen nada que ver y negativo si se contradicen.
 *
 *   5. k-NN. Se ordenan los demás por similitud y nos quedamos con los k
 *      primeros: esos son los vecinos.
 *
 *   6. RECOMENDAR (filtrado colaborativo basado en usuario). Para cada idea
 *      candidata se suma la similitud de los vecinos a quienes les encaja:
 *
 *          score(idea) = Σ sim(yo, vecino) · afinidad(vecino, idea)
 *
 *      Es la fórmula clásica de user-based CF: la opinión de un vecino pesa
 *      tanto como se te parezca.
 *
 *  Nota sobre el arranque en frío: con el grupo vacío no hay vecinos de los
 *  que aprender, así que las ideas salen del catálogo por coincidencia directa
 *  y se van reemplazando por recomendaciones colaborativas a medida que la
 *  gente llena su perfil y habla con el duende.
 * ============================================================================
 */

const { all, get, run } = require('./db');

// --------------------------------------------------------------------------
// Catálogo de categorías. Cada una tiene palabras clave (para detectarla en
// un texto) e ideas de regalo (para proponerlas).
// --------------------------------------------------------------------------
const CATALOGO = {
  tecnologia: {
    nombre: 'Tecnología',
    claves: ['tecnologia', 'tecnología', 'tech', 'gadget', 'celular', 'computadora', 'laptop', 'pc', 'audifonos', 'audífonos', 'auriculares', 'bluetooth', 'usb', 'cargador', 'smartwatch', 'reloj inteligente', 'parlante', 'teclado', 'mouse', 'camara', 'cámara', 'drone', 'tablet'],
    ideas: ['audífonos bluetooth', 'un parlante portátil', 'un power bank', 'un soporte para el celular', 'luces LED para el escritorio', 'un mouse inalámbrico']
  },
  gamer: {
    nombre: 'Gamer',
    claves: ['gamer', 'videojuego', 'videojuegos', 'juego', 'juegos', 'play', 'playstation', 'xbox', 'nintendo', 'switch', 'steam', 'consola', 'ps5', 'fortnite', 'minecraft', 'lol', 'dota'],
    ideas: ['una tarjeta de regalo de Steam', 'un mousepad gamer XL', 'un soporte para audífonos', 'un control extra', 'una figura de su juego favorito']
  },
  lectura: {
    nombre: 'Lectura',
    claves: ['leer', 'lectura', 'libro', 'libros', 'novela', 'novelas', 'comic', 'cómic', 'manga', 'poesia', 'poesía', 'autor', 'kindle'],
    ideas: ['un libro de su autor favorito', 'un separador de páginas bonito', 'una lámpara de lectura', 'un cuaderno de notas', 'una tarjeta de librería']
  },
  deporte: {
    nombre: 'Deporte',
    claves: ['deporte', 'deportes', 'gimnasio', 'gym', 'correr', 'running', 'futbol', 'fútbol', 'basquet', 'básquet', 'voley', 'vóley', 'natacion', 'natación', 'bicicleta', 'ciclismo', 'pesas', 'yoga', 'trekking', 'montaña'],
    ideas: ['un termo deportivo', 'una toalla de microfibra', 'bandas de resistencia', 'una mochila ligera', 'medias deportivas buenas']
  },
  cocina: {
    nombre: 'Cocina',
    claves: ['cocina', 'cocinar', 'reposteria', 'repostería', 'hornear', 'postre', 'postres', 'chef', 'recetas', 'parrilla', 'bbq'],
    ideas: ['un set de especias', 'un delantal divertido', 'una tabla de picar de madera', 'un molde para hornear', 'un libro de recetas']
  },
  cafe: {
    nombre: 'Café y té',
    claves: ['cafe', 'café', 'te', 'té', 'infusion', 'infusión', 'cafetera', 'capuccino', 'espresso', 'matcha'],
    ideas: ['una taza térmica', 'café de grano de origen', 'una prensa francesa', 'un set de tés', 'un espumador de leche']
  },
  belleza: {
    nombre: 'Belleza y cuidado',
    claves: ['belleza', 'skincare', 'maquillaje', 'perfume', 'crema', 'cuidado', 'spa', 'uñas', 'cabello', 'labial'],
    ideas: ['un set de skincare', 'una crema de manos buena', 'un perfume pequeño', 'una mascarilla facial', 'un neceser bonito']
  },
  moda: {
    nombre: 'Moda',
    claves: ['moda', 'ropa', 'zapatos', 'zapatillas', 'polo', 'camisa', 'casaca', 'gorra', 'accesorios', 'aretes', 'collar', 'pulsera', 'lentes', 'cartera', 'billetera'],
    ideas: ['una gorra', 'una bufanda tejida', 'medias divertidas', 'una billetera', 'un gorro de invierno']
  },
  musica: {
    nombre: 'Música',
    claves: ['musica', 'música', 'guitarra', 'piano', 'cantar', 'cantante', 'banda', 'concierto', 'vinilo', 'spotify', 'bateria', 'batería', 'ukelele', 'violin', 'violín'],
    ideas: ['un vinilo de su banda', 'audífonos buenos', 'púas de guitarra', 'una suscripción de música', 'un afinador']
  },
  arte: {
    nombre: 'Arte',
    claves: ['arte', 'dibujar', 'dibujo', 'pintar', 'pintura', 'acuarela', 'manualidades', 'diseño', 'diseno', 'foto', 'fotografia', 'fotografía', 'tejer', 'crochet'],
    ideas: ['un set de acuarelas', 'un cuaderno de dibujo', 'lápices de colores profesionales', 'un kit de manualidades', 'un marco para fotos']
  },
  hogar: {
    nombre: 'Hogar',
    claves: ['casa', 'hogar', 'decoracion', 'decoración', 'planta', 'plantas', 'jardin', 'jardín', 'vela', 'velas', 'manta', 'cojin', 'cojín', 'cuadro', 'ambientador'],
    ideas: ['una planta pequeña', 'velas aromáticas', 'una manta suave', 'un cuadro decorativo', 'un difusor de aromas']
  },
  mascotas: {
    nombre: 'Mascotas',
    claves: ['perro', 'perrito', 'gato', 'gatito', 'mascota', 'mascotas', 'michi', 'firulais', 'veterinaria'],
    ideas: ['un juguete para su mascota', 'una correa bonita', 'snacks para mascota', 'una cama pequeña', 'un collar con placa']
  },
  viajes: {
    nombre: 'Viajes',
    claves: ['viajar', 'viaje', 'viajes', 'mochila', 'playa', 'aventura', 'camping', 'turismo', 'maleta'],
    ideas: ['una almohada de viaje', 'un organizador de maleta', 'una cantimplora', 'un mapa raspable', 'una riñonera']
  },
  oficina: {
    nombre: 'Oficina y estudio',
    claves: ['oficina', 'escritorio', 'estudiar', 'estudio', 'universidad', 'trabajo', 'agenda', 'cuaderno', 'lapicero', 'planner', 'organizador'],
    ideas: ['una agenda 2027', 'un organizador de escritorio', 'una lámpara de escritorio', 'un set de lapiceros buenos', 'un portalápices']
  },
  dulces: {
    nombre: 'Dulces',
    claves: ['dulce', 'dulces', 'chocolate', 'chocolates', 'golosina', 'torta', 'galletas', 'caramelo', 'panetón', 'paneton'],
    ideas: ['una caja de chocolates', 'una canasta de dulces', 'un panetón artesanal', 'galletas decoradas', 'un chocolate gourmet grande']
  }
};

const COMODIN = [
  'una taza personalizada con su foto',
  'un set de velas aromáticas',
  'una planta pequeña para su escritorio',
  'un cuaderno bonito',
  'una caja de chocolates'
];

// --------------------------------------------------------------------------
// 1. VECTORIZAR
// --------------------------------------------------------------------------

// Palabras vacías: no aportan información para comparar personas.
const VACIAS = new Set(['de', 'la', 'el', 'los', 'las', 'un', 'una', 'unos', 'unas', 'y', 'o', 'que', 'en', 'con', 'por', 'para', 'me', 'mi', 'mis', 'le', 'lo', 'se', 'su', 'sus', 'es', 'son', 'al', 'del', 'a', 'mucho', 'mucha', 'muy', 'mas', 'más', 'gusta', 'gustan', 'quiero', 'quisiera', 'tambien', 'también', 'pero', 'si', 'no', 'soy', 'eres', 'esta', 'este', 'esto', 'cosas', 'cosa', 'algo', 'todo', 'toda']);

const sinTildes = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');

function tokenizar(texto) {
  return sinTildes(texto)
    .toLowerCase()
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .split(/\s+/)
    .filter(p => p.length >= 3 && !VACIAS.has(p));
}

/** Categorías del catálogo que aparecen en un texto. */
function categoriasDe(texto) {
  const t = sinTildes(texto).toLowerCase();
  const halladas = [];
  for (const [id, cat] of Object.entries(CATALOGO)) {
    if (cat.claves.some(k => t.includes(sinTildes(k)))) halladas.push(id);
  }
  return halladas;
}

/**
 * Convierte un texto en vector disperso {dimension: peso}.
 * Las categorías pesan el doble que las palabras sueltas porque generalizan:
 * "guitarra" y "piano" son distintos tokens pero la misma categoría música,
 * y queremos que dos personas así salgan parecidas.
 */
function vectorizar(texto, peso = 1) {
  const v = Object.create(null);
  if (!texto) return v;
  for (const cat of categoriasDe(texto)) v['cat:' + cat] = (v['cat:' + cat] || 0) + 2 * peso;
  for (const tok of tokenizar(texto)) v['tok:' + tok] = (v['tok:' + tok] || 0) + peso;
  return v;
}

function sumar(destino, origen, factor = 1) {
  for (const k in origen) destino[k] = (destino[k] || 0) + origen[k] * factor;
  return destino;
}

// --------------------------------------------------------------------------
// 2 y 3. PESAR Y NORMALIZAR
// --------------------------------------------------------------------------

// Cuánto vale cada fuente de información. El perfil es declarado y deliberado,
// así que manda; el chat es más ruidoso; lo que dice un tercero vale poco.
const PESOS = {
  deseo: 3.0,       // lo que pidió explícitamente
  gustos: 2.5,      // su campo "gustos"
  hobbies: 2.0,
  chat: 1.2,        // lo que le contó al duende
  juego: 1.0,       // lo que salió jugando
  tercero: 0.6,     // lo que otro dijo de él
  no_gusta: -2.0    // negativo: resta
};

function normalizar(v) {
  let suma = 0;
  for (const k in v) suma += v[k] * v[k];
  const norma = Math.sqrt(suma);
  if (!norma) return v;
  const out = Object.create(null);
  for (const k in v) out[k] = v[k] / norma;
  return out;
}

// --------------------------------------------------------------------------
// 4. SIMILITUD DEL COSENO
// --------------------------------------------------------------------------

/** Con los vectores ya normalizados, el coseno es el producto punto. */
function coseno(a, b) {
  // se recorre el más corto: el coste es O(min(|a|,|b|))
  const [corto, largo] = Object.keys(a).length <= Object.keys(b).length ? [a, b] : [b, a];
  let p = 0;
  for (const k in corto) if (k in largo) p += corto[k] * largo[k];
  return p;
}

// --------------------------------------------------------------------------
// Construcción de los perfiles a partir de la base de datos
// --------------------------------------------------------------------------

/**
 * Arma el vector de un usuario juntando todo lo que sabemos de él:
 * su perfil, sus deseos y cada señal que el duende fue aprendiendo.
 */
function vectorDeUsuario(u, senales) {
  const v = Object.create(null);
  sumar(v, vectorizar(u.gustos, PESOS.gustos));
  sumar(v, vectorizar(u.hobbies, PESOS.hobbies));
  sumar(v, vectorizar([u.deseo1, u.deseo2, u.deseo3].filter(Boolean).join(', '), PESOS.deseo));
  if (u.no_gustos) sumar(v, vectorizar(u.no_gustos, 1), PESOS.no_gusta);
  if (u.color_favorito) sumar(v, vectorizar(u.color_favorito, 0.5));

  for (const s of senales || []) {
    const base = s.tipo === 'no_gusta' ? PESOS.no_gusta
      : s.origen === 'tercero' ? PESOS.tercero
      : s.origen === 'juego' ? PESOS.juego
      : PESOS.chat;
    // el peso acumulado crece con la repetición, pero con logaritmo para que
    // repetir algo diez veces no valga diez veces más que decirlo una
    sumar(v, vectorizar(s.valor, base * (1 + Math.log(Math.max(1, s.peso)))));
  }
  return normalizar(v);
}

/** Carga a todos los participantes activos con su vector ya calculado. */
async function cargarPerfiles() {
  const usuarios = await all(
    "SELECT id, nombre, apodo, gustos, no_gustos, hobbies, color_favorito, deseo1, deseo2, deseo3 " +
    "FROM usuarios WHERE rol = 'participante' AND activo = 1"
  );
  const senales = await all('SELECT usuario_id, tipo, valor, peso, origen FROM senales');
  const porUsuario = new Map();
  for (const s of senales) {
    if (!porUsuario.has(s.usuario_id)) porUsuario.set(s.usuario_id, []);
    porUsuario.get(s.usuario_id).push(s);
  }
  return usuarios.map(u => ({
    id: u.id,
    nombre: u.nombre,
    apodo: u.apodo,
    datos: u,
    senales: porUsuario.get(u.id) || [],
    vector: vectorDeUsuario(u, porUsuario.get(u.id))
  }));
}

// --------------------------------------------------------------------------
// 5. k-NN
// --------------------------------------------------------------------------

/**
 * Los k participantes más parecidos a uno dado.
 * k por defecto = 3, un valor razonable para grupos de 8: suficiente para
 * promediar gustos sin diluirlos en todo el grupo.
 */
async function vecinos(usuarioId, k = 3, perfiles = null) {
  const todos = perfiles || await cargarPerfiles();
  const yo = todos.find(p => p.id === usuarioId);
  if (!yo) return [];
  return todos
    .filter(p => p.id !== usuarioId)
    .map(p => ({ ...p, similitud: coseno(yo.vector, p.vector) }))
    .sort((a, b) => b.similitud - a.similitud)
    .slice(0, k);
}

/** Qué tan parecidos son dos participantes, de 0 a 100. */
async function afinidad(aId, bId, perfiles = null) {
  const todos = perfiles || await cargarPerfiles();
  const a = todos.find(p => p.id === aId);
  const b = todos.find(p => p.id === bId);
  if (!a || !b) return 0;
  return Math.round(Math.max(0, coseno(a.vector, b.vector)) * 100);
}

/** Ranking de afinidad de uno con todo el grupo. */
async function ranking(usuarioId, perfiles = null) {
  const todos = perfiles || await cargarPerfiles();
  const yo = todos.find(p => p.id === usuarioId);
  if (!yo) return [];
  return todos
    .filter(p => p.id !== usuarioId)
    .map(p => ({ id: p.id, nombre: p.nombre, apodo: p.apodo, afinidad: Math.round(Math.max(0, coseno(yo.vector, p.vector)) * 100) }))
    .sort((a, b) => b.afinidad - a.afinidad);
}

// --------------------------------------------------------------------------
// 6. RECOMENDAR (filtrado colaborativo basado en usuario)
// --------------------------------------------------------------------------

/** Todas las ideas del catálogo, cada una con el vector de su categoría. */
function candidatas() {
  const out = [];
  for (const [id, cat] of Object.entries(CATALOGO)) {
    for (const idea of cat.ideas) out.push({ idea, categoria: id, nombreCat: cat.nombre, vector: normalizar(vectorizar(idea + ' ' + cat.claves.slice(0, 6).join(' '), 1)) });
  }
  return out;
}

const CANDIDATAS = candidatas();

/**
 * Recomienda regalos para `destinoId`.
 *
 *   score(idea) = 2·sim(destino, idea)                 ← lo que le pega a él
 *               + Σ_vecinos sim(destino,v)·sim(v,idea) ← lo que piden los que se le parecen
 *
 * El primer término evita el arranque en frío; el segundo es el aprendizaje
 * colaborativo propiamente dicho y va ganando peso conforme el grupo se llena.
 */
async function recomendar(destinoId, { k = 3, n = 4, excluir = [] } = {}) {
  const perfiles = await cargarPerfiles();
  const destino = perfiles.find(p => p.id === destinoId);
  if (!destino) return { ideas: COMODIN.slice(0, n).map(i => ({ idea: i, porque: 'idea comodín' })), vecinos: [] };

  const vs = await vecinos(destinoId, k, perfiles);
  const fuera = new Set(excluir.map(e => sinTildes(String(e)).toLowerCase()));

  const puntuadas = CANDIDATAS
    .filter(c => !fuera.has(sinTildes(c.idea).toLowerCase()))
    .map(c => {
      const directo = coseno(destino.vector, c.vector);
      let colaborativo = 0;
      let mejorVecino = null;
      for (const v of vs) {
        if (v.similitud <= 0) continue;
        const aporte = v.similitud * coseno(v.vector, c.vector);
        colaborativo += aporte;
        if (aporte > 0 && (!mejorVecino || aporte > mejorVecino.aporte)) mejorVecino = { nombre: v.apodo || v.nombre, aporte };
      }
      return { ...c, score: 2 * directo + colaborativo, directo, colaborativo, mejorVecino };
    })
    .filter(c => c.score > 0)
    .sort((a, b) => b.score - a.score);

  // No repetir categoría: cuatro ideas de "café" no sirven de nada.
  const elegidas = [];
  const usadas = new Set();
  for (const c of puntuadas) {
    if (usadas.has(c.categoria)) continue;
    usadas.add(c.categoria);
    elegidas.push({
      idea: c.idea,
      categoria: c.nombreCat,
      // la explicación es lo que hace que el usuario confíe en la sugerencia
      porque: c.directo >= c.colaborativo
        ? `encaja con lo que le gusta (${c.nombreCat.toLowerCase()})`
        : c.mejorVecino
          ? `a ${c.mejorVecino.nombre}, que tiene gustos parecidos, le va este estilo`
          : `por su perfil de ${c.nombreCat.toLowerCase()}`
    });
    if (elegidas.length >= n) break;
  }

  while (elegidas.length < n) {
    const c = COMODIN[elegidas.length % COMODIN.length];
    if (!elegidas.some(e => e.idea === c)) elegidas.push({ idea: c, porque: 'va bien con cualquiera' });
    else break;
  }

  return {
    ideas: elegidas,
    vecinos: vs.map(v => ({ nombre: v.apodo || v.nombre, similitud: Math.round(Math.max(0, v.similitud) * 100) }))
  };
}

// --------------------------------------------------------------------------
// APRENDIZAJE: guardar señales
// --------------------------------------------------------------------------

/**
 * Registra algo aprendido. Si ya existía la misma señal, sube su peso en vez
 * de duplicar la fila: así "repetir" equivale a "reforzar", que es justo lo
 * que queremos que signifique.
 */
async function aprender({ usuarioId, tipo = 'gusta', valor, origen = 'chat', autorId = null }) {
  const v = String(valor || '').trim().slice(0, 120);
  if (v.length < 2) return null;
  const ya = await get(
    'SELECT id, peso FROM senales WHERE usuario_id = ? AND tipo = ? AND lower(valor) = lower(?)',
    [usuarioId, tipo, v]
  );
  if (ya) {
    await run('UPDATE senales SET peso = peso + 1 WHERE id = ?', [ya.id]);
    return { id: ya.id, reforzada: true };
  }
  const r = await run(
    'INSERT INTO senales (usuario_id, tipo, valor, peso, origen, autor_id) VALUES (?, ?, ?, 1, ?, ?)',
    [usuarioId, tipo, v, origen, autorId]
  );
  return { id: r.lastInsertRowid, reforzada: false };
}

/** Todo lo aprendido sobre alguien, lo más reforzado primero. */
async function loAprendido(usuarioId, tipo = null) {
  const sql = tipo
    ? 'SELECT tipo, valor, peso, origen FROM senales WHERE usuario_id = ? AND tipo = ? ORDER BY peso DESC, id DESC'
    : 'SELECT tipo, valor, peso, origen FROM senales WHERE usuario_id = ? ORDER BY peso DESC, id DESC';
  return all(sql, tipo ? [usuarioId, tipo] : [usuarioId]);
}

/** Feedback 👍/👎 sobre una idea: aprendizaje en línea de toda la vida. */
async function calificarIdea(usuarioId, idea, meGusta) {
  return aprender({
    usuarioId,
    tipo: meGusta ? 'gusta' : 'no_gusta',
    valor: idea,
    origen: 'juego'
  });
}

/** Cuánto sabe el duende del grupo: sirve para contarlo y para el panel. */
async function estadisticas() {
  const perfiles = await cargarPerfiles();
  const s = await get('SELECT COUNT(*) AS n, COALESCE(SUM(peso),0) AS p FROM senales');
  const dims = new Set();
  perfiles.forEach(p => Object.keys(p.vector).forEach(k => dims.add(k)));
  return {
    participantes: perfiles.length,
    senales: s ? Number(s.n) : 0,
    refuerzos: s ? Number(s.p) : 0,
    dimensiones: dims.size,
    categorias: Object.keys(CATALOGO).length
  };
}

module.exports = {
  CATALOGO, COMODIN,
  tokenizar, categoriasDe, vectorizar, normalizar, coseno,
  cargarPerfiles, vectorDeUsuario,
  vecinos, afinidad, ranking, recomendar,
  aprender, loAprendido, calificarIdea, estadisticas
};
