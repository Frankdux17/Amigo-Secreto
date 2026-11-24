'use strict';

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');

const dbm = require('./src/db');
const { all, get, run, init, DB_FILE, USA_TURSO, getConfig, setConfig, allConfig } = dbm;
const SqliteStore = require('./src/session-store');
const sorteo = require('./src/sorteo');
const bot = require('./src/bot');
const knn = require('./src/knn');
const animo = require('./src/animo');
const memoriaDuende = require('./src/memoria');

const app = express();
const PORT = process.env.PORT || 3600;
const EN_PRODUCCION = process.env.NODE_ENV === 'production';

// Identificador de version: cambia en cada despliegue y reinicio, de modo que
// el navegador descarga los CSS/JS nuevos en vez de servir los cacheados.
const BUILD = require('./package.json').version + '-' + Date.now().toString(36);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);

app.use(express.urlencoded({ extended: true, limit: '8mb' }));
app.use(express.json({ limit: '8mb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: EN_PRODUCCION ? '7d' : 0 }));

app.use(session({
  name: 'amigo_secreto_sid',
  store: new SqliteStore(),
  secret: process.env.SESSION_SECRET || 'navidad-2026-amigo-secreto-cambia-esto',
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: EN_PRODUCCION,
    maxAge: 1000 * 60 * 60 * 24 * 30
  }
}));

// ------------------------------------------------------------
//  Helpers
// ------------------------------------------------------------

// envoltorio para que un error dentro de un handler async llegue a Express
const A = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const Q = {
  porUsuario: (u) => get('SELECT * FROM usuarios WHERE lower(usuario) = lower(?)', [u]),
  porId: (id) => get('SELECT * FROM usuarios WHERE id = ?', [id]),
  listaParticipantes: () => all("SELECT * FROM usuarios WHERE rol = 'participante' ORDER BY nombre COLLATE NOCASE"),
  todos: () => all('SELECT * FROM usuarios ORDER BY rol DESC, nombre COLLATE NOCASE')
};

async function cupo() {
  const max = parseInt(getConfig('max_participantes') || '8', 10);
  const total = await sorteo.totalParticipantes();
  return { max, total, faltan: Math.max(0, max - total), completo: total >= max };
}

async function usuarioActual(req) {
  if (!req.session.userId) return null;
  const u = await Q.porId(req.session.userId);
  if (!u || !u.activo) return null;
  return u;
}

// token anti-CSRF por sesión
function csrf(req) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
  return req.session.csrf;
}

app.use(A(async (req, res, next) => {
  const u = await usuarioActual(req);
  req.yo = u;
  res.locals.yo = u;
  res.locals.esAdmin = !!u && u.rol === 'admin';
  res.locals.cfg = allConfig();
  res.locals.cupo = await cupo();
  res.locals.sorteoHecho = sorteo.sorteoHecho();
  res.locals.csrfToken = csrf(req);
  res.locals.flash = req.session.flash || null;
  res.locals.ruta = req.path;
  res.locals.build = BUILD;
  // fotos que el Papá Noel va paseando por la página
  const gente = await all("SELECT nombre, apodo, foto FROM usuarios WHERE rol = 'participante' AND activo = 1 ORDER BY id");
  res.locals.caminata = gente.map(g => ({ n: g.apodo || String(g.nombre).split(' ')[0], f: g.foto || null }));
  delete req.session.flash;
  next();
}));

// valida CSRF en todos los POST
app.use((req, res, next) => {
  if (req.method !== 'POST') return next();
  const enviado = (req.body && req.body._csrf) || req.get('x-csrf-token');
  if (!enviado || enviado !== req.session.csrf) {
    const quiereJson = req.xhr || (req.get('accept') || '').includes('json');
    if (quiereJson) return res.status(403).json({ error: 'Token de seguridad inválido. Recarga la página.' });
    req.session.flash = { tipo: 'error', texto: 'Token de seguridad inválido. Vuelve a intentarlo.' };
    return res.redirect(req.get('referer') || '/');
  }
  next();
});

function pedirLogin(req, res, next) {
  if (!req.yo) {
    req.session.flash = { tipo: 'error', texto: 'Inicia sesión para continuar.' };
    return res.redirect('/login');
  }
  next();
}

function pedirAdmin(req, res, next) {
  if (!req.yo || req.yo.rol !== 'admin') {
    req.session.flash = { tipo: 'error', texto: 'Zona exclusiva del administrador.' };
    return res.redirect('/inicio');
  }
  next();
}

function flash(req, tipo, texto) { req.session.flash = { tipo, texto }; }

const limpiar = (v) => (typeof v === 'string' ? v.trim() : '');

function validarFoto(dataUrl) {
  if (!dataUrl) return null;
  if (!/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(dataUrl)) return null;
  // ~1.4 MB de base64 como techo (la foto se comprime en el navegador)
  if (dataUrl.length > 1900000) return null;
  return dataUrl;
}

// ------------------------------------------------------------
//  Público
// ------------------------------------------------------------
app.get('/', A(async (req, res) => {
  if (req.yo) return res.redirect('/inicio');
  res.render('landing', { titulo: 'Amigo Secreto', participantes: await Q.listaParticipantes() });
}));

app.get('/login', (req, res) => {
  if (req.yo) return res.redirect('/inicio');
  res.render('login', { titulo: 'Ingresar' });
});

const intentos = new Map(); // control básico de fuerza bruta

app.post('/login', A(async (req, res) => {
  const usuario = limpiar(req.body.usuario);
  const password = req.body.password || '';
  const llave = (req.ip || 'x') + '|' + usuario.toLowerCase();
  const reg = intentos.get(llave) || { n: 0, hasta: 0 };

  if (reg.hasta > Date.now()) {
    flash(req, 'error', 'Demasiados intentos. Espera un minuto e inténtalo de nuevo.');
    return res.redirect('/login');
  }

  const u = await Q.porUsuario(usuario);
  if (!u || !u.activo || !bcrypt.compareSync(password, u.password_hash)) {
    reg.n += 1;
    if (reg.n >= 6) { reg.hasta = Date.now() + 60000; reg.n = 0; }
    intentos.set(llave, reg);
    flash(req, 'error', 'Usuario o contraseña incorrectos.');
    return res.redirect('/login');
  }

  intentos.delete(llave);
  req.session.userId = Number(u.id);
  req.session.csrf = crypto.randomBytes(24).toString('hex');
  res.redirect('/inicio');
}));

app.get('/registro', A(async (req, res) => {
  if (req.yo) return res.redirect('/inicio');
  const c = await cupo();
  res.render('registro', { titulo: 'Crear mi usuario', datos: {}, errores: [], lleno: c.completo });
}));

const CAMPOS_OBLIGATORIOS = [
  ['usuario', 'Usuario'],
  ['password', 'Contraseña'],
  ['password2', 'Repetir contraseña'],
  ['nombre', 'Nombre y apellido'],
  ['email', 'Correo electrónico'],
  ['telefono', 'Teléfono / WhatsApp'],
  ['gustos', 'Qué te gusta'],
  ['talla_ropa', 'Talla de ropa'],
  ['talla_zapato', 'Talla de zapato'],
  ['color_favorito', 'Color favorito'],
  ['hobbies', 'Hobbies'],
  ['deseo1', 'Deseo principal']
];

app.post('/registro', A(async (req, res) => {
  const d = {};
  for (const k of ['usuario', 'password', 'password2', 'nombre', 'apodo', 'email', 'telefono', 'cumple',
    'gustos', 'no_gustos', 'talla_ropa', 'talla_zapato', 'color_favorito', 'hobbies',
    'deseo1', 'deseo2', 'deseo3', 'direccion', 'foto']) {
    d[k] = limpiar(req.body[k]);
  }

  const errores = [];
  const c = await cupo();
  if (c.completo) errores.push(`Ya se completaron los ${c.max} participantes. Habla con el administrador.`);

  for (const [campo, etiqueta] of CAMPOS_OBLIGATORIOS) {
    if (!d[campo]) errores.push(`El campo "${etiqueta}" es obligatorio.`);
  }
  if (d.usuario && !/^[a-zA-Z0-9._-]{3,20}$/.test(d.usuario)) {
    errores.push('El usuario debe tener de 3 a 20 caracteres (letras, números, punto, guion).');
  }
  if (d.usuario && await Q.porUsuario(d.usuario)) errores.push('Ese usuario ya está tomado, elige otro.');
  if (d.email && !/^[^@\s]+@[^@\s]+\.[a-zA-Z]{2,}$/.test(d.email)) errores.push('El correo no tiene un formato válido.');
  if (d.password && d.password.length < 6) errores.push('La contraseña debe tener al menos 6 caracteres.');
  if (d.password !== d.password2) errores.push('Las contraseñas no coinciden.');
  if (d.telefono && !/^[0-9+()\s-]{6,20}$/.test(d.telefono)) errores.push('El teléfono solo admite números y los signos + ( ) -');

  const foto = validarFoto(d.foto);
  if (d.foto && !foto) errores.push('La foto no es válida o pesa demasiado (máx. ~1.5 MB).');

  if (errores.length) {
    d.password = ''; d.password2 = '';
    return res.status(400).render('registro', { titulo: 'Crear mi usuario', datos: d, errores, lleno: c.completo });
  }

  const info = await run(
    `INSERT INTO usuarios
      (usuario, password_hash, nombre, apodo, email, telefono, cumple, gustos, no_gustos,
       talla_ropa, talla_zapato, color_favorito, hobbies, deseo1, deseo2, deseo3, direccion, foto, rol)
     VALUES (@usuario, @password_hash, @nombre, @apodo, @email, @telefono, @cumple, @gustos, @no_gustos,
       @talla_ropa, @talla_zapato, @color_favorito, @hobbies, @deseo1, @deseo2, @deseo3, @direccion, @foto, 'participante')`,
    {
      usuario: d.usuario,
      password_hash: bcrypt.hashSync(d.password, 10),
      nombre: d.nombre, apodo: d.apodo || null, email: d.email, telefono: d.telefono,
      cumple: d.cumple || null, gustos: d.gustos, no_gustos: d.no_gustos || null,
      talla_ropa: d.talla_ropa, talla_zapato: d.talla_zapato, color_favorito: d.color_favorito,
      hobbies: d.hobbies, deseo1: d.deseo1, deseo2: d.deseo2 || null, deseo3: d.deseo3 || null,
      direccion: d.direccion || null, foto: foto
    }
  );

  // los deseos iniciales alimentan al bot
  for (const t of [d.deseo1, d.deseo2, d.deseo3].filter(Boolean)) await bot.guardarDeseo(info.lastInsertRowid, t);

  const r = await sorteo.sortearSiEstaCompleto();
  req.session.userId = info.lastInsertRowid;
  req.session.csrf = crypto.randomBytes(24).toString('hex');
  flash(req, 'ok', r.ok
    ? '¡Bienvenido! Se completaron los participantes y el sorteo ya se realizó. Abre tu regalo 🎁'
    : '¡Tu usuario fue creado! 🎄');
  res.redirect('/inicio');
}));

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// ------------------------------------------------------------
//  Zona privada
// ------------------------------------------------------------
app.get('/inicio', pedirLogin, A(async (req, res) => {
  const yo = req.yo;
  const asignado = yo.rol === 'participante' ? await sorteo.asignacionDe(yo.id) : null;
  res.render('dashboard', {
    titulo: 'Mi Navidad',
    asignado,
    misDeseos: await bot.deseosDe(yo.id),
    participantes: await Q.listaParticipantes(),
    parejas: yo.rol === 'admin' ? await sorteo.todasLasAsignaciones() : []
  });
}));

app.post('/revelar', pedirLogin, A(async (req, res) => {
  const a = await sorteo.asignacionDe(req.yo.id);
  if (!a) return res.status(404).json({ error: 'Aún no hay sorteo.' });
  await sorteo.marcarVisto(req.yo.id);
  res.json({
    ok: true,
    amigo: {
      id: a.id, nombre: a.nombre, apodo: a.apodo, usuario: a.usuario, foto: a.foto,
      gustos: a.gustos, hobbies: a.hobbies, color_favorito: a.color_favorito,
      talla_ropa: a.talla_ropa, talla_zapato: a.talla_zapato,
      deseos: [a.deseo1, a.deseo2, a.deseo3].filter(Boolean),
      no_gustos: a.no_gustos
    }
  });
}));

app.get('/participantes', pedirLogin, A(async (req, res) => {
  res.render('participantes', { titulo: 'Los amigos', participantes: await Q.listaParticipantes() });
}));

app.get('/participante/:id', pedirLogin, A(async (req, res) => {
  const yo = req.yo;
  const u = await Q.porId(req.params.id);
  if (!u || u.rol !== 'participante') {
    flash(req, 'error', 'Ese participante no existe.');
    return res.redirect('/participantes');
  }
  const mio = await sorteo.asignacionDe(yo.id);
  const esMiAmigo = !!mio && Number(mio.id) === Number(u.id);
  // La lista privada del bot solo se muestra si es MI amigo secreto (o soy admin)
  const deseosBot = (esMiAmigo || yo.rol === 'admin') ? await bot.deseosDe(u.id) : [];
  res.render('participante', {
    titulo: u.nombre, u, esMiAmigo, deseosBot,
    soyYo: Number(yo.id) === Number(u.id)
  });
}));

app.get('/perfil', pedirLogin, A(async (req, res) => {
  res.render('perfil', { titulo: 'Mi perfil', datos: req.yo, errores: [], misDeseos: await bot.deseosDe(req.yo.id) });
}));

app.post('/perfil', pedirLogin, A(async (req, res) => {
  const yo = req.yo;
  const d = {};
  for (const k of ['nombre', 'apodo', 'email', 'telefono', 'cumple', 'gustos', 'no_gustos',
    'talla_ropa', 'talla_zapato', 'color_favorito', 'hobbies', 'deseo1', 'deseo2', 'deseo3',
    'direccion', 'foto', 'password', 'password2']) {
    d[k] = limpiar(req.body[k]);
  }

  const errores = [];
  for (const [campo, etiqueta] of CAMPOS_OBLIGATORIOS) {
    if (['usuario', 'password', 'password2'].includes(campo)) continue;
    if (!d[campo]) errores.push(`El campo "${etiqueta}" es obligatorio.`);
  }
  if (d.email && !/^[^@\s]+@[^@\s]+\.[a-zA-Z]{2,}$/.test(d.email)) errores.push('El correo no tiene un formato válido.');
  if (d.password || d.password2) {
    if (d.password.length < 6) errores.push('La nueva contraseña debe tener al menos 6 caracteres.');
    if (d.password !== d.password2) errores.push('Las contraseñas nuevas no coinciden.');
  }
  const fotoNueva = d.foto ? validarFoto(d.foto) : undefined;
  if (d.foto && !fotoNueva) errores.push('La foto no es válida o pesa demasiado.');

  if (errores.length) {
    return res.status(400).render('perfil', {
      titulo: 'Mi perfil',
      datos: Object.assign({}, yo, d),
      errores,
      misDeseos: await bot.deseosDe(yo.id)
    });
  }

  await run(
    `UPDATE usuarios SET nombre=@nombre, apodo=@apodo, email=@email, telefono=@telefono,
        cumple=@cumple, gustos=@gustos, no_gustos=@no_gustos, talla_ropa=@talla_ropa,
        talla_zapato=@talla_zapato, color_favorito=@color_favorito, hobbies=@hobbies,
        deseo1=@deseo1, deseo2=@deseo2, deseo3=@deseo3, direccion=@direccion,
        foto = COALESCE(@foto, foto)
      WHERE id=@id`,
    {
      id: Number(yo.id),
      nombre: d.nombre, apodo: d.apodo || null, email: d.email, telefono: d.telefono,
      cumple: d.cumple || null, gustos: d.gustos, no_gustos: d.no_gustos || null,
      talla_ropa: d.talla_ropa, talla_zapato: d.talla_zapato, color_favorito: d.color_favorito,
      hobbies: d.hobbies, deseo1: d.deseo1, deseo2: d.deseo2 || null, deseo3: d.deseo3 || null,
      direccion: d.direccion || null, foto: fotoNueva === undefined ? null : fotoNueva
    }
  );

  if (d.password) {
    await run('UPDATE usuarios SET password_hash = ? WHERE id = ?', [bcrypt.hashSync(d.password, 10), Number(yo.id)]);
  }
  for (const t of [d.deseo1, d.deseo2, d.deseo3].filter(Boolean)) await bot.guardarDeseo(yo.id, t);

  flash(req, 'ok', 'Perfil actualizado ✅');
  res.redirect('/perfil');
}));

app.post('/perfil/deseo', pedirLogin, A(async (req, res) => {
  const texto = limpiar(req.body.texto);
  const ok = await bot.guardarDeseo(req.yo.id, texto);
  if ((req.get('accept') || '').includes('json')) return res.json({ ok });
  flash(req, ok ? 'ok' : 'error', ok ? 'Agregado a tu lista de deseos 🎁' : 'No se pudo agregar (vacío o repetido).');
  res.redirect('/perfil');
}));

// ------------------------------------------------------------
//  Bot
// ------------------------------------------------------------
app.get('/bot', pedirLogin, A(async (req, res) => {
  const a = await sorteo.asignacionDe(req.yo.id);
  res.render('bot', {
    titulo: 'Duende Ayudante',
    historial: await bot.historial(req.yo.id),
    tieneAmigo: !!a,
    misDeseos: await bot.deseosDe(req.yo.id)
  });
}));

// Estado que alimenta al duende flotante y al aviso automático del sorteo.
// Solo devuelve datos del usuario en sesión: nunca la asignación de otro.
app.get('/api/estado', pedirLogin, A(async (req, res) => {
  const yo = req.yo;
  const c = await cupo();
  const a = yo.rol === 'participante' ? await sorteo.asignacionDe(yo.id) : null;
  let amigo = null;
  if (a) {
    // deseosDe() ya devuelve los textos. Pedirles .texto otra vez daba
    // undefined, y un undefined dentro de un array sale como null al
    // serializar a JSON: de ahi el «• null» que aparecia en la lista.
    const extra = await bot.deseosDe(a.id);
    amigo = {
      id: Number(a.id), nombre: a.nombre, apodo: a.apodo, foto: a.foto,
      gustos: a.gustos, hobbies: a.hobbies, color_favorito: a.color_favorito,
      talla_ropa: a.talla_ropa, talla_zapato: a.talla_zapato, no_gustos: a.no_gustos,
      deseos: [a.deseo1, a.deseo2, a.deseo3].concat(extra)
        .map(v => String(v == null ? '' : v).trim())
        .filter(v => v.length > 0 && v.toLowerCase() !== 'null')
        .filter((v, i, arr) => arr.indexOf(v) === i)
    };
  }
  // Recados que otros amigos le dejaron (el duende los entrega al entrar)
  const recados = (await bot.recadosDe(yo.id)).map(x => ({
    id: Number(x.id),
    texto: x.texto,
    de: x.anonimo ? 'Alguien del grupo' : (x.de_apodo || String(x.de_nombre).split(' ')[0])
  }));

  res.json({
    yo: { id: Number(yo.id), nombre: yo.nombre, apodo: yo.apodo, rol: yo.rol },
    cupo: c,
    sorteoHecho: sorteo.sorteoHecho(),
    visto: a ? !!a.visto : false,
    evento: { monto: getConfig('monto'), fecha: getConfig('fecha_evento'), lugar: getConfig('lugar') },
    amigo,
    recados,
    // estado emocional del duende con esta persona: la cara que pone al entrar
    animo: await animo.estado(yo.id),
    // y lo que se le ocurre decirte sin que le preguntes
    nota: yo.rol === 'participante'
      ? await bot.mensajeEspontaneo(yo, {
          total: c.total, max: c.max, sorteoHecho: sorteo.sorteoHecho()
        })
      : null
  });
}));

app.post('/api/bot', pedirLogin, A(async (req, res) => {
  const yo = req.yo;
  const texto = limpiar(req.body.texto);
  if (!texto) return res.status(400).json({ error: 'Escribe algo 🙂' });
  if (texto.length > 500) return res.status(400).json({ error: 'Mensaje demasiado largo.' });
  const asignado = await sorteo.asignacionDe(yo.id);
  const amigo = asignado ? await Q.porId(asignado.id) : null;
  const c = await cupo();
  const r = await bot.responder({
    user: yo,
    amigo,
    texto,
    ctx: {
      sorteoHecho: sorteo.sorteoHecho(),
      total: c.total, max: c.max,
      monto: getConfig('monto'), fecha: getConfig('fecha_evento'), lugar: getConfig('lugar')
    },
    // el duende puede dejar algo "a medias" (un recado, un juego): el cliente
    // nos lo devuelve en el siguiente turno para retomar la conversación
    espera: req.body.espera && typeof req.body.espera === 'object' ? req.body.espera : null
  });
  res.json({
    ok: true,
    reply: r.texto,
    sugerencias: r.sugerencias || null,
    espera: r.espera || null,
    animacion: r.animacion || null,
    ideas: r.ideas || null,
    // el animo decide la cara y el tono de voz del duende
    animo: r.animo || null,
    callar: !!r.callar,
    hablar: !!r.hablar,
    deseos: await bot.deseosDe(yo.id)
  });
}));


// ------------------------------------------------------------
//  Cognicion visual: lo que el duende "ve" en la pagina
//
//  El navegador le avisa cuando el mouse se queda encima de el, cuando lo
//  acarician, lo sacuden o cuando llevas rato sin moverte. Eso se traduce en
//  emocion y en una frase. No hay camara: "ver" es percibir la pagina.
// ------------------------------------------------------------
const GESTOS_VALIDOS = new Set([
  'hover', 'caricia', 'cosquillas', 'sacudida', 'vuelta', 'ausencia', 'regreso',
  // el juego de pillarlo y lo que ve de su propia pagina
  'esquive', 'pillado', 'zona'
]);

app.post('/api/gesto', pedirLogin, A(async (req, res) => {
  const gesto = String(req.body.gesto || '').trim();
  if (!GESTOS_VALIDOS.has(gesto)) return res.status(400).json({ error: 'Gesto no reconocido.' });
  const r = await bot.reaccionarGesto(req.yo.id, gesto, limpiar(req.body.dato || ''));
  if (!r) return res.status(400).json({ error: 'Gesto no reconocido.' });
  res.json({ ok: true, ...r });
}));


// ------------------------------------------------------------
//  Memoria del duende (solo la propia: nadie ve la de otro)
// ------------------------------------------------------------

// Lo que el duende recuerda de mi, con su estado de animo y su modelo.
app.get('/api/memoria', pedirLogin, A(async (req, res) => {
  res.json({ ok: true, ...(await bot.loQueSeDeTi(req.yo.id)) });
}));

// Guardar algo a mano, sin pasar por el chat.
app.post('/api/memoria', pedirLogin, A(async (req, res) => {
  const texto = limpiar(req.body.texto);
  if (!texto || texto.length < 3) return res.status(400).json({ error: 'Escribe lo que quieres que recuerde.' });
  if (bot.revelaSorteo(texto)) {
    return res.status(400).json({ error: 'Eso revelaria el sorteo 🤐 El duende no lo guarda.' });
  }
  // 'grupo' = el duende lo puede repetir si alguien pregunta por mi
  const publico = req.body.visibilidad === 'grupo';
  const r = await memoriaDuende.recordar({
    usuarioId: req.yo.id, autorId: req.yo.id,
    tipo: publico ? 'recado_publico' : 'dato',
    texto, visibilidad: publico ? 'grupo' : 'privado'
  });
  if (!r.ok) return res.status(400).json({ error: 'No se pudo guardar.' });
  res.json({ ok: true, reforzado: !!r.reforzado });
}));

// Olvidar un recuerdo propio.
app.post('/api/memoria/:id/olvidar', pedirLogin, A(async (req, res) => {
  const ok = await memoriaDuende.olvidar(Number(req.params.id), req.yo.id);
  res.json({ ok });
}));

// Mandarlo a dormir / despertarlo / callarlo desde la interfaz.
app.post('/api/duende/estado', pedirLogin, A(async (req, res) => {
  const accion = String(req.body.accion || '');
  let est;
  if (accion === 'dormir') est = await animo.dormir(req.yo.id);
  else if (accion === 'despertar') est = await animo.despertar(req.yo.id);
  else if (accion === 'callar') est = await animo.callar(req.yo.id, true);
  else if (accion === 'hablar') est = await animo.callar(req.yo.id, false);
  else return res.status(400).json({ error: 'Accion no valida.' });
  res.json({ ok: true, animo: est });
}));

/**
 * Lo que el duende dice por iniciativa propia: un consejo, un recuerdo tuyo,
 * algo del grupo o una idea de Navidad. El navegador lo pide cada tanto si la
 * persona lleva un rato sin escribir, para que no sea un chat que solo espera.
 */
app.get('/api/duende/nota', pedirLogin, A(async (req, res) => {
  const c = await cupo();
  const nota = await bot.mensajeEspontaneo(req.yo, {
    total: c.total, max: c.max, sorteoHecho: sorteo.sorteoHecho()
  });
  res.json({ ok: true, nota });
}));


// Marca un recado como entregado (lo llama el duende cuando ya lo contó).
app.post('/api/recado/:id/visto', pedirLogin, A(async (req, res) => {
  await bot.marcarRecadoEntregado(Number(req.params.id), req.yo.id);
  res.json({ ok: true });
}));

// Deja un recado para otro participante.
app.post('/api/recado', pedirLogin, A(async (req, res) => {
  const paraId = Number(req.body.para);
  const texto = limpiar(req.body.texto);
  const destino = await get('SELECT id FROM usuarios WHERE id = ? AND activo = 1', [paraId]);
  if (!destino) return res.status(400).json({ error: 'Ese amigo no existe.' });
  const r = await bot.dejarRecado({ deId: req.yo.id, paraId, texto, anonimo: req.body.anonimo ? 1 : 0 });
  if (!r.ok) {
    return res.status(400).json({
      error: r.motivo === 'revela'
        ? 'Ese mensaje revelaría el sorteo 🤐 El duende no lo puede llevar.'
        : 'No se pudo enviar el recado.'
    });
  }
  res.json({ ok: true });
}));

// Feedback sobre una idea: asi el duende aprende que le sirve a cada quien.
app.post('/api/idea/feedback', pedirLogin, A(async (req, res) => {
  const idea = limpiar(req.body.idea);
  if (!idea) return res.status(400).json({ error: 'Falta la idea.' });
  // la calificacion se guarda sobre el usuario que la recibiria, no sobre
  // quien la califica: lo que aprendemos es el gusto del destinatario
  const paraId = Number(req.body.para) || req.yo.id;
  if (paraId !== req.yo.id) {
    // solo se permite calificar ideas para el amigo que a uno le toco
    const a = await sorteo.asignacionDe(req.yo.id);
    if (!a || Number(a.id) !== paraId) return res.status(403).json({ error: 'No autorizado.' });
  }
  await knn.calificarIdea(paraId, idea, !!req.body.gusta);
  res.json({ ok: true });
}));

// ------------------------------------------------------------
//  Administración
// ------------------------------------------------------------
app.get('/admin', pedirLogin, pedirAdmin, A(async (req, res) => {
  res.render('admin', {
    titulo: 'Panel de administración',
    usuarios: await Q.todos(),
    parejas: await sorteo.todasLasAsignaciones(),
    dbFile: DB_FILE,
    usaTurso: USA_TURSO,
    // aviso si el admin sigue con la contraseña por defecto
    claveInsegura: bcrypt.compareSync('admin123', req.yo.password_hash)
  });
}));

app.post('/admin/config', pedirLogin, pedirAdmin, A(async (req, res) => {
  const max = parseInt(req.body.max_participantes, 10);
  if (Number.isFinite(max) && max >= 3 && max <= 100) await setConfig('max_participantes', max);
  for (const k of ['monto', 'fecha_evento', 'lugar', 'titulo_evento']) {
    if (req.body[k] !== undefined) await setConfig(k, limpiar(req.body[k]));
  }
  flash(req, 'ok', 'Configuración guardada ✅');
  res.redirect('/admin');
}));

app.post('/admin/sorteo', pedirLogin, pedirAdmin, A(async (req, res) => {
  const r = await sorteo.ejecutarSorteo({ forzar: req.body.forzar === '1' });
  flash(req, r.ok ? 'ok' : 'error', r.ok ? `🎲 ${r.motivo} (${r.total} participantes)` : r.motivo);
  res.redirect('/admin');
}));

app.post('/admin/reiniciar', pedirLogin, pedirAdmin, A(async (req, res) => {
  await sorteo.reiniciarSorteo();
  flash(req, 'ok', 'Sorteo reiniciado. Nadie tiene amigo secreto asignado.');
  res.redirect('/admin');
}));

app.post('/admin/usuario/:id/foto', pedirLogin, pedirAdmin, A(async (req, res) => {
  const foto = validarFoto(limpiar(req.body.foto));
  if (!foto) { flash(req, 'error', 'Foto inválida o muy pesada.'); return res.redirect('/admin'); }
  await run('UPDATE usuarios SET foto = ? WHERE id = ?', [foto, Number(req.params.id)]);
  flash(req, 'ok', 'Foto actualizada ✅');
  res.redirect('/admin');
}));

// El administrador puede cambiar usuario y/o contraseña de quien lo solicite
app.post('/admin/usuario/:id/credenciales', pedirLogin, pedirAdmin, A(async (req, res) => {
  const u = await Q.porId(req.params.id);
  if (!u) { flash(req, 'error', 'Usuario no encontrado.'); return res.redirect('/admin'); }

  const nuevoUsuario = limpiar(req.body.usuario);
  const nueva = limpiar(req.body.password);
  const cambios = [];

  if (nuevoUsuario && nuevoUsuario.toLowerCase() !== String(u.usuario).toLowerCase()) {
    if (!/^[a-zA-Z0-9._-]{3,20}$/.test(nuevoUsuario)) {
      flash(req, 'error', 'El usuario debe tener de 3 a 20 caracteres (letras, números, punto, guion).');
      return res.redirect('/admin');
    }
    if (await Q.porUsuario(nuevoUsuario)) {
      flash(req, 'error', `El usuario "${nuevoUsuario}" ya está tomado.`);
      return res.redirect('/admin');
    }
    await run('UPDATE usuarios SET usuario = ? WHERE id = ?', [nuevoUsuario, Number(u.id)]);
    cambios.push(`usuario → ${nuevoUsuario}`);
  }

  if (nueva) {
    if (nueva.length < 6) { flash(req, 'error', 'La contraseña debe tener al menos 6 caracteres.'); return res.redirect('/admin'); }
    await run('UPDATE usuarios SET password_hash = ? WHERE id = ?', [bcrypt.hashSync(nueva, 10), Number(u.id)]);
    cambios.push('contraseña restablecida');
  }

  flash(req, cambios.length ? 'ok' : 'error',
    cambios.length ? `Credenciales de ${u.nombre} actualizadas (${cambios.join(', ')}) ✅`
                   : 'No indicaste ningún cambio.');
  res.redirect('/admin');
}));

app.post('/admin/usuario/:id/estado', pedirLogin, pedirAdmin, A(async (req, res) => {
  const u = await Q.porId(req.params.id);
  if (!u || u.rol === 'admin') { flash(req, 'error', 'Operación no permitida.'); return res.redirect('/admin'); }
  await run('UPDATE usuarios SET activo = ? WHERE id = ?', [u.activo ? 0 : 1, Number(u.id)]);
  flash(req, 'ok', u.activo ? 'Participante desactivado.' : 'Participante reactivado.');
  res.redirect('/admin');
}));

app.post('/admin/usuario/:id/eliminar', pedirLogin, pedirAdmin, A(async (req, res) => {
  const u = await Q.porId(req.params.id);
  if (!u || u.rol === 'admin') { flash(req, 'error', 'No se puede eliminar al administrador.'); return res.redirect('/admin'); }
  await run('DELETE FROM usuarios WHERE id = ?', [Number(u.id)]);
  if (sorteo.sorteoHecho()) {
    await sorteo.reiniciarSorteo();
    flash(req, 'ok', `"${u.nombre}" fue eliminado. El sorteo se reinició porque cambió la lista.`);
  } else {
    flash(req, 'ok', `"${u.nombre}" fue eliminado.`);
  }
  res.redirect('/admin');
}));

app.post('/admin/usuario/:id/editar', pedirLogin, pedirAdmin, A(async (req, res) => {
  const u = await Q.porId(req.params.id);
  if (!u) { flash(req, 'error', 'Usuario no encontrado.'); return res.redirect('/admin'); }
  const campos = ['nombre', 'apodo', 'email', 'telefono', 'gustos', 'no_gustos', 'talla_ropa',
    'talla_zapato', 'color_favorito', 'hobbies', 'deseo1', 'deseo2', 'deseo3'];
  const datos = { id: Number(u.id) };
  for (const k of campos) datos[k] = limpiar(req.body[k]) || u[k] || null;
  await run(
    `UPDATE usuarios SET nombre=@nombre, apodo=@apodo, email=@email, telefono=@telefono,
        gustos=@gustos, no_gustos=@no_gustos, talla_ropa=@talla_ropa, talla_zapato=@talla_zapato,
        color_favorito=@color_favorito, hobbies=@hobbies, deseo1=@deseo1, deseo2=@deseo2, deseo3=@deseo3
      WHERE id=@id`, datos);
  flash(req, 'ok', 'Datos del participante actualizados ✅');
  res.redirect('/admin');
}));

// crear participante desde el panel (por si alguien no puede registrarse solo)
app.post('/admin/usuario/nuevo', pedirLogin, pedirAdmin, A(async (req, res) => {
  const d = {};
  for (const k of ['usuario', 'password', 'nombre', 'email', 'telefono', 'gustos', 'talla_ropa',
    'talla_zapato', 'color_favorito', 'hobbies', 'deseo1']) d[k] = limpiar(req.body[k]);
  if (Object.values(d).some(v => !v)) { flash(req, 'error', 'Completa todos los campos para crear el participante.'); return res.redirect('/admin'); }
  if (await Q.porUsuario(d.usuario)) { flash(req, 'error', 'Ese usuario ya existe.'); return res.redirect('/admin'); }
  const info = await run(
    `INSERT INTO usuarios
      (usuario, password_hash, nombre, email, telefono, gustos, talla_ropa, talla_zapato,
       color_favorito, hobbies, deseo1, rol)
     VALUES (@usuario, @password_hash, @nombre, @email, @telefono, @gustos, @talla_ropa, @talla_zapato,
       @color_favorito, @hobbies, @deseo1, 'participante')`,
    {
      usuario: d.usuario, password_hash: bcrypt.hashSync(d.password, 10), nombre: d.nombre,
      email: d.email, telefono: d.telefono, gustos: d.gustos, talla_ropa: d.talla_ropa,
      talla_zapato: d.talla_zapato, color_favorito: d.color_favorito, hobbies: d.hobbies, deseo1: d.deseo1
    }
  );
  await bot.guardarDeseo(info.lastInsertRowid, d.deseo1);
  const r = await sorteo.sortearSiEstaCompleto();
  flash(req, 'ok', r.ok ? 'Participante creado y sorteo realizado 🎲' : 'Participante creado ✅');
  res.redirect('/admin');
}));

// ------------------------------------------------------------
app.get('/api/aprendizaje', pedirLogin, A(async (req, res) => {
  res.json({
    ok: true,
    ...(await knn.estadisticas()),
    // lo que sabe de QUIEN pregunta, nunca de otro
    mio: await bot.loQueSeDeTi(req.yo.id)
  });
}));

app.get('/salud', A(async (req, res) => {
  res.json({ ok: true, almacenamiento: USA_TURSO ? 'turso' : 'archivo local', db: DB_FILE, ...(await cupo()), sorteo: sorteo.sorteoHecho() });
}));

app.use((req, res) => res.status(404).render('error', { titulo: 'No encontrado', codigo: 404, mensaje: 'Esta página se perdió camino al Polo Norte.' }));

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  const quiereJson = req.xhr || (req.get('accept') || '').includes('json');
  if (quiereJson) return res.status(500).json({ error: 'Error interno del servidor.' });
  res.status(500).render('error', { titulo: 'Error', codigo: 500, mensaje: 'Algo salió mal. Revisa la consola del servidor.' });
});

// ------------------------------------------------------------
init()
  // el duende recupera lo que aprendio en sesiones anteriores: su clasificador
  // de intenciones se reentrena con las frases reales de este grupo
  .then(async () => {
    const n = await bot.cargarAprendizaje();
    if (n) console.log(`  🧠 Duende: ${n} frase(s) de entrenamiento recuperadas`);
  })
  .then(() => {
    app.listen(PORT, () => {
      console.log('');
      console.log('  🎄 Amigo Secreto Navidad');
      console.log(`  ➜  http://localhost:${PORT}`);
      console.log(`  ➜  Almacenamiento: ${USA_TURSO ? 'Turso (nube)' : 'archivo local'} — ${DB_FILE}`);
      console.log(`  ➜  Admin: admin / ${process.env.ADMIN_PASSWORD ? '(definida en ADMIN_PASSWORD)' : 'admin123'}`);
      console.log('');
    });
  })
  .catch(err => {
    console.error('No se pudo iniciar la base de datos:', err);
    process.exit(1);
  });
