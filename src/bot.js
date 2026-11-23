'use strict';

// ============================================================
//  DUENDE BOT - asistente de ideas de regalo (100% local, sin APIs)
//  Se "alimenta" de lo que responde cada usuario: todo lo que el
//  usuario dice que quiere se guarda en bot_memoria y luego su
//  amigo secreto lo puede consultar.
// ============================================================

const { all, get, run, getConfig } = require('./db');

const norm = (s) => (s || '')
  .toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/\s+/g, ' ')
  .trim();

// ---------- catálogo de ideas por intereses ----------
const CATALOGO = [
  { cat: 'Tecnología', claves: ['tecnolog', 'celular', 'computador', 'laptop', 'pc', 'gadget', 'audifono', 'auricular', 'bluetooth', 'usb', 'cargador', 'smart', 'reloj inteligente', 'smartwatch', 'tablet'],
    ideas: ['Audífonos bluetooth con estuche de carga', 'Power bank de 10 000 mAh', 'Aro de luz LED para videollamadas', 'Mouse inalámbrico silencioso', 'Soporte de celular para auto o escritorio', 'Smartwatch económico con medidor de pasos', 'Hub USB-C multipuerto', 'Parlante bluetooth resistente al agua'] },
  { cat: 'Gamer', claves: ['gamer', 'videojuego', 'juego', 'play', 'ps4', 'ps5', 'xbox', 'nintendo', 'steam', 'free fire', 'fortnite', 'valorant', 'lol', 'dota', 'teclado mecanico', 'mando'],
    ideas: ['Tarjeta de regalo de Steam / PlayStation Store', 'Mousepad XL gamer', 'Teclado mecánico compacto', 'Grip o cubre-análogos para mando', 'Luces LED RGB para el escritorio', 'Taza térmica con diseño gamer', 'Soporte para audífonos'] },
  { cat: 'Lectura', claves: ['leer', 'lectura', 'libro', 'novela', 'manga', 'comic', 'poesia', 'escrib'],
    ideas: ['Libro del autor favorito (firmado si se puede)', 'Lámpara de lectura con clip', 'Separadores de libros magnéticos', 'Cuaderno de tapa dura + lapicero bonito', 'Funda o atril para libros', 'Suscripción de 3 meses a audiolibros'] },
  { cat: 'Deporte', claves: ['deporte', 'gym', 'gimnasio', 'correr', 'running', 'futbol', 'basquet', 'volley', 'natacion', 'bici', 'ciclismo', 'pesas', 'crossfit', 'yoga', 'trotar'],
    ideas: ['Botella térmica deportiva', 'Banda elástica de resistencia + guía', 'Toalla de microfibra para gym', 'Mochila deportiva compacta', 'Medias o guantes técnicos', 'Tapete de yoga antideslizante', 'Camiseta del equipo favorito'] },
  { cat: 'Cocina', claves: ['cocin', 'comida', 'chef', 'reposter', 'postre', 'hornear', 'pasteler', 'parrilla', 'comer', 'gastronom'],
    ideas: ['Set de especias gourmet', 'Delantal bordado con su nombre', 'Tabla de picar de bambú', 'Molde de silicona para repostería', 'Termómetro digital de cocina', 'Libro de recetas peruanas', 'Set de utensilios de silicona'] },
  { cat: 'Café y té', claves: ['cafe', 'te ', 'cafeter', 'barista', 'infusion', 'mate', 'capuchino'],
    ideas: ['Prensa francesa pequeña', 'Taza térmica de acero', 'Set de café de origen peruano', 'Espumador de leche portátil', 'Tetera de vidrio con infusor', 'Caja de infusiones surtidas'] },
  { cat: 'Belleza y cuidado', claves: ['belleza', 'maquillaje', 'skincare', 'cuidado de la piel', 'perfume', 'crema', 'labial', 'unas', 'cabello', 'pelo', 'spa'],
    ideas: ['Set de skincare (limpiador + hidratante)', 'Perfume o body mist', 'Kit de brochas de maquillaje', 'Secadora o rizador compacto', 'Canasta spa: velas + sales + mascarillas', 'Organizador de cosméticos'] },
  { cat: 'Moda y accesorios', claves: ['ropa', 'moda', 'zapat', 'zapatilla', 'polo', 'casaca', 'chompa', 'gorra', 'cartera', 'billetera', 'lentes', 'joya', 'aretes', 'collar', 'pulsera', 'reloj'],
    ideas: ['Billetera o cartera de cuero', 'Chalina / gorro de invierno', 'Gorra bordada', 'Lentes de sol', 'Pulsera o collar con inicial', 'Medias divertidas (pack navideño)', 'Polo personalizado con una broma interna'] },
  { cat: 'Música', claves: ['music', 'cantar', 'guitarra', 'piano', 'cajon', 'ukelele', 'bateria', 'spotify', 'vinilo', 'concierto'],
    ideas: ['Suscripción de 3 meses a Spotify', 'Parlante bluetooth portátil', 'Afinador clip para guitarra', 'Cuadro de disco de vinilo decorativo', 'Audífonos con cancelación de ruido', 'Capo o set de cuerdas'] },
  { cat: 'Arte y manualidades', claves: ['arte', 'pintar', 'dibuj', 'manualidad', 'tejer', 'crochet', 'croche', 'bordar', 'foto', 'fotografia', 'disenar', 'diseno'],
    ideas: ['Set de lápices de colores profesionales', 'Cuaderno de bocetos A4', 'Kit de acuarelas + pinceles', 'Marco digital o álbum de fotos impreso', 'Set de hilos y agujas premium', 'Tableta de dibujo básica'] },
  { cat: 'Hogar y decoración', claves: ['hogar', 'casa', 'decor', 'vela', 'planta', 'jardin', 'cactus', 'suculenta', 'manta', 'cojin', 'almohada', 'dormir'],
    ideas: ['Manta polar suave', 'Difusor de aromas + esencias', 'Suculenta o cactus en maceta pintada', 'Cuadro o lámina enmarcada', 'Juego de velas aromáticas', 'Almohada cervical de viaje'] },
  { cat: 'Mascotas', claves: ['perro', 'gato', 'mascota', 'michi', 'firulais', 'cachorro', 'hamster'],
    ideas: ['Kit de juguetes para mascota', 'Collar personalizado con placa', 'Cama o manta para mascota', 'Snacks premium para perro/gato', 'Cepillo quita-pelos', 'Marco con la foto de su mascota'] },
  { cat: 'Viajes y aventura', claves: ['viaj', 'playa', 'camping', 'montana', 'mochiler', 'trekking', 'aventura', 'carro', 'auto', 'moto'],
    ideas: ['Organizadores de maleta (packing cubes)', 'Candado TSA + etiqueta de equipaje', 'Termo de viaje', 'Linterna o lámpara de camping', 'Almohada de cuello + antifaz', 'Riñonera o canguro práctico'] },
  { cat: 'Oficina y estudio', claves: ['oficina', 'estudi', 'universidad', 'trabajo', 'escritorio', 'agenda', 'organiz', 'contab', 'ingenier'],
    ideas: ['Agenda 2027 con planificador', 'Set de lapiceros de gel + resaltadores', 'Organizador de escritorio de madera', 'Soporte ergonómico para laptop', 'Taza con frase motivadora', 'Pizarra pequeña con imanes'] },
  { cat: 'Dulces y antojos', claves: ['dulce', 'chocolate', 'golosina', 'snack', 'torta', 'helado', 'paneton', 'vino', 'cerveza', 'pisco', 'trago'],
    ideas: ['Canasta navideña: panetón + chocolate + vino', 'Caja de bombones artesanales', 'Set de cerveza artesanal peruana', 'Chocolates importados surtidos', 'Kit para preparar cócteles', 'Tabla de quesos y piqueos'] }
];

