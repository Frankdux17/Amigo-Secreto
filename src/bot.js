'use strict';
/**
 * ============================================================================
 *  EL DUENDE AYUDANTE
 * ============================================================================
 *
 *  Un asistente que conversa, aprende y hace de mensajero entre los amigos.
 *  Apoyado en src/knn.js para la parte de aprendizaje (k-NN + filtrado
 *  colaborativo) y en unas cuantas reglas para entender la intención.
 *
 *  REGLA DE ORO, POR ENCIMA DE TODO LO DEMÁS
 *  -----------------------------------------
 *  El duende JAMÁS revela a quién le tocó quién. Ni el del que pregunta a
 *  otro, ni el de un tercero, ni por aproximación ("¿le tocó alguien de
 *  Lima?"), ni jugando, ni aunque se lo pidan de mil formas.
 *
 *  Esto no se confía a que el modelo "se porte bien": está garantizado por
 *  construcción. El duende recibe del servidor ÚNICAMENTE la asignación de
 *  quien está preguntando (el parámetro `amigo`). Las parejas de los demás
 *  no entran nunca en este módulo, así que no hay nada que se pueda filtrar
 *  aunque una respuesta saliera mal redactada. Y, por si acaso, los recados
 *  que un amigo manda a otro se revisan antes de entregarse: si alguien
 *  intenta usar al duende para contar a quién le tocó, el recado se bloquea.
 * ============================================================================
 */

const { all, get, run } = require('./db');
const knn = require('./knn');

const sinTildes = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const norm = (s) => sinTildes(s).toLowerCase().trim();
const corto = (u) => u ? (u.apodo || String(u.nombre).split(' ')[0]) : 'alguien';
const alAzar = (a) => a[Math.floor(Math.random() * a.length)];

// --------------------------------------------------------------------------
// Intenciones. Primero las más específicas: el orden del dispatcher importa.
// --------------------------------------------------------------------------
const RX = {
  cosquillas:  /\b(cosquilla|cosquillas|jaja|jeje|risa|gracioso|chistoso|haz me reir|hazme reir)\b/i,
  fisgon:      /\b(a qui[eé]n le toc[oó]|qui[eé]n tiene a|a qui[eé]n sac[oó]|qui[eé]n le sali[oó]|qui[eé]n es el amigo secreto de|de qui[eé]n es amigo secreto|dime a qui[eé]n|qui[eé]n me tiene|qui[eé]n me sac[oó])\b/i,
  recadoResp:  /^(s[ií]|ya|dale|mandale|m[aá]ndale|env[ií]ale|dile|responde|contesta)\b/i,
  recado:      /\b(preg[uú]ntale|dile|mand[aá]le|m[aá]ndale|av[ií]sale|cu[eé]ntale|escr[ií]bele|recado|mensaje para)\b/i,
  afinidad:    /\b(parecido|parezco|afinidad|en com[uú]n|mejor amigo|me parezco|quien se parece|con qui[eé]n)\b/i,
  grupo:       /\b(grupo|amigos|participantes|qui[eé]nes? (est[aá]n|hay|somos)|cu[aá]ntos|falta|faltan|lista de amigos)\b/i,
  quienEs:     /\b(qui[eé]n es|h[aá]blame de|cu[eé]ntame de|conoces a|c[oó]mo es)\b/i,
  juego:       /\b(juguemos|juego|jugar|adivina|adivinanza|trivia|aburr|entret[eé]n|hazme|algo divertido)\b/i,
  aprenderDe:  /\b(le gusta a|a \w+ le gusta|es muy|es bien|es un|es una)\b/i,
  noQuiero:    /\b(no me gusta|odio|detesto|no quiero|no me gustan|no soporto)\b/i,
  quiero:      /\b(quiero|quisiera|me gustar[ií]a|me encanta|me gusta|me fascina|s[uú]beme|an[oó]tame|ap[uú]ntame)\b/i,
  amigo:       /\b(mi amigo|amigo secreto|le gusta|regalarle|qu[eé] le|para [eé]l|para ella|a qui[eé]n le regalo)\b/i,
  ideas:       /\b(idea|ideas|regalo|regalos|sugerencia|sugiere|recomienda|recomiendame|qu[eé] compro|qu[eé] le compro)\b/i,
  presupuesto: /\b(monto|presupuesto|cu[aá]nto|precio|plata|soles|gastar|vale)\b/i,
  fecha:       /\b(fecha|cu[aá]ndo|d[ií]a|navidad|lugar|d[oó]nde)\b/i,
  reglas:      /\b(regla|reglas|c[oó]mo funciona|qu[eé] hago|ayuda|ayudame|no entiendo|sorteo)\b/i,
  verLista:    /\b(mi lista|mis deseos|qu[eé] ped[ií]|qu[eé] sabes de m[ií]|mi perfil|qu[eé] aprendiste)\b/i,
  gracias:     /\b(gracias|genial|buenaz|excelente|perfecto|te quiero|eres lo máximo|crack)\b/i,
  saludo:      /\b(hola|buenas|hey|qu[eé] tal|holi|saludos|buen d[ií]a|buenas tardes|buenas noches)\b/i
};

