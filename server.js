'use strict';

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');

const { db, DB_FILE, getConfig, setConfig, allConfig } = require('./src/db');
const SqliteStore = require('./src/session-store');
const sorteo = require('./src/sorteo');
const bot = require('./src/bot');

const app = express();
const PORT = process.env.PORT || 3600;
const EN_PRODUCCION = process.env.NODE_ENV === 'production';

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
const Q = {
  porUsuario: db.prepare('SELECT * FROM usuarios WHERE lower(usuario) = lower(?)'),
  porId: db.prepare('SELECT * FROM usuarios WHERE id = ?'),
  listaParticipantes: db.prepare("SELECT * FROM usuarios WHERE rol = 'participante' ORDER BY nombre COLLATE NOCASE"),
  todos: db.prepare('SELECT * FROM usuarios ORDER BY rol DESC, nombre COLLATE NOCASE')
};

function cupo() {
  const max = parseInt(getConfig('max_participantes') || '8', 10);
  const total = sorteo.totalParticipantes();
  return { max, total, faltan: Math.max(0, max - total), completo: total >= max };
}

function usuarioActual(req) {
  if (!req.session.userId) return null;
  const u = Q.porId.get(req.session.userId);
  if (!u || !u.activo) return null;
  return u;
}

// token anti-CSRF por sesión
function csrf(req) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
  return req.session.csrf;
}

app.use((req, res, next) => {
  const u = usuarioActual(req);
  res.locals.yo = u;
  res.locals.esAdmin = !!u && u.rol === 'admin';
  res.locals.cfg = allConfig();
  res.locals.cupo = cupo();
  res.locals.sorteoHecho = sorteo.sorteoHecho();
  res.locals.csrfToken = csrf(req);
  res.locals.flash = req.session.flash || null;
  res.locals.ruta = req.path;
  // fotos que el Papá Noel va paseando por la página
  res.locals.caminata = db.prepare(
    "SELECT nombre, apodo, foto FROM usuarios WHERE rol = 'participante' AND activo = 1 ORDER BY id"
  ).all().map(u => ({ n: u.apodo || u.nombre.split(' ')[0], f: u.foto || null }));
  delete req.session.flash;
  next();
});

// valida CSRF en todos los POST
app.use((req, res, next) => {
  if (req.method !== 'POST') return next();
  const enviado = (req.body && req.body._csrf) || req.get('x-csrf-token');
  if (!enviado || enviado !== req.session.csrf) {
    if (req.xhr || req.get('accept')?.includes('json')) {
      return res.status(403).json({ error: 'Token de seguridad inválido. Recarga la página.' });
    }
    req.session.flash = { tipo: 'error', texto: 'Token de seguridad inválido. Vuelve a intentarlo.' };
    return res.redirect(req.get('referer') || '/');
  }
  next();
});

function pedirLogin(req, res, next) {
  if (!usuarioActual(req)) {
    req.session.flash = { tipo: 'error', texto: 'Inicia sesión para continuar.' };
    return res.redirect('/login');
  }
  next();
}