const COMODIN = [
  'Una canasta navideña armada por ti (panetón, chocolate, algo personal)',
  'Un álbum o marco con fotos del grupo',
  'Taza personalizada con una foto o broma interna',
  'Manta polar + chocolate caliente: nunca falla',
  'Tarjeta de regalo de una tienda que sí usa',
  'Set de velas aromáticas y difusor',
  'Audífonos bluetooth: útiles para cualquiera',
  'Planta pequeña en maceta pintada a mano'
];

const SALUDOS = [
  'Hola! Soy el Duende Ayudante 🧝 ¿Te ayudo a encontrar el mejor regalo para tu amigo secreto?',
  'Ho ho ho! 🎅 Dime los gustos de tu amigo y te doy ideas al instante.',
  'Llegué del Polo Norte con la lista de ideas ❄️ ¿Qué te cuento?'
];

function pick(arr, n = 1) {
  const a = arr.slice();
  const out = [];
  while (out.length < n && a.length) out.push(a.splice(Math.floor(Math.random() * a.length), 1)[0]);
  return out;
}

// ---------- memoria (wishlist que alimenta el usuario) ----------
async function guardarDeseo(userId, texto, tipo = 'deseo') {
  const t = (texto || '').trim();
  if (t.length < 2) return false;
  const yaEsta = await get('SELECT 1 AS x FROM bot_memoria WHERE user_id = ? AND lower(texto) = lower(?)', [userId, t]);
  if (yaEsta) return false;
  await run('INSERT INTO bot_memoria (user_id, tipo, texto) VALUES (?, ?, ?)', [userId, tipo, t]);
  return true;
}