// --------------------------------------------------------------------------
// Guardas de privacidad
// --------------------------------------------------------------------------

/** Frases con las que el duende esquiva a los curiosos, siempre con gracia. */
const ESQUIVES = [
  'Ni de broma 🤐 Ese es EL secreto. Puedo contarte de sus gustos, de quién se parece a quién, de todo… menos de eso.',
  'Jajaja lo intentaste 😄 Pero soy una tumba. Lo único que sé decirte es a quién te tocó a ti, nada más.',
  'Mis labios están sellados con cinta navideña 🎀 Pregúntame cualquier otra cosa del grupo y te cuento todo.',
  'Nop. Si suelto eso me quitan el gorro 🧝 Pero sí te digo qué le gusta a la gente, ¿te sirve?'
];

/**
 * ¿Este texto intenta contar a quién le tocó quién?
 * Se usa para revisar los recados antes de entregarlos: un amigo puede
 * escribirle a otro lo que quiera, menos destripar el sorteo.
 */
function revelaSorteo(texto) {
  const t = norm(texto);
  return /\b(me toc[oó]|te toc[oó]|le toc[oó]|mi amigo secreto es|tu amigo secreto es|su amigo secreto es|tengo a|saqu[eé] a|me sali[oó]|soy tu amigo secreto|eres mi amigo secreto)\b/.test(t);
}

// --------------------------------------------------------------------------
// Memoria de conversación (lo que ya existía) + recados
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

/** Recados que le esperan a alguien. */
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
// Utilidades de conversación
// --------------------------------------------------------------------------

/** Extrae lo que sigue a un verbo: "quiero una taza y un libro" → [taza, libro] */
function extraerCosas(texto) {
  const t = String(texto)
    .replace(/.*\b(quiero|quisiera|me gustar[ií]a|me encanta[n]?|me gusta[n]?|me fascina[n]?|s[uú]beme|an[oó]tame|ap[uú]ntame|no me gusta[n]?|odio|detesto|no quiero|no soporto)\b/i, '')
    .replace(/^[\s:,.]+/, '');
  return t.split(/,| y | o |;|\/|\+/i)
    .map(x => x.trim().replace(/[.!?]+$/, ''))
    .filter(x => x.length >= 3 && x.length <= 90)
    .slice(0, 5);
}

/** Busca a un participante por nombre o apodo dentro de una frase. */
function buscarPersona(texto, gente, excluirId = null) {
  const t = norm(texto);
  let mejor = null;
  for (const p of gente) {
    if (excluirId && p.id === excluirId) continue;
    for (const etiqueta of [p.apodo, p.nombre, String(p.nombre).split(' ')[0], p.usuario].filter(Boolean)) {
      const e = norm(etiqueta);
      if (e.length >= 3 && t.includes(e) && (!mejor || e.length > mejor.largo)) {
        mejor = { persona: p, largo: e.length };
      }
    }
  }
  return mejor ? mejor.persona : null;
}