function pedirAdmin(req, res, next) {
  const u = usuarioActual(req);
  if (!u || u.rol !== 'admin') {
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
  if (dataUrl.length > 1_900_000) return null;
  return dataUrl;
}

// ------------------------------------------------------------
//  Público
// ------------------------------------------------------------
app.get('/', (req, res) => {
  if (usuarioActual(req)) return res.redirect('/inicio');
  res.render('landing', {
    titulo: 'Amigo Secreto',
    participantes: Q.listaParticipantes.all()
  });
});

app.get('/login', (req, res) => {
  if (usuarioActual(req)) return res.redirect('/inicio');
  res.render('login', { titulo: 'Ingresar' });
});

const intentos = new Map(); // control básico de fuerza bruta

app.post('/login', (req, res) => {
  const usuario = limpiar(req.body.usuario);
  const password = req.body.password || '';
  const llave = (req.ip || 'x') + '|' + usuario.toLowerCase();
  const reg = intentos.get(llave) || { n: 0, hasta: 0 };

  if (reg.hasta > Date.now()) {
    flash(req, 'error', 'Demasiados intentos. Espera un minuto e inténtalo de nuevo.');
    return res.redirect('/login');
  }

  const u = Q.porUsuario.get(usuario);
  if (!u || !u.activo || !bcrypt.compareSync(password, u.password_hash)) {
    reg.n += 1;
    if (reg.n >= 6) { reg.hasta = Date.now() + 60_000; reg.n = 0; }
    intentos.set(llave, reg);
    flash(req, 'error', 'Usuario o contraseña incorrectos.');
    return res.redirect('/login');
  }

  intentos.delete(llave);
  req.session.userId = u.id;
  req.session.csrf = crypto.randomBytes(24).toString('hex');
  res.redirect('/inicio');
});

app.get('/registro', (req, res) => {
  if (usuarioActual(req)) return res.redirect('/inicio');
  const c = cupo();
  res.render('registro', { titulo: 'Crear mi usuario', datos: {}, errores: [], lleno: c.completo });
});

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

app.post('/registro', (req, res) => {
  const d = {};
  for (const k of ['usuario', 'password', 'password2', 'nombre', 'apodo', 'email', 'telefono', 'cumple',
    'gustos', 'no_gustos', 'talla_ropa', 'talla_zapato', 'color_favorito', 'hobbies',
    'deseo1', 'deseo2', 'deseo3', 'direccion', 'foto']) {
    d[k] = limpiar(req.body[k]);
  }

  const errores = [];
  const c = cupo();
  if (c.completo) errores.push(`Ya se completaron los ${c.max} participantes. Habla con el administrador.`);

  for (const [campo, etiqueta] of CAMPOS_OBLIGATORIOS) {
    if (!d[campo]) errores.push(`El campo "${etiqueta}" es obligatorio.`);
  }
  if (d.usuario && !/^[a-zA-Z0-9._-]{3,20}$/.test(d.usuario)) {
    errores.push('El usuario debe tener de 3 a 20 caracteres (letras, números, punto, guion).');
  }
  if (d.usuario && Q.porUsuario.get(d.usuario)) errores.push('Ese usuario ya está tomado, elige otro.');
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

  const info = db.prepare(`INSERT INTO usuarios
    (usuario, password_hash, nombre, apodo, email, telefono, cumple, gustos, no_gustos,
     talla_ropa, talla_zapato, color_favorito, hobbies, deseo1, deseo2, deseo3, direccion, foto, rol)
    VALUES (@usuario, @password_hash, @nombre, @apodo, @email, @telefono, @cumple, @gustos, @no_gustos,
     @talla_ropa, @talla_zapato, @color_favorito, @hobbies, @deseo1, @deseo2, @deseo3, @direccion, @foto, 'participante')`)
    .run({
      usuario: d.usuario,
      password_hash: bcrypt.hashSync(d.password, 10),
      nombre: d.nombre, apodo: d.apodo || null, email: d.email, telefono: d.telefono,
      cumple: d.cumple || null, gustos: d.gustos, no_gustos: d.no_gustos || null,
      talla_ropa: d.talla_ropa, talla_zapato: d.talla_zapato, color_favorito: d.color_favorito,
      hobbies: d.hobbies, deseo1: d.deseo1, deseo2: d.deseo2 || null, deseo3: d.deseo3 || null,
      direccion: d.direccion || null, foto: foto
    });

  // los deseos iniciales alimentan al bot
  for (const t of [d.deseo1, d.deseo2, d.deseo3].filter(Boolean)) bot.guardarDeseo(info.lastInsertRowid, t);

  const r = sorteo.sortearSiEstaCompleto();
  req.session.userId = info.lastInsertRowid;
  req.session.csrf = crypto.randomBytes(24).toString('hex');
  flash(req, 'ok', r.ok
    ? '¡Bienvenido! Se completaron los participantes y el sorteo ya se realizó. Abre tu regalo 🎁'
    : '¡Tu usuario fue creado! 🎄');
  res.redirect('/inicio');
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// ------------------------------------------------------------
//  Zona privada
// ------------------------------------------------------------
app.get('/inicio', pedirLogin, (req, res) => {
  const yo = usuarioActual(req);
  const asignado = yo.rol === 'participante' ? sorteo.asignacionDe(yo.id) : null;
  res.render('dashboard', {
    titulo: 'Mi Navidad',
    asignado,
    misDeseos: bot.deseosDe(yo.id),
    participantes: Q.listaParticipantes.all(),
    parejas: yo.rol === 'admin' ? sorteo.todasLasAsignaciones() : []
  });
});

app.post('/revelar', pedirLogin, (req, res) => {
  const yo = usuarioActual(req);
  const a = sorteo.asignacionDe(yo.id);
  if (!a) return res.status(404).json({ error: 'Aún no hay sorteo.' });
  sorteo.marcarVisto(yo.id);
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
});

app.get('/participantes', pedirLogin, (req, res) => {
  res.render('participantes', {
    titulo: 'Los amigos',
    participantes: Q.listaParticipantes.all()
  });
});

app.get('/participante/:id', pedirLogin, (req, res) => {
  const yo = usuarioActual(req);
  const u = Q.porId.get(req.params.id);
  if (!u || u.rol !== 'participante') {
    flash(req, 'error', 'Ese participante no existe.');
    return res.redirect('/participantes');
  }
  const mio = sorteo.asignacionDe(yo.id);
  const esMiAmigo = !!mio && mio.id === u.id;
  // La lista privada del bot solo se muestra si es MI amigo secreto (o soy admin)
  const deseosBot = (esMiAmigo || yo.rol === 'admin') ? bot.deseosDe(u.id) : [];
  res.render('participante', {
    titulo: u.nombre,
    u, esMiAmigo, deseosBot,
    soyYo: yo.id === u.id
  });
});

app.get('/perfil', pedirLogin, (req, res) => {
  const yo = usuarioActual(req);
  res.render('perfil', { titulo: 'Mi perfil', datos: yo, errores: [], misDeseos: bot.deseosDe(yo.id) });
});

app.post('/perfil', pedirLogin, (req, res) => {
  const yo = usuarioActual(req);
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
      misDeseos: bot.deseosDe(yo.id)
    });
  }

  db.prepare(`UPDATE usuarios SET nombre=@nombre, apodo=@apodo, email=@email, telefono=@telefono,
      cumple=@cumple, gustos=@gustos, no_gustos=@no_gustos, talla_ropa=@talla_ropa,
      talla_zapato=@talla_zapato, color_favorito=@color_favorito, hobbies=@hobbies,
      deseo1=@deseo1, deseo2=@deseo2, deseo3=@deseo3, direccion=@direccion,
      foto = COALESCE(@foto, foto)
      WHERE id=@id`).run({
    id: yo.id,
    nombre: d.nombre, apodo: d.apodo || null, email: d.email, telefono: d.telefono,
    cumple: d.cumple || null, gustos: d.gustos, no_gustos: d.no_gustos || null,
    talla_ropa: d.talla_ropa, talla_zapato: d.talla_zapato, color_favorito: d.color_favorito,
    hobbies: d.hobbies, deseo1: d.deseo1, deseo2: d.deseo2 || null, deseo3: d.deseo3 || null,
    direccion: d.direccion || null, foto: fotoNueva === undefined ? null : fotoNueva
  });

  if (d.password) {
    db.prepare('UPDATE usuarios SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(d.password, 10), yo.id);
  }
  for (const t of [d.deseo1, d.deseo2, d.deseo3].filter(Boolean)) bot.guardarDeseo(yo.id, t);

  flash(req, 'ok', 'Perfil actualizado ✅');
  res.redirect('/perfil');
});

app.post('/perfil/deseo', pedirLogin, (req, res) => {
  const yo = usuarioActual(req);
  const texto = limpiar(req.body.texto);
  const ok = bot.guardarDeseo(yo.id, texto);
  if (req.get('accept')?.includes('json')) return res.json({ ok });
  flash(req, ok ? 'ok' : 'error', ok ? 'Agregado a tu lista de deseos 🎁' : 'No se pudo agregar (vacío o repetido).');
  res.redirect('/perfil');
});

// ------------------------------------------------------------
//  Bot
// ------------------------------------------------------------
app.get('/bot', pedirLogin, (req, res) => {
  const yo = usuarioActual(req);
  const a = sorteo.asignacionDe(yo.id);
  res.render('bot', {
    titulo: 'Duende Ayudante',
    historial: bot.historial(yo.id),
    tieneAmigo: !!a,
    misDeseos: bot.deseosDe(yo.id)
  });
});

// Estado que alimenta al duende flotante y al aviso automático del sorteo.
// Solo devuelve datos del usuario en sesión: nunca la asignación de otro.
app.get('/api/estado', pedirLogin, (req, res) => {
  const yo = usuarioActual(req);
  const c = cupo();
  const a = yo.rol === 'participante' ? sorteo.asignacionDe(yo.id) : null;
  res.json({
    yo: { id: yo.id, nombre: yo.nombre, apodo: yo.apodo, rol: yo.rol },
    cupo: c,
    sorteoHecho: sorteo.sorteoHecho(),
    visto: a ? !!a.visto : false,
    evento: { monto: getConfig('monto'), fecha: getConfig('fecha_evento'), lugar: getConfig('lugar') },
    amigo: a ? {
      id: a.id,
      nombre: a.nombre,
      apodo: a.apodo,
      foto: a.foto,
      gustos: a.gustos,
      hobbies: a.hobbies,
      color_favorito: a.color_favorito,
      talla_ropa: a.talla_ropa,
      talla_zapato: a.talla_zapato,
      no_gustos: a.no_gustos,
      deseos: [a.deseo1, a.deseo2, a.deseo3].filter(Boolean)
        .concat(bot.deseosDe(a.id).map(d => d.texto))
        .filter((v, i, arr) => arr.indexOf(v) === i)
    } : null
  });
});

app.post('/api/bot', pedirLogin, (req, res) => {
  const yo = usuarioActual(req);
  const texto = limpiar(req.body.texto);
  if (!texto) return res.status(400).json({ error: 'Escribe algo 🙂' });
  if (texto.length > 500) return res.status(400).json({ error: 'Mensaje demasiado largo.' });
  const asignado = sorteo.asignacionDe(yo.id);
  const amigo = asignado ? Q.porId.get(asignado.id) : null;
  const r = bot.responder({ user: yo, amigo, texto });
  res.json({ ok: true, reply: r.reply, aprendido: r.aprendido, deseos: bot.deseosDe(yo.id) });
});

// ------------------------------------------------------------
//  Administración
// ------------------------------------------------------------
app.get('/admin', pedirLogin, pedirAdmin, (req, res) => {
  const yo = usuarioActual(req);
  res.render('admin', {
    titulo: 'Panel de administración',
    usuarios: Q.todos.all(),
    parejas: sorteo.todasLasAsignaciones(),
    dbFile: DB_FILE,
    // aviso si el admin sigue con la contraseña por defecto
    claveInsegura: bcrypt.compareSync('admin123', yo.password_hash)
  });
});

app.post('/admin/config', pedirLogin, pedirAdmin, (req, res) => {
  const max = parseInt(req.body.max_participantes, 10);
  if (Number.isFinite(max) && max >= 3 && max <= 100) setConfig('max_participantes', max);
  for (const k of ['monto', 'fecha_evento', 'lugar', 'titulo_evento']) {
    if (req.body[k] !== undefined) setConfig(k, limpiar(req.body[k]));
  }
  flash(req, 'ok', 'Configuración guardada ✅');
  res.redirect('/admin');
});

app.post('/admin/sorteo', pedirLogin, pedirAdmin, (req, res) => {
  const r = sorteo.ejecutarSorteo({ forzar: req.body.forzar === '1' });
  flash(req, r.ok ? 'ok' : 'error', r.ok ? `🎲 ${r.motivo} (${r.total} participantes)` : r.motivo);
  res.redirect('/admin');
});

app.post('/admin/reiniciar', pedirLogin, pedirAdmin, (req, res) => {
  sorteo.reiniciarSorteo();
  flash(req, 'ok', 'Sorteo reiniciado. Nadie tiene amigo secreto asignado.');
  res.redirect('/admin');
});

app.post('/admin/usuario/:id/foto', pedirLogin, pedirAdmin, (req, res) => {
  const foto = validarFoto(limpiar(req.body.foto));
  if (!foto) { flash(req, 'error', 'Foto inválida o muy pesada.'); return res.redirect('/admin'); }
  db.prepare('UPDATE usuarios SET foto = ? WHERE id = ?').run(foto, req.params.id);
  flash(req, 'ok', 'Foto actualizada ✅');
  res.redirect('/admin');
});

// El administrador puede cambiar usuario y/o contraseña de quien lo solicite
app.post('/admin/usuario/:id/credenciales', pedirLogin, pedirAdmin, (req, res) => {
  const u = Q.porId.get(req.params.id);
  if (!u) { flash(req, 'error', 'Usuario no encontrado.'); return res.redirect('/admin'); }

  const nuevoUsuario = limpiar(req.body.usuario);
  const nueva = limpiar(req.body.password);
  const cambios = [];

  if (nuevoUsuario && nuevoUsuario.toLowerCase() !== u.usuario.toLowerCase()) {
    if (!/^[a-zA-Z0-9._-]{3,20}$/.test(nuevoUsuario)) {
      flash(req, 'error', 'El usuario debe tener de 3 a 20 caracteres (letras, números, punto, guion).');
      return res.redirect('/admin');
    }
    if (Q.porUsuario.get(nuevoUsuario)) {
      flash(req, 'error', `El usuario "${nuevoUsuario}" ya está tomado.`);
      return res.redirect('/admin');
    }
    db.prepare('UPDATE usuarios SET usuario = ? WHERE id = ?').run(nuevoUsuario, u.id);
    cambios.push(`usuario → ${nuevoUsuario}`);
  }

  if (nueva) {
    if (nueva.length < 6) { flash(req, 'error', 'La contraseña debe tener al menos 6 caracteres.'); return res.redirect('/admin'); }
    db.prepare('UPDATE usuarios SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(nueva, 10), u.id);
    cambios.push('contraseña restablecida');
  }

  flash(req, cambios.length ? 'ok' : 'error',
    cambios.length ? `Credenciales de ${u.nombre} actualizadas (${cambios.join(', ')}) ✅`
                   : 'No indicaste ningún cambio.');
  res.redirect('/admin');
});

app.post('/admin/usuario/:id/estado', pedirLogin, pedirAdmin, (req, res) => {
  const u = Q.porId.get(req.params.id);
  if (!u || u.rol === 'admin') { flash(req, 'error', 'Operación no permitida.'); return res.redirect('/admin'); }
  db.prepare('UPDATE usuarios SET activo = ? WHERE id = ?').run(u.activo ? 0 : 1, u.id);
  flash(req, 'ok', u.activo ? 'Participante desactivado.' : 'Participante reactivado.');
  res.redirect('/admin');
});

app.post('/admin/usuario/:id/eliminar', pedirLogin, pedirAdmin, (req, res) => {
  const u = Q.porId.get(req.params.id);
  if (!u || u.rol === 'admin') { flash(req, 'error', 'No se puede eliminar al administrador.'); return res.redirect('/admin'); }
  db.prepare('DELETE FROM usuarios WHERE id = ?').run(u.id);
  if (sorteo.sorteoHecho()) {
    sorteo.reiniciarSorteo();
    flash(req, 'ok', `"${u.nombre}" fue eliminado. El sorteo se reinició porque cambió la lista.`);
  } else {
    flash(req, 'ok', `"${u.nombre}" fue eliminado.`);
  }
  res.redirect('/admin');
});

app.post('/admin/usuario/:id/editar', pedirLogin, pedirAdmin, (req, res) => {
  const u = Q.porId.get(req.params.id);
  if (!u) { flash(req, 'error', 'Usuario no encontrado.'); return res.redirect('/admin'); }
  const campos = ['nombre', 'apodo', 'email', 'telefono', 'gustos', 'no_gustos', 'talla_ropa',
    'talla_zapato', 'color_favorito', 'hobbies', 'deseo1', 'deseo2', 'deseo3'];
  const datos = { id: u.id };
  for (const k of campos) datos[k] = limpiar(req.body[k]) || u[k];
  db.prepare(`UPDATE usuarios SET nombre=@nombre, apodo=@apodo, email=@email, telefono=@telefono,
      gustos=@gustos, no_gustos=@no_gustos, talla_ropa=@talla_ropa, talla_zapato=@talla_zapato,
      color_favorito=@color_favorito, hobbies=@hobbies, deseo1=@deseo1, deseo2=@deseo2, deseo3=@deseo3
      WHERE id=@id`).run(datos);
  flash(req, 'ok', 'Datos del participante actualizados ✅');
  res.redirect('/admin');
});

// crear participante desde el panel (por si alguien no puede registrarse solo)
app.post('/admin/usuario/nuevo', pedirLogin, pedirAdmin, (req, res) => {
  const d = {};
  for (const k of ['usuario', 'password', 'nombre', 'email', 'telefono', 'gustos', 'talla_ropa',
    'talla_zapato', 'color_favorito', 'hobbies', 'deseo1']) d[k] = limpiar(req.body[k]);
  if (Object.values(d).some(v => !v)) { flash(req, 'error', 'Completa todos los campos para crear el participante.'); return res.redirect('/admin'); }
  if (Q.porUsuario.get(d.usuario)) { flash(req, 'error', 'Ese usuario ya existe.'); return res.redirect('/admin'); }
  const info = db.prepare(`INSERT INTO usuarios
    (usuario, password_hash, nombre, email, telefono, gustos, talla_ropa, talla_zapato,
     color_favorito, hobbies, deseo1, rol)
    VALUES (@usuario, @password_hash, @nombre, @email, @telefono, @gustos, @talla_ropa, @talla_zapato,
     @color_favorito, @hobbies, @deseo1, 'participante')`).run({
    usuario: d.usuario, password_hash: bcrypt.hashSync(d.password, 10), nombre: d.nombre,
    email: d.email, telefono: d.telefono, gustos: d.gustos, talla_ropa: d.talla_ropa,
    talla_zapato: d.talla_zapato, color_favorito: d.color_favorito, hobbies: d.hobbies, deseo1: d.deseo1
  });
  bot.guardarDeseo(info.lastInsertRowid, d.deseo1);
  const r = sorteo.sortearSiEstaCompleto();
  flash(req, 'ok', r.ok ? 'Participante creado y sorteo realizado 🎲' : 'Participante creado ✅');
  res.redirect('/admin');
});

// ------------------------------------------------------------
app.get('/salud', (req, res) => res.json({ ok: true, db: DB_FILE, ...cupo(), sorteo: sorteo.sorteoHecho() }));

app.use((req, res) => res.status(404).render('error', { titulo: 'No encontrado', codigo: 404, mensaje: 'Esta página se perdió camino al Polo Norte.' }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', { titulo: 'Error', codigo: 500, mensaje: 'Algo salió mal. Revisa la consola del servidor.' });
});

app.listen(PORT, () => {
  console.log('');
  console.log('  🎄 Amigo Secreto Navidad');
  console.log(`  ➜  http://localhost:${PORT}`);
  console.log(`  ➜  Base de datos: ${DB_FILE}`);
  console.log('  ➜  Admin: admin / admin123');
  console.log('');
});