function deseosDe(userId) {
  return all('SELECT texto, tipo, creado FROM bot_memoria WHERE user_id = ? ORDER BY id DESC', [userId]);
}

function guardarChat(userId, rol, mensaje) {
  return run('INSERT INTO bot_chat (user_id, rol, mensaje) VALUES (?, ?, ?)', [userId, rol, mensaje]);
}

async function historial(userId, limite = 60) {
  const filas = await all('SELECT rol, mensaje, creado FROM bot_chat WHERE user_id = ? ORDER BY id DESC LIMIT ?',
    [userId, limite]);
  return filas.reverse();
}

// ---------- motor de ideas ----------
function perfilTexto(u) {
  if (!u) return '';
  return norm([u.gustos, u.hobbies, u.deseo1, u.deseo2, u.deseo3, u.color_favorito].join(' '));
}

function categoriasDe(texto) {
  const t = norm(texto);
  const encontradas = [];
  for (const c of CATALOGO) {
    if (c.claves.some(k => t.includes(k))) encontradas.push(c);
  }
  return encontradas;
}

function ideasParaTexto(texto, cantidad = 4) {
  const cats = categoriasDe(texto);
  if (!cats.length) return { cats: [], ideas: pick(COMODIN, cantidad) };
  let ideas = [];
  for (const c of cats) ideas = ideas.concat(pick(c.ideas, 3).map(i => `${i} (${c.cat})`));
  return { cats, ideas: pick(ideas, Math.min(cantidad, ideas.length)) };
}

async function fichaAmigo(amigo) {
  const deseos = (await deseosDe(amigo.id)).filter(d => d.tipo === 'deseo').map(d => d.texto);
  const lineas = [
    `${amigo.nombre}${amigo.apodo ? ` (alias "${amigo.apodo}")` : ''}`,
    `• Le gusta: ${amigo.gustos}`,
    `• Hobbies: ${amigo.hobbies}`,
    `• Color favorito: ${amigo.color_favorito}`,
    `• Talla de ropa: ${amigo.talla_ropa} · Zapato: ${amigo.talla_zapato}`,
    `• Su lista de deseos: ${[amigo.deseo1, amigo.deseo2, amigo.deseo3].filter(Boolean).join(' / ')}`
  ];
  if (amigo.no_gustos) lineas.push(`• ⚠️ NO le gusta: ${amigo.no_gustos}`);
  if (deseos.length) lineas.push(`• Lo que le contó al duende: ${deseos.slice(0, 6).join(' / ')}`);
  return lineas.join('\n');
}