/** Una pincelada social de alguien, sin tocar jamás el sorteo. */
async function retrato(p) {
  const trozos = [];
  if (p.gustos) trozos.push(`le gusta <b>${p.gustos}</b>`);
  if (p.hobbies) trozos.push(`en sus ratos libres: <b>${p.hobbies}</b>`);
  const aprendido = await knn.loAprendido(p.id, 'gusta');
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
    return { texto: 'Cuando haya más amigos registrados te propongo juegos 🎲 Por ahora, cuéntame tú: ¿qué es lo que más te gustaría recibir?', aprende: true };
  }
  const tipo = alAzar(['adivina_gusto', 'afinidad', 'dos_verdades']);

  if (tipo === 'adivina_gusto') {
    const conGustos = otros.filter(o => o.gustos && o.gustos.length > 4);
    if (conGustos.length) {
      const p = alAzar(conGustos);
      return { texto: `🎲 <b>Adivina quién</b><br>A esta persona le gusta: <b>${p.gustos}</b><br>¿Quién crees que es? Escribe su nombre.`, espera: { tipo: 'adivina', id: p.id, nombre: corto(p) } };
    }
  }
  if (tipo === 'afinidad') {
    const r = await knn.ranking(user.id);
    if (r.length && r[0].afinidad > 0) {
      return { texto: `🧮 Según lo que sé de ustedes, con quien más cosas tienes en común es <b>${r[0].apodo || r[0].nombre}</b> (${r[0].afinidad}% de afinidad). ¿Lo sabías? Cuéntame algo más tuyo y recalculo.`, aprende: true };
    }
  }
  const p = alAzar(otros);
  return { texto: `🎲 <b>Reto rápido</b><br>Dime una cosa que creas que le gusta a <b>${corto(p)}</b>. Si aciertas, lo anoto y le sirve a quien le toque regalarle 😉`, espera: { tipo: 'suponer', id: p.id, nombre: corto(p) } };
}

// --------------------------------------------------------------------------
// EL CEREBRO
// --------------------------------------------------------------------------
/**
 * @param {object}  user         quien escribe
 * @param {object?} amigo        SU amigo secreto (o null). Nunca el de otro.
 * @param {string}  texto        lo que escribió
 * @param {object}  ctx          { sorteoHecho, total, max, monto, fecha, lugar }
 * @param {object?} espera       lo que el duende dejó pendiente en el turno anterior
 */
