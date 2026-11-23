/* ==========================================================
   Duende Ayudante — asistente flotante animado
   - avisa automáticamente el resultado del sorteo
   - cuenta los gustos del amigo secreto cuando ya los llenó
   - chat de ideas de regalo en cualquier página
   ========================================================== */
(function () {
  'use strict';
  if (!window.HAY_SESION) return;

  const $ = (s) => document.querySelector(s);
  const reducido = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const widget = $('#duende-widget');
  if (!widget) return;

  const lanzador = $('#duende-lanzador');
  const panel = $('#duende-panel');
  const msjs = $('#duende-msjs');
  const form = $('#duende-form');
  const input = $('#duende-input');
  const btnEnviar = $('#duende-enviar');
  const sugerencias = $('#duende-sugerencias');
  const globo = $('#duende-globo');
  const globoTxt = $('#duende-globo-txt');
  const punto = $('#duende-punto');

  let estado = null;
  let saludado = false;
  let rotador = null;

  // ==========================================================
  //  VOZ DEL DUENDECITO (Web Speech API, sin dependencias)
  //  Tono agudo y ritmo vivo para que suene a duende chiquito.
  // ==========================================================
  const VOZ_KEY = 'duende-voz';
  const sintesis = window.speechSynthesis || null;
  let vozActiva = true;
  let vozElegida = null;
  let desbloqueada = false;   // los navegadores exigen un gesto del usuario
  let pendiente = null;

  try { vozActiva = localStorage.getItem(VOZ_KEY) !== '0'; } catch (e) { /* modo incógnito */ }

  function elegirVoz() {
    if (!sintesis) return;
    const voces = sintesis.getVoices() || [];
    const es = voces.filter(v => /^es/i.test(v.lang));
    // preferimos español latino y voces femeninas: suenan más a duendecito
    vozElegida =
      es.find(v => /mx|pe|co|ar|cl|us/i.test(v.lang) && /female|mujer|sabina|paulina|helena/i.test(v.name)) ||
      es.find(v => /mx|pe|co|ar|cl|us/i.test(v.lang)) ||
      es.find(v => /female|mujer|helena|laura|monica/i.test(v.name)) ||
      es[0] || null;
  }
  if (sintesis) {
    elegirVoz();
    sintesis.addEventListener('voiceschanged', elegirVoz);
  }

  // quita etiquetas, emojis y viñetas: solo se lee el texto
  function limpiarParaVoz(t) {
    return String(t)
      .replace(/<br\s*\/?>/gi, '. ')
      .replace(/<[^>]*>/g, ' ')
      .replace(/[\u{1F000}-\u{1FAFF}\u{2190}-\u{27BF}\u{FE0F}\u{2B00}-\u{2BFF}]/gu, '')
      .replace(/[*_`#•·→➜]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function hablar(texto, maximo) {
    if (!sintesis || !vozActiva) return;
    let t = limpiarParaVoz(texto);
    if (!t) return;
    const tope = maximo || 230;
    if (t.length > tope) {
      const corte = t.lastIndexOf('.', tope);
      t = t.slice(0, corte > 60 ? corte + 1 : tope);
    }
    if (!desbloqueada) { pendiente = t; return; }
    try {
      sintesis.cancel();
      const u = new SpeechSynthesisUtterance(t);
      if (vozElegida) u.voice = vozElegida;
      u.lang = (vozElegida && vozElegida.lang) || 'es-ES';
      u.pitch = 1.9;   // agudo = duendecito
      u.rate = 1.08;   // un poquito acelerado, travieso
      u.volume = 0.95;
      u.onstart = () => widget.classList.add('hablando');
      u.onend = u.onerror = () => widget.classList.remove('hablando');
      sintesis.speak(u);
    } catch (e) { /* si el navegador no deja, no pasa nada */ }
  }

  // el primer clic/tecla del usuario habilita el audio
  function desbloquear() {
    if (desbloqueada) return;
    desbloqueada = true;
    if (pendiente) { const t = pendiente; pendiente = null; hablar(t); }
  }
  ['pointerdown', 'keydown', 'touchstart'].forEach(ev =>
    document.addEventListener(ev, desbloquear, { once: true, passive: true }));

  function pintarBotonVoz() {
    const b = $('#duende-voz');
    if (!b) return;
    b.textContent = vozActiva ? '🔊' : '🔇';
    b.title = vozActiva ? 'Silenciar al duende' : 'Activar la voz del duende';
    b.setAttribute('aria-label', b.title);
    b.classList.toggle('mudo', !vozActiva);
  }

  const btnVoz = $('#duende-voz');
  if (btnVoz) {
    if (!sintesis) btnVoz.style.display = 'none';
    pintarBotonVoz();
    btnVoz.addEventListener('click', (e) => {
      e.stopPropagation();
      vozActiva = !vozActiva;
      try { localStorage.setItem(VOZ_KEY, vozActiva ? '1' : '0'); } catch (err) { /* nada */ }
      pintarBotonVoz();
      if (vozActiva) { desbloquear(); hablar('¡Hola! Ya puedes oírme otra vez.'); }
      else if (sintesis) { sintesis.cancel(); widget.classList.remove('hablando'); }
    });
  }

  const escapar = (s) => String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const nombreCorto = (u) => u ? (u.apodo || String(u.nombre).split(' ')[0]) : '';

  // -------------------------------------------------- globo de avisos
  let globoTimer = null;
  function decir(html, ms) {
    if (panel.classList.contains('abierto')) return; // no estorbar el chat abierto
    globoTxt.innerHTML = html;
    globo.classList.add('ver');
    clearTimeout(globoTimer);
    globoTimer = setTimeout(() => globo.classList.remove('ver'), ms || 9000);
    hablar(html, 150);
  }
  $('#duende-globo-x').addEventListener('click', (e) => {
    e.stopPropagation();
    globo.classList.remove('ver');
    clearInterval(rotador);
  });
  globo.addEventListener('click', () => abrir());

  // Mensajes proactivos según el momento del intercambio
  function avisos() {
    const a = [];
    if (!estado) return a;
    const c = estado.cupo || {};

    if (estado.yo.rol === 'admin') {
      a.push('Hola jefe 👋 Desde <b>Admin</b> puedes cambiar el monto, la fecha y las credenciales de quien lo pida.');
      a.push(`Van <b>${c.total}/${c.max}</b> participantes registrados.`);
      return a;
    }

    if (!estado.sorteoHecho) {
      a.push(`Faltan <b>${c.faltan}</b> amigo(s) para que el sorteo se haga solo 🎄`);
      a.push('¿Ya me contaste qué te gustaría recibir? Escribe <b>"quiero ..."</b> y lo anoto.');
      a.push('Mientras más completo tu perfil, mejor será tu regalo 😉');
      return a;
    }

    if (estado.amigo) {
      const n = nombreCorto(estado.amigo);
      if (estado.amigo.gustos) {
        a.push(`A <b>${escapar(n)}</b> le gusta: <b>${escapar(estado.amigo.gustos)}</b> 🎁 ¿Te doy ideas?`);
      }
      if (estado.amigo.deseos && estado.amigo.deseos.length) {
        a.push(`${escapar(n)} ya llenó su lista de deseos: <b>${escapar(estado.amigo.deseos[0])}</b>, entre otros 👀`);
      }
      if (estado.amigo.talla_ropa) {
        a.push(`Dato útil: ${escapar(n)} usa talla <b>${escapar(estado.amigo.talla_ropa)}</b> y zapato <b>${escapar(estado.amigo.talla_zapato)}</b>.`);
      }
      if (estado.amigo.no_gustos) {
        a.push(`⚠️ Ojo: a ${escapar(n)} <b>no</b> le gusta ${escapar(estado.amigo.no_gustos)}.`);
      }
      a.push(`El monto acordado es <b>${escapar(estado.evento.monto)}</b> y el intercambio es el <b>${escapar(estado.evento.fecha)}</b>.`);
    }
    return a;
  }

  function rotarAvisos() {
    const lista = avisos();
    if (!lista.length || reducido) return;
    let i = 0;
    setTimeout(() => decir(lista[i++ % lista.length]), 2600);
    rotador = setInterval(() => {
      if (panel.classList.contains('abierto')) return;
      decir(lista[i++ % lista.length]);
    }, 26000);
  }

  // -------------------------------------------------- panel de chat
  function burbuja(rol, texto, esHtml) {
    const d = document.createElement('div');
    d.className = 'msj ' + rol;
    if (esHtml) d.innerHTML = texto; else d.textContent = texto;
    if (rol.indexOf('bot') === 0 && rol.indexOf('escribiendo') < 0) hablar(texto);
    msjs.appendChild(d);
    msjs.scrollTop = msjs.scrollHeight;
    return d;
  }

  function chips() {
    const lista = estado && estado.amigo
      ? [['🎁 ¿Qué le regalo?', '¿Qué le regalo a mi amigo secreto?'],
         ['👀 ¿Qué le gusta?', '¿Qué le gusta a mi amigo secreto?'],
         ['✍️ Quiero pedir algo', 'quiero '],
         ['📜 Mi lista', 'mi lista'],
         ['💰 El monto', '¿cuánto es el monto?']]
      : [['✍️ Quiero pedir algo', 'quiero '],
         ['📜 Mi lista', 'mi lista'],
         ['❓ Cómo funciona', '¿cómo funciona el sorteo?'],
         ['💰 El monto', '¿cuánto es el monto?'],
         ['🗓️ ¿Cuándo es?', '¿cuándo es el intercambio?']];

    sugerencias.innerHTML = '';
    lista.forEach(([etiqueta, texto]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = etiqueta;
      b.addEventListener('click', () => {
        if (texto.trim().endsWith('quiero')) { input.value = 'quiero '; input.focus(); return; }
        enviar(texto);
      });
      sugerencias.appendChild(b);
    });
  }

  function saludo() {
    if (saludado) return;
    saludado = true;
    const yo = estado ? nombreCorto(estado.yo) : '';
    burbuja('bot', `¡Hola${yo ? ', ' + yo : ''}! 🧝 Soy el Duende Ayudante.`);
    if (estado && estado.amigo) {
      const n = nombreCorto(estado.amigo);
      let t = `Tu amigo secreto es <b>${escapar(estado.amigo.nombre)}</b> 🤫`;
      if (estado.amigo.gustos) t += `\nA ${escapar(n)} le gusta: <b>${escapar(estado.amigo.gustos)}</b>.`;
      if (estado.amigo.deseos && estado.amigo.deseos.length) {
        t += `\n\nSu lista de deseos:\n${estado.amigo.deseos.map(d => '• ' + escapar(d)).join('\n')}`;
      }
      t += '\n\nPídeme ideas cuando quieras 🎁';
      burbuja('bot', t, true);
    } else if (estado && !estado.sorteoHecho) {
      burbuja('bot', `Todavía no hay sorteo: faltan ${estado.cupo.faltan} amigo(s). Mientras tanto cuéntame qué te gustaría recibir y lo anoto en tu lista.`);
    }
    chips();
  }

  async function enviar(texto) {
    if (!texto || !texto.trim()) return;
    burbuja('user', texto);
    input.value = '';
    btnEnviar.disabled = true;
    const esperando = burbuja('bot escribiendo', 'El duende está pensando…');
    try {
      const r = await fetch('/api/bot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': window.CSRF, accept: 'application/json' },
        body: JSON.stringify({ texto: texto, _csrf: window.CSRF })
      });
      const d = await r.json();
      esperando.remove();
      if (d.error) { burbuja('bot', '⚠️ ' + d.error); return; }
      burbuja('bot', d.reply);
      if (d.aprendido && d.aprendido.length && window.confetiNavidad) window.confetiNavidad(50);
    } catch (e) {
      esperando.remove();
      burbuja('bot', '⚠️ No pude responder. Revisa tu conexión.');
    } finally {
      btnEnviar.disabled = false;
      input.focus();
    }
  }

  function abrir() {
    panel.classList.add('abierto');
    globo.classList.remove('ver');
    punto.classList.remove('ver');
    saludo();
    setTimeout(() => input.focus(), 220);
  }
  function cerrar() { panel.classList.remove('abierto'); }

  lanzador.addEventListener('click', () => panel.classList.contains('abierto') ? cerrar() : abrir());
  $('#duende-cerrar').addEventListener('click', cerrar);
  form.addEventListener('submit', (e) => { e.preventDefault(); enviar(input.value); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') cerrar(); });
  window.abrirDuende = (texto) => { abrir(); if (texto) setTimeout(() => enviar(texto), 420); };

  // -------------------------------------------------- aviso del sorteo
  const sorpresa = $('#sorpresa');

  function mostrarSorpresa(amigo) {
    const av = $('#sorpresa-avatar');
    av.innerHTML = amigo.foto
      ? `<img src="${amigo.foto}" alt="${escapar(amigo.nombre)}">`
      : escapar(String(amigo.nombre).charAt(0).toUpperCase());
    $('#sorpresa-nombre').textContent = amigo.nombre;
    $('#sorpresa-alias').textContent = amigo.apodo ? `"${amigo.apodo}"` : '';

    const partes = [];
    if (amigo.gustos) partes.push(`<b>Le gusta:</b> ${escapar(amigo.gustos)}`);
    if (amigo.deseos && amigo.deseos.length) partes.push(`<b>Quiere:</b> ${escapar(amigo.deseos.slice(0, 3).join(' · '))}`);
    if (amigo.talla_ropa) partes.push(`<b>Tallas:</b> ropa ${escapar(amigo.talla_ropa)} · zapato ${escapar(amigo.talla_zapato)}`);
    $('#sorpresa-gustos').innerHTML = partes.join('<br>') ||
      'Todavía no llenó sus gustos. El duende te avisará apenas lo haga 😉';

    $('#sorpresa-perfil').href = '/participante/' + amigo.id;
    sorpresa.classList.add('ver');
    hablar('¡Ya salió el sorteo! Tu amigo secreto es ' + amigo.nombre + '. ' + (amigo.gustos ? 'Le gusta ' + amigo.gustos + '.' : ''), 200);
    if (window.confetiNavidad) window.confetiNavidad(190);

    // marca como visto en el servidor
    fetch('/revelar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': window.CSRF, accept: 'application/json' },
      body: JSON.stringify({ _csrf: window.CSRF })
    }).catch(() => {});
  }

  function cerrarSorpresa() {
    sorpresa.classList.remove('ver');
    setTimeout(() => decir('Cuando quieras ideas para tu regalo, aquí estoy 🎁'), 900);
  }
  $('#sorpresa-x').addEventListener('click', cerrarSorpresa);
  sorpresa.addEventListener('click', (e) => { if (e.target === sorpresa) cerrarSorpresa(); });
  $('#sorpresa-ideas').addEventListener('click', () => {
    cerrarSorpresa();
    window.abrirDuende('¿Qué le regalo a mi amigo secreto?');
  });

  // -------------------------------------------------- arranque
  fetch('/api/estado', { headers: { accept: 'application/json' } })
    .then(r => r.ok ? r.json() : null)
    .then(d => {
      if (!d) return;
      estado = d;
      if (estado.amigo && !estado.visto) {
        setTimeout(() => mostrarSorpresa(estado.amigo), 850);
        punto.classList.add('ver');
      } else {
        rotarAvisos();
      }
    })
    .catch(() => {});
})();
