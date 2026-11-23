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

  const escapar = (s) => String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const nombreCorto = (u) => u ? (u.apodo || String(u.nombre).split(' ')[0]) : '';

  // ==========================================================
  //  VOZ DEL DUENDECITO (Web Speech API, sin dependencias)
  //
  //  Dos cosas que hacen fallar a la sintesis de voz en Chrome y que
  //  aqui estan resueltas:
  //   1. llamar a cancel() y a speak() seguidos deja la frase muda, asi
  //      que se usa una cola: se habla de una en una y solo se cancela
  //      cuando el usuario silencia o cambia de voz;
  //   2. el navegador no deja sonar nada hasta que el usuario interactua,
  //      asi que la primera frase queda pendiente y suena con el primer clic.
  //
  //  Las voces instaladas cambian de un equipo a otro: se elige la de mejor
  //  calidad disponible y el usuario puede probar otras desde el engranaje.
  // ==========================================================
  const VOZ_KEY = 'duende-voz';
  const VOZ_NOMBRE_KEY = 'duende-voz-nombre';
  const VOZ_TONO_KEY = 'duende-voz-tono';

  const TONOS = {
    duende: { pitch: 1.45, rate: 1.06, etiqueta: 'Duende' },
    nino:   { pitch: 1.65, rate: 0.98, etiqueta: 'Niño' },
    normal: { pitch: 1.10, rate: 1.00, etiqueta: 'Normal' }
  };

  const sintesis = window.speechSynthesis || null;
  let vozActiva = true;
  let vozElegida = null;
  let tonoActual = 'duende';
  let desbloqueada = false;
  let pendiente = null;

  // cola de frases: evita el bug de cancel()+speak()
  let cola = [];
  let hablando = false;
  let guardaTiempo = null;

  const leerPref = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } };
  const guardarPref = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* incógnito */ } };

  // se declaran aquí porque elegirVoz() los usa apenas arranca el script
  const selVoz = $('#voz-select');
  const barraVoz = $('#voz-barra');
  const estadoVoz = $('#voz-estado');

  vozActiva = leerPref(VOZ_KEY, '1') !== '0';
  tonoActual = TONOS[leerPref(VOZ_TONO_KEY, 'duende')] ? leerPref(VOZ_TONO_KEY, 'duende') : 'duende';

  function vocesDisponibles() {
    if (!sintesis) return [];
    const todas = sintesis.getVoices() || [];
    const es = todas.filter(v => /^es/i.test(v.lang));
    return es.length ? es : todas;
  }

  // puntaje: cuanto más alto, mejor suena para un duende en español
  function puntuar(v) {
    let p = 0;
    const n = (v.name || '').toLowerCase();
    if (/google/.test(n)) p += 100;                      // claramente las mejores
    if (/natural|neural|online|premium/.test(n)) p += 80;
    if (/sabina|paulina|helena|laura|elena|lucia|mónica|monica/.test(n)) p += 30;
    if (/es-(mx|us|pe|co|ar|cl)/i.test(v.lang)) p += 20;  // español latino
    if (/^es/i.test(v.lang)) p += 10;
    if (/desktop/.test(n)) p -= 25;                      // las viejas de Windows suenan metálicas
    return p;
  }

  function elegirVoz() {
    if (!sintesis) return;
    const lista = vocesDisponibles();
    if (!lista.length) { pintarEstadoVoz(0); return; }
    const guardada = leerPref(VOZ_NOMBRE_KEY, '');
    const match = guardada && lista.find(v => v.name === guardada);
    vozElegida = match || lista.slice().sort((a, b) => puntuar(b) - puntuar(a))[0] || null;
    pintarSelector(lista);
    pintarEstadoVoz(lista.length);
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
      .replace(/\s*\n\s*/g, '. ')
      .replace(/\.\s*\./g, '.')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function hablar(texto, maximo) {
    if (!sintesis || !vozActiva) return;
    let t = limpiarParaVoz(texto);
    if (!t) return;
    // Chrome corta las frases largas alrededor de los 15 s
    const tope = maximo || 180;
    if (t.length > tope) {
      const corte = t.lastIndexOf('.', tope);
      t = t.slice(0, corte > 60 ? corte + 1 : tope);
    }
    if (!desbloqueada) { pendiente = t; return; }
    cola = cola.slice(-1);   // como mucho una frase esperando
    cola.push(t);
    procesarCola();
  }

  function procesarCola() {
    if (!sintesis || hablando || !cola.length) return;
    const t = cola.shift();
    const cfg = TONOS[tonoActual] || TONOS.duende;
    let u;
    try { u = new SpeechSynthesisUtterance(t); } catch (e) { return; }
    if (vozElegida) { u.voice = vozElegida; u.lang = vozElegida.lang; }
    else u.lang = 'es-ES';
    u.pitch = cfg.pitch;
    u.rate = cfg.rate;
    u.volume = 1;

    const terminar = () => {
      clearTimeout(guardaTiempo);
      hablando = false;
      widget.classList.remove('hablando');
      setTimeout(procesarCola, 140);
    };
    u.onstart = () => widget.classList.add('hablando');
    u.onend = terminar;
    u.onerror = terminar;

    hablando = true;
    try { sintesis.speak(u); } catch (e) { terminar(); return; }
    // por si onend nunca llega (pasa en algunos navegadores)
    guardaTiempo = setTimeout(terminar, Math.max(6000, t.length * 110));
  }

  function callar() {
    cola = [];
    hablando = false;
    clearTimeout(guardaTiempo);
    try { if (sintesis) sintesis.cancel(); } catch (e) { /* nada */ }
    widget.classList.remove('hablando');
  }

  // el primer clic/tecla del usuario habilita el audio
  function desbloquear() {
    if (desbloqueada) return;
    desbloqueada = true;
    if (pendiente) { const t = pendiente; pendiente = null; hablar(t); }
  }
  ['pointerdown', 'keydown', 'touchstart'].forEach(ev =>
    document.addEventListener(ev, desbloquear, { once: true, passive: true }));

  // ---------------------------------------- controles de voz

  function pintarEstadoVoz(n) {
    if (!estadoVoz) return;
    if (!sintesis) {
      estadoVoz.textContent = 'Este navegador no puede hablar. Prueba con Chrome o Edge.';
      estadoVoz.className = 'voz-estado malo';
    } else if (!n) {
      estadoVoz.textContent = 'No se detectaron voces instaladas en este equipo.';
      estadoVoz.className = 'voz-estado malo';
    } else {
      estadoVoz.textContent = n + (n === 1 ? ' voz detectada' : ' voces detectadas') +
        (vozElegida ? ' · usando: ' + vozElegida.name.replace(/microsoft |desktop/gi, '').trim() : '');
      estadoVoz.className = 'voz-estado';
    }
  }

  function pintarSelector(lista) {
    if (!selVoz) return;
    const actual = vozElegida ? vozElegida.name : '';
    if (selVoz.dataset.n === String((lista || []).length) && selVoz.value === actual) return;
    selVoz.innerHTML = '';
    (lista || vocesDisponibles()).forEach(v => {
      const o = document.createElement('option');
      o.value = v.name;
      o.textContent = v.name.replace(/microsoft |desktop|online \(natural\) ?/gi, '').trim() + ' · ' + v.lang;
      if (vozElegida && v.name === vozElegida.name) o.selected = true;
      selVoz.appendChild(o);
    });
    selVoz.dataset.n = String((lista || vocesDisponibles()).length);
  }

  function pintarTonos() {
    document.querySelectorAll('[data-tono]').forEach(b =>
      b.classList.toggle('activo', b.dataset.tono === tonoActual));
  }

  function probarVoz(frase) {
    if (!vozActiva) {
      vozActiva = true;
      guardarPref(VOZ_KEY, '1');
      pintarBotonVoz();
    }
    desbloquear();
    callar();
    hablar(frase || '¡Hola! Soy el duendecito de la Navidad. ¿Me escuchas bien?');
  }

  if (selVoz) {
    selVoz.addEventListener('change', () => {
      const lista = vocesDisponibles();
      vozElegida = lista.find(v => v.name === selVoz.value) || vozElegida;
      guardarPref(VOZ_NOMBRE_KEY, selVoz.value);
      pintarEstadoVoz(lista.length);
      probarVoz('Hola, soy el duendecito. ¿Te gusta más así?');
    });
  }

  document.querySelectorAll('[data-tono]').forEach(b => {
    b.addEventListener('click', () => {
      tonoActual = b.dataset.tono;
      guardarPref(VOZ_TONO_KEY, tonoActual);
      pintarTonos();
      probarVoz('Así sueno con el tono ' + (TONOS[tonoActual] || {}).etiqueta + '.');
    });
  });

  const btnProbar = $('#voz-probar');
  if (btnProbar) btnProbar.addEventListener('click', () => probarVoz());

  const btnAjustes = $('#voz-ajustes');
  if (btnAjustes && barraVoz) {
    btnAjustes.addEventListener('click', () => {
      barraVoz.classList.toggle('abierta');
      if (barraVoz.classList.contains('abierta')) { elegirVoz(); pintarTonos(); }
    });
  }

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
      guardarPref(VOZ_KEY, vozActiva ? '1' : '0');
      pintarBotonVoz();
      if (vozActiva) { desbloquear(); hablar('¡Hola! Ya puedes oírme otra vez.'); }
      else callar();
    });
  }
  pintarTonos();
  pintarEstadoVoz(vocesDisponibles().length);

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