async function responder({ user, amigo, texto, ctx = {}, espera = null }) {
  const t = String(texto || '').trim();
  await guardarChat(user.id, 'user', t);

  const gente = await all(
    "SELECT id, usuario, nombre, apodo, gustos, no_gustos, hobbies FROM usuarios " +
    "WHERE rol = 'participante' AND activo = 1 ORDER BY id"
  );
  const otros = gente.filter(g => g.id !== user.id);
  const faltan = Math.max(0, (ctx.max || 8) - (ctx.total || gente.length));

  const salida = (texto, extra = {}) => ({ texto, ...extra });
  let r;

  // ---- 0. ¿Estábamos esperando algo del turno anterior? -------------------
  if (espera && espera.tipo === 'adivina') {
    const acerto = norm(t).includes(norm(espera.nombre));
    r = salida(acerto
      ? `¡Correcto! 🎉 Era <b>${espera.nombre}</b>. Se nota que se conocen.`
      : `Casi 😄 Era <b>${espera.nombre}</b>. ¿Jugamos otra?`);
  } else if (espera && espera.tipo === 'suponer') {
    const cosas = extraerCosas(t).length ? extraerCosas(t) : [t];
    for (const c of cosas) {
      await knn.aprender({ usuarioId: espera.id, tipo: 'gusta', valor: c, origen: 'tercero', autorId: user.id });
    }
    r = salida(`Anotado 📝 Dices que a <b>${espera.nombre}</b> le gusta <b>${cosas.join('</b>, <b>')}</b>. Lo guardo: le servirá a quien le toque regalarle (y no, no te voy a decir quién es 😏).`);
  } else if (espera && espera.tipo === 'recado_texto') {
    const destino = gente.find(g => g.id === espera.id);
    const res = await dejarRecado({ deId: user.id, paraId: espera.id, texto: t });
    r = salida(
      res.ok ? `¡Listo! 🧝‍♂️ Vuelo a decirle a <b>${corto(destino)}</b>: «${t}». Se lo entrego apenas entre.`
      : res.motivo === 'revela' ? `Uy, ahí casi destripas el sorteo 🤐 Eso no lo llevo. Mándale otra cosa y con gusto se la digo.`
      : `No pude llevar ese recado. ¿Lo intentas de otra forma?`);
  }

  // ---- 1. Curiosos: la guarda va antes que todo lo demás ------------------
  else if (RX.fisgon.test(t)) {
    r = salida(alAzar(ESQUIVES), { sugerencias: ['¿Qué le gusta a…?', '¿Con quién me parezco?', 'Dame ideas'] });
  }

  // ---- 2. Recados: el duende de mensajero ---------------------------------
  else if (RX.recado.test(t)) {
    const destino = buscarPersona(t, gente, user.id);
    if (!destino) {
      r = salida(`¿A quién le llevo el recado? Dime su nombre, por ejemplo: «dile a ${corto(alAzar(otros.length ? otros : gente))} que…»`,
        { sugerencias: otros.slice(0, 3).map(o => `Dile a ${corto(o)} que…`) });
    } else {
      // ¿ya viene el mensaje en la misma frase?
      const m = t.match(/\b(?:que|:)\s+(.{3,300})$/i);
      if (m) {
        const res = await dejarRecado({ deId: user.id, paraId: destino.id, texto: m[1] });
        r = salida(
          res.ok ? `¡Volando voy! 🧝‍♂️💨 Le digo a <b>${corto(destino)}</b>: «${m[1]}»`
          : res.motivo === 'revela' ? 'Ese recado casi suelta el secreto del sorteo 🤐 No lo llevo. Mándale otra cosa.'
          : 'No pude llevar ese recado, inténtalo de otra forma.');
      } else {
        r = salida(`Dale, ¿qué le digo a <b>${corto(destino)}</b>? Escríbelo y se lo llevo volando 💨`,
          { espera: { tipo: 'recado_texto', id: destino.id, nombre: corto(destino) } });
      }
    }
  }

  // ---- 3. Cosquillas ------------------------------------------------------
  else if (RX.cosquillas.test(t)) {
    r = salida(alAzar([
      '¡JAJAJA no, las cosquillas no! 🤣 Se me cae el gorro y los cascabeles 🔔',
      '¡Ay, ay, ay! 😂 Me rindo, me rindo… pero igual no suelto el secreto 🤐',
      'Jijiji 🧝 ¡me haces reír! Oye, ya que estamos de buen humor, ¿te doy una idea de regalo?'
    ]), { animacion: 'cosquillas' });
  }

  // ---- 4. Afinidad: "¿con quién me parezco?" ------------------------------
  else if (RX.afinidad.test(t)) {
    const rk = await knn.ranking(user.id);
    if (!rk.length) {
      r = salida('Todavía no hay con quién compararte 😅 Cuando se registren más amigos te digo con quién tienes más en común.');
    } else {
      const top = rk.slice(0, 3);
      r = salida(
        `🧮 Calculé la afinidad comparando los gustos de todos:<br>` +
        top.map((p, i) => `${['🥇', '🥈', '🥉'][i]} <b>${p.apodo || p.nombre}</b> — ${p.afinidad}%`).join('<br>') +
        `<br><br>Con <b>${top[0].apodo || top[0].nombre}</b> eres el que más cosas comparte. Cuéntame más de ti y lo recalculo 😉`,
        { sugerencias: [`¿Quién es ${top[0].apodo || String(top[0].nombre).split(' ')[0]}?`, `Dile a ${top[0].apodo || String(top[0].nombre).split(' ')[0]} que…`, 'Juguemos algo'] });
    }
  }

  // ---- 5. El grupo --------------------------------------------------------
  else if (RX.grupo.test(t)) {
    const nombres = gente.map(g => `<b>${corto(g)}</b>`).join(', ');
    r = salida(
      faltan > 0
        ? `Por ahora somos <b>${gente.length}</b> de <b>${ctx.max || 8}</b>: ${nombres}.<br>Faltan <b>${faltan}</b> para que se dispare el sorteo 🎲 Mientras tanto, ¿quieres que te cuente de alguien o jugamos algo?`
        : `¡Ya estamos completos! 🎉 Somos <b>${gente.length}</b>: ${nombres}.<br>${ctx.sorteoHecho ? 'El sorteo ya se hizo 🎁' : 'El sorteo está por salir 🎲'}`,
      { sugerencias: otros.slice(0, 2).map(o => `¿Quién es ${corto(o)}?`).concat(['¿Con quién me parezco?']) });
  }

  // ---- 6. "¿Quién es Peter?" ---------------------------------------------
  else if (RX.quienEs.test(t)) {
    const p = buscarPersona(t, gente, null);
    if (!p) {
      r = salida(`¿De quién te cuento? Están: ${gente.map(g => `<b>${corto(g)}</b>`).join(', ')}`,
        { sugerencias: otros.slice(0, 3).map(o => `¿Quién es ${corto(o)}?`) });
    } else if (p.id === user.id) {
      r = salida(`¡Ese eres tú! 😄 Y sé que ${await retrato(p)}`);
    } else {
      const af = await knn.afinidad(user.id, p.id);
      r = salida(
        `🧝 <b>${corto(p)}</b>: ${await retrato(p)}.<br><br>` +
        (af > 0 ? `Por cierto, tienen un <b>${af}%</b> de cosas en común.` : '') +
        `<br>¿Quieres que le lleve un recado?`,
        { sugerencias: [`Dile a ${corto(p)} que…`, '¿Con quién me parezco?', 'Dame ideas'] });
    }
  }

  // ---- 7. Juegos ----------------------------------------------------------
  else if (RX.juego.test(t)) {
    const j = await juego(user, gente);
    r = salida(j.texto, j.espera ? { espera: j.espera } : {});
  }

  // ---- 8. Aprender sobre un tercero: "a Peter le gusta la guitarra" -------
  else if (RX.aprenderDe.test(t) && buscarPersona(t, gente, user.id)) {
    const p = buscarPersona(t, gente, user.id);
    const cosas = extraerCosas(t.replace(new RegExp(norm(corto(p)), 'i'), ''));
    const lista = cosas.length ? cosas : [t.replace(/.*\ble gusta\b/i, '').trim()].filter(x => x.length > 2);
    if (!lista.length) {
      r = salida(`Cuéntame qué le gusta a <b>${corto(p)}</b> y lo anoto 📝`);
    } else {
      for (const c of lista) await knn.aprender({ usuarioId: p.id, tipo: 'gusta', valor: c, origen: 'tercero', autorId: user.id });
      r = salida(`Anotado 📝 A <b>${corto(p)}</b> le gusta <b>${lista.join('</b>, <b>')}</b>. Esto le va a servir muchísimo a quien le toque regalarle 😉`);
    }
  }

  // ---- 9. "No me gusta…" --------------------------------------------------
  else if (RX.noQuiero.test(t)) {
    const cosas = extraerCosas(t);
    for (const c of cosas) await knn.aprender({ usuarioId: user.id, tipo: 'no_gusta', valor: c, origen: 'chat' });
    r = salida(cosas.length
      ? `Entendido, nada de <b>${cosas.join('</b>, <b>')}</b> ❌ Lo tacho de tu perfil para que no te lo regalen.`
      : '¿Qué es lo que no te gusta? Así evito recomendarlo.');
  }

  // ---- 10. "Quiero…" ------------------------------------------------------
  else if (RX.quiero.test(t)) {
    const cosas = extraerCosas(t);
    for (const c of cosas) await guardarDeseo(user.id, c);
    const mios = await deseosDe(user.id);
    r = salida(cosas.length
      ? `¡Anotado! 📝 Agregué <b>${cosas.join('</b>, <b>')}</b> a tu lista.<br>Ya llevas <b>${mios.length}</b> cosa(s). Solo lo ve quien te sacó 🔒`
      : '¿Qué te gustaría recibir? Dímelo y lo anoto en tu lista secreta.');
  }

  // ---- 11. Sobre MI amigo secreto (solo el propio) ------------------------
  else if ((RX.amigo.test(t) || RX.ideas.test(t)) && amigo) {
    const rec = await knn.recomendar(amigo.id, { n: 4 });
    const extra = await knn.loAprendido(amigo.id, 'gusta');
    r = salida(
      `Tu amigo secreto es <b>${corto(amigo)}</b> 🎁<br>` +
      (amigo.gustos ? `Le gusta: <b>${amigo.gustos}</b>.<br>` : '') +
      (extra.length ? `Además me contaron que <b>${extra.slice(0, 3).map(e => e.valor).join('</b>, <b>')}</b>.<br>` : '') +
      `<br><b>Mis recomendaciones</b> (calculadas con lo que sé de él y de quienes se le parecen):<br>` +
      rec.ideas.map(i => `🎁 <b>${i.idea}</b> <span class="porque">— ${i.porque}</span>`).join('<br>') +
      (rec.vecinos.length ? `<br><br><span class="porque">Comparé su perfil con ${rec.vecinos.map(v => v.nombre + ' (' + v.similitud + '%)').join(', ')}.</span>` : ''),
      { ideas: rec.ideas.map(i => i.idea), sugerencias: ['Otra idea', `¿Quién es ${corto(amigo)}?`, 'El monto'] });
  }

  // ---- 12. Ideas sin sorteo todavía ---------------------------------------
  else if (RX.ideas.test(t)) {
    if (faltan > 0) {
      const p = otros.length ? alAzar(otros) : null;
      r = salida(
        `El sorteo aún no sale (faltan <b>${faltan}</b> amigos) así que todavía no sé a quién le regalas 🎲<br>` +
        (p ? `Pero puedo irte entrenando: ${corto(p)} ${await retrato(p)}.<br>` : '') +
        `Cuéntame tú qué te gusta y así, cuando salga el sorteo, quien te saque la tendrá fácil.`,
        { sugerencias: ['Quiero pedir algo', '¿Quiénes están?', 'Juguemos algo'] });
    } else {
      r = salida('El sorteo está por salir 🎲 En cuanto salga te doy ideas hechas a medida para tu amigo secreto.');
    }
  }

  // ---- 13. Datos del evento ----------------------------------------------
  else if (RX.presupuesto.test(t)) {
    r = salida(`El monto acordado es <b>${ctx.monto || 'por definir'}</b> 💰 Con eso alcanza de sobra para algo bonito y pensado.`);
  } else if (RX.fecha.test(t)) {
    r = salida(`📅 El intercambio es el <b>${ctx.fecha || 'por definir'}</b>${ctx.lugar ? ` en <b>${ctx.lugar}</b>` : ''}. ¡No lo dejes para el último día!`);
  } else if (RX.reglas.test(t)) {
    r = salida(
      `Así funciona 🎄<br>` +
      `1. Cada quien crea su cuenta y llena sus gustos.<br>` +
      `2. Cuando estemos <b>${ctx.max || 8}</b>, el sorteo sale solo 🎲<br>` +
      `3. Solo tú ves a quién te tocó. <b>Nadie</b> ve el de los demás, ni yo lo cuento 🤐<br>` +
      `4. Monto: <b>${ctx.monto || 'por definir'}</b> · Fecha: <b>${ctx.fecha || 'por definir'}</b><br><br>` +
      `Yo mientras te doy ideas, te cuento del grupo y llevo recados 🧝`,
      { sugerencias: ['¿Quiénes están?', 'Dame ideas', 'Juguemos algo'] });
  }

  // ---- 14. "¿Qué sabes de mí?" -------------------------------------------
  else if (RX.verLista.test(t)) {
    const mios = await deseosDe(user.id);
    const ap = await knn.loAprendido(user.id);
    const gusta = ap.filter(a => a.tipo === 'gusta');
    const noGusta = ap.filter(a => a.tipo === 'no_gusta');
    r = salida(
      `Esto es lo que sé de ti 🧠<br>` +
      (mios.length ? `📋 Tu lista: <b>${mios.join('</b>, <b>')}</b><br>` : '📋 Tu lista está vacía.<br>') +
      (gusta.length ? `👍 Te gusta: <b>${gusta.slice(0, 6).map(a => a.valor).join('</b>, <b>')}</b><br>` : '') +
      (noGusta.length ? `👎 Evitar: <b>${noGusta.slice(0, 5).map(a => a.valor).join('</b>, <b>')}</b><br>` : '') +
      `<br>Todo esto lo ve <b>solo</b> quien te sacó en el sorteo 🔒`);
  }

  // ---- 15. Cortesías ------------------------------------------------------
  else if (RX.gracias.test(t)) {
    r = salida(alAzar(['¡Para eso estoy! 🧝 ¿Algo más?', '¡Un gusto! Si quieres te cuento algo del grupo 🎄', '😊 Cuando quieras. ¿Jugamos algo mientras esperamos?']));
  } else if (RX.saludo.test(t)) {
    r = salida(
      `¡Hola, <b>${corto(user)}</b>! 🧝 ` +
      (ctx.sorteoHecho && amigo ? `Ya salió el sorteo, ¿te doy ideas para tu amigo secreto?`
        : faltan > 0 ? `Vamos <b>${gente.length}</b> de <b>${ctx.max || 8}</b>, faltan ${faltan}. ¿Jugamos algo mientras?`
        : `Ya estamos completos, el sorteo está por salir 🎲`),
      { sugerencias: ctx.sorteoHecho ? ['Dame ideas', '¿Con quién me parezco?', 'Juguemos algo'] : ['¿Quiénes están?', 'Quiero pedir algo', 'Juguemos algo'] });
  }

  // ---- 16. No entendí: aprendo igual --------------------------------------
  else {
    const cosas = extraerCosas(t);
    if (cosas.length && t.length < 120) {
      for (const c of cosas) await knn.aprender({ usuarioId: user.id, tipo: 'gusta', valor: c, origen: 'chat' });
      r = salida(`Lo anoto 📝 (<b>${cosas.join('</b>, <b>')}</b>). Cuéntame más, así afino lo que te recomiendo.`);
    } else {
      r = salida(
        `No te entendí del todo 😅 Pero puedo:<br>` +
        `🎁 darte ideas de regalo · 🧮 decirte con quién te pareces · 👥 contarte del grupo · ` +
        `💌 llevar recados · 🎲 jugar contigo`,
        { sugerencias: ['Dame ideas', '¿Quiénes están?', '¿Con quién me parezco?', 'Juguemos algo'] });
    }
  }

  await guardarChat(user.id, 'bot', r.texto);
  return r;
}

module.exports = {
  responder, historial, guardarChat, guardarDeseo, deseosDe,
  dejarRecado, recadosDe, marcarRecadoEntregado, revelaSorteo,
  CATALOGO: knn.CATALOGO
};