// ---------- intenciones ----------
const RX = {
  saludo: /^(hola|holi|buenas|hey|ola|que tal|buenos dias|buenas tardes|buenas noches|hi)\b/,
  gracias: /(gracias|thank|genial|excelente|perfecto|buenisimo)/,
  amigo: /(mi amigo|amigo secreto|le gusta|a el|a ella|para quien|a quien me toco|que le regalo|que le compro|regalarle|mi pareja de intercambio)/,
  quiero: /(quiero|me gustaria|me encantaria|deseo|pedir|pido|anota|apunta|agrega|sueno con|quisiera|me hace falta|necesito)/,
  presupuesto: /(presupuesto|monto|cuanto|precio|barato|economico|plata|soles|costo)/,
  fecha: /(cuando|fecha|dia del|evento|navidad|reunion|hora)/,
  reglas: /(regla|como funciona|como se juega|instruccion|ayuda|que puedes hacer|que haces)/,
  ideas: /(idea|sugerencia|sugiere|recomienda|recomendacion|opcion|dame|propon|no se que)/,
  ver: /(mi lista|que anote|que guarde|mis deseos|mi wishlist)/
};

async function responder({ user, amigo, texto }) {
  const t = norm(texto);
  const monto = getConfig('monto');
  const aprendido = [];
  let reply;

  // --- el usuario cuenta lo que quiere -> el bot aprende ---
  if (RX.quiero.test(t) && !RX.amigo.test(t)) {
    const limpio = texto
      .replace(/^(.*?)(quiero|me gustaría|me gustaria|me encantaría|me encantaria|deseo|quisiera|pedir|pido|anota|apunta|agrega|necesito|me hace falta)\s*/i, '')
      .replace(/^(que|de|un|una|unos|unas|el|la|los|las)\s+/i, '')
      .trim();
    const partes = limpio.split(/\s*(?:,|;|\by\b|\bo\b|\/)\s*/).map(s => s.trim()).filter(s => s.length > 2);
    for (const p of (partes.length ? partes : [limpio])) {
      if (await guardarDeseo(user.id, p)) aprendido.push(p);
    }
    const { ideas } = ideasParaTexto(limpio, 3);
    reply = aprendido.length
      ? `¡Anotado en tu lista! ✍️🎁\n\n${aprendido.map(a => `✅ ${a}`).join('\n')}\n\nCuando tu amigo secreto me pregunte por ti, le voy a soplar esto 😉\n\nTambién le sugeriría:\n${ideas.map(i => `• ${i}`).join('\n')}\n\n¿Quieres agregar algo más? Escribe "quiero ..." otra vez.`
      : `Eso ya estaba en tu lista 😄 Escribe "mi lista" para verla completa, o cuéntame otra cosa que te gustaría.`;
  }

  // --- el usuario pregunta por su amigo secreto ---
  else if (RX.amigo.test(t)) {
    if (!amigo) {
      reply = `Todavía no puedo decirte nada de tu amigo secreto 🤫\nEl sorteo se realiza automáticamente cuando los ${getConfig('max_participantes')} participantes estén registrados. Mientras tanto, cuéntame qué te gustaría recibir a ti y lo guardo en tu lista.`;
    } else {
      const { ideas, cats } = ideasParaTexto(perfilTexto(amigo), 5);
      reply = `Tu amigo secreto es ${amigo.nombre} 🤐 Esto es lo que sé de ${amigo.nombre.split(' ')[0]}:\n\n${await fichaAmigo(amigo)}\n\n🎁 Ideas que le encantarían${cats.length ? ` (perfil: ${cats.map(c => c.cat).join(', ')})` : ''}:\n${ideas.map(i => `• ${i}`).join('\n')}\n\n💰 Recuerda el monto acordado: ${monto}.\n¿Quieres más ideas de alguna categoría en particular?`;
    }
  }

  // --- ver su propia lista ---
  else if (RX.ver.test(t)) {
    const mios = await deseosDe(user.id);
    reply = mios.length
      ? `Esta es tu lista de deseos 📜 (solo la ve quien te sacó en el sorteo):\n${mios.map(d => `• ${d.texto}`).join('\n')}`
      : `Tu lista está vacía 🫙 Cuéntame: "quiero unos audífonos bluetooth" y la empiezo a llenar.`;
  }

  else if (RX.presupuesto.test(t)) {
    reply = `El monto acordado para este intercambio es ${monto} 💰\nCon ese presupuesto funcionan muy bien:\n${pick(COMODIN, 4).map(i => `• ${i}`).join('\n')}\n\nSi me dices los gustos de tu amigo, afino las ideas al toque.`;
  }

  else if (RX.fecha.test(t)) {
    reply = `🗓️ El intercambio es el ${getConfig('fecha_evento')} en ${getConfig('lugar')}.\n¡No llegues con las manos vacías! 😅 ¿Te doy ideas de regalo?`;
  }

  else if (RX.reglas.test(t)) {
    reply = `Así funciona 🎄\n1. Cada quien crea su usuario con sus datos completos (gustos, tallas, deseos).\n2. Cuando se completan los ${getConfig('max_participantes')} participantes, el sorteo se hace solo y al azar.\n3. Al entrar, abres tu regalo sorpresa y descubres a tu amigo secreto.\n4. Puedes ver el perfil de todos, pero nadie sabe a quién le tocó a los demás.\n5. Yo te ayudo con ideas y guardo lo que tú quieres recibir.\n\nPruébame con: "ideas para mi amigo", "quiero un libro", "mi lista", "cuánto es el monto".`;
  }

  else if (RX.saludo.test(t)) {
    reply = `${pick(SALUDOS)[0]}\n\nPuedes pedirme:\n• "ideas para mi amigo secreto"\n• "quiero unos audífonos" (lo anoto en tu lista)\n• "mi lista"\n• "cuánto es el monto"`;
  }

  else if (RX.gracias.test(t) && t.length < 40) {
    reply = `Un gusto ayudarte 🧝 ✨ Que tu regalo sea el más comentado de la noche.`;
  }

  // --- búsqueda libre por intereses ---
  else {
    const { ideas, cats } = ideasParaTexto(t, 5);
    if (cats.length) {
      reply = `Para alguien que le va a ${cats.map(c => c.cat).join(' / ')} te sugiero 🎁:\n${ideas.map(i => `• ${i}`).join('\n')}\n\n💰 Monto acordado: ${monto}. ¿Te muestro el perfil de tu amigo secreto para afinar?`;
    } else if (RX.ideas.test(t)) {
      reply = `Van ideas que caen bien a cualquiera 🎄:\n${pick(COMODIN, 5).map(i => `• ${i}`).join('\n')}\n\nDime un interés concreto (gamer, cocina, deporte, lectura, skincare, café...) y te doy ideas más puntuales.`;
    } else {
      reply = `No estoy seguro de haber entendido 🤔 pero igual te ayudo:\n${pick(COMODIN, 3).map(i => `• ${i}`).join('\n')}\n\nPrueba con:\n• "ideas para mi amigo secreto"\n• "le gusta el fútbol y la cocina"\n• "quiero una manta polar"`;
    }
  }

  await guardarChat(user.id, 'user', texto);
  await guardarChat(user.id, 'bot', reply);
  return { reply, aprendido };
}

module.exports = { responder, deseosDe, guardarDeseo, historial, guardarChat, CATALOGO, fichaAmigo };
