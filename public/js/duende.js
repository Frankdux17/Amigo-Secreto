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

  // ===== estado emocional del duende (lo decide el servidor, src/animo.js) =====
  // Se guarda aqui porque manda sobre tres cosas: la cara (data-animo), el
  // tono de la voz y si se pasea o se queda quietecito durmiendo.
  let humor = null;

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

  /**
   * El tono elegido por el usuario (Duende / Nino / Normal) es la base, y la
   * emocion lo modula: triste habla mas grave y lento, riendo mas agudo y
   * rapido. Se mezcla en vez de reemplazar para que la voz siga sonando a la
   * que la persona escogio.
   */
  function tonoConEmocion() {
    const base = TONOS[tonoActual] || TONOS.duende;
    if (!humor || !humor.tono) return base;
    const e = humor.tono;
    return {
      pitch: Math.max(0.6, Math.min(2, base.pitch * 0.62 + e.pitch * 0.38)),
      rate: Math.max(0.5, Math.min(1.6, base.rate * 0.62 + e.rate * 0.38)),
      etiqueta: base.etiqueta
    };
  }

  function procesarCola() {
    if (!sintesis || hablando || !cola.length) return;
    const t = cola.shift();
    const cfg = tonoConEmocion();
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
  // ==========================================================
  //  CONVERSACIÓN
  // ==========================================================
  let esperaActual = null;   // lo que el duende dejó pendiente (juego, recado…)

  function burbuja(rol, texto, esHtml) {
    const d = document.createElement('div');
    d.className = 'msj ' + rol;
    // el duende responde con HTML sencillo (<b>, <br>) que el servidor arma
    if (esHtml === false) d.textContent = texto; else d.innerHTML = texto;
    if (rol.indexOf('bot') === 0 && rol.indexOf('escribiendo') < 0) hablar(texto);
    msjs.appendChild(d);
    msjs.scrollTop = msjs.scrollHeight;
    return d;
  }

  /** Botones 👍/👎 bajo una tanda de ideas: así el duende aprende qué sirve. */
  function botonesIdea(ideas) {
    if (!ideas || !ideas.length || !estado || !estado.amigo) return;
    const caja = document.createElement('div');
    caja.className = 'idea-feedback';
    caja.innerHTML = '<span>¿Te sirven estas ideas?</span>';
    [['👍', true], ['👎', false]].forEach(([icono, gusta]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = icono;
      b.addEventListener('click', async () => {
        caja.innerHTML = gusta ? '<span>¡Gracias! Lo tengo en cuenta 🎄</span>' : '<span>Anotado, busco otro estilo 🔄</span>';
        for (const idea of ideas) {
          try {
            await fetch('/api/idea/feedback', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-csrf-token': window.CSRF },
              body: JSON.stringify({ idea: idea, para: estado.amigo.id, gusta: gusta, _csrf: window.CSRF })
            });
          } catch (e) { /* sin conexión: se pierde el voto, no pasa nada */ }
        }
        if (!gusta) setTimeout(() => enviar('otra idea'), 600);
      });
      caja.appendChild(b);
    });
    msjs.appendChild(caja);
    msjs.scrollTop = msjs.scrollHeight;
  }

  /** Chips de sugerencia. El servidor manda las suyas según la conversación. */
  function chips(lista) {
    const porDefecto = estado && estado.amigo
      ? ['🎁 Dame ideas', '💡 Dame un consejo', '👀 ¿Qué le gusta?', '🧮 ¿Con quién me parezco?', '🧠 Guarda esto de mí', '📖 Si alguien pregunta por mí…', '🎲 Juguemos algo', '💭 Cuéntame algo']
      : ['💡 Dame un consejo', '👥 ¿Quiénes están?', '✍️ Quiero pedir algo', '🧠 Guarda esto de mí', '📖 Si alguien pregunta por mí…', '🧮 ¿Con quién me parezco?', '🎲 Juguemos algo', '💭 Cuéntame algo'];
    const usar = (lista && lista.length) ? lista : porDefecto;

    sugerencias.innerHTML = '';
    usar.forEach(etiqueta => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = etiqueta;
      b.addEventListener('click', () => {
        // el texto que se envía es la etiqueta sin el emoji inicial
        const limpio = etiqueta.replace(/^[^\w¿¡]+/, '').trim();
        if (/^(quiero pedir algo|dile a .*|guarda esto de mí|si alguien pregunta por mí…?)$/i.test(limpio)) {
          const inicio = limpio.toLowerCase();
          input.value = inicio.indexOf('dile') === 0 ? limpio.replace(/…$/, ' ')
            : inicio.indexOf('guarda') === 0 ? 'guarda esto de mí: '
            : inicio.indexOf('si alguien') === 0 ? 'si alguien pregunta por mí dile que '
            : 'quiero ';
          input.focus();
          return;
        }
        enviar(limpio);
      });
      sugerencias.appendChild(b);
    });
  }

  function saludo() {
    if (saludado) return;
    saludado = true;
    const yo = estado ? nombreCorto(estado.yo) : '';
    burbuja('bot', `¡Hola${yo ? ', ' + escapar(yo) : ''}! 🧝 Soy el Duende Ayudante.`);

    if (estado && estado.amigo) {
      const n = nombreCorto(estado.amigo);
      let t = `Tu amigo secreto es <b>${escapar(estado.amigo.nombre)}</b> 🤫`;
      if (estado.amigo.gustos) t += `<br>A ${escapar(n)} le gusta: <b>${escapar(estado.amigo.gustos)}</b>.`;
      if (estado.amigo.deseos && estado.amigo.deseos.length) {
        t += `<br><br>Su lista de deseos:<br>${estado.amigo.deseos.map(d => '• ' + escapar(d)).join('<br>')}`;
      }
      t += '<br><br>Pídeme ideas cuando quieras 🎁';
      burbuja('bot', t);
    } else if (estado && !estado.sorteoHecho) {
      burbuja('bot', `Todavía no hay sorteo: faltan <b>${estado.cupo.faltan}</b> amigo(s) 🎲<br>` +
        `Mientras esperamos puedo contarte del grupo, llevarle un recado a alguien o jugar contigo. ` +
        `Y si me cuentas qué te gusta, lo anoto para quien te saque.`);
    }
    entregarRecados();
    chips();
  }

  /** El duende entrega los recados que otros le dejaron a este usuario. */
  function entregarRecados() {
    if (!estado || !estado.recados || !estado.recados.length) return;
    estado.recados.forEach((rec, i) => {
      setTimeout(() => {
        burbuja('bot', `💌 <b>${escapar(rec.de)}</b> me pidió que te dijera:<br>«${escapar(rec.texto)}»`);
        if (window.confetiNavidad) window.confetiNavidad(30);
        fetch('/api/recado/' + rec.id + '/visto', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-csrf-token': window.CSRF },
          body: JSON.stringify({ _csrf: window.CSRF })
        }).catch(() => {});
      }, 1200 + i * 2600);
    });
    estado.recados = [];
  }

  async function enviar(texto) {
    if (!texto || !texto.trim()) return;
    burbuja('user', texto, false);
    input.value = '';
    btnEnviar.disabled = true;
    const esperando = burbuja('bot escribiendo', 'El duende está pensando…', false);
    const enviandoEspera = esperaActual;
    esperaActual = null;
    try {
      const r = await fetch('/api/bot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': window.CSRF, accept: 'application/json' },
        body: JSON.stringify({ texto: texto, espera: enviandoEspera, _csrf: window.CSRF })
      });
      const d = await r.json();
      esperando.remove();
      if (d.error) { burbuja('bot', '⚠️ ' + escapar(d.error)); return; }
      // el animo se aplica ANTES de la burbuja, para que la frase salga ya con
      // la cara y el tono de voz que le corresponden
      if (d.animo) aplicarAnimo(d.animo);
      if (d.callar) silenciarVoz(true);
      if (d.hablar) silenciarVoz(false);
      burbuja('bot', d.reply);
      if (d.espera) esperaActual = d.espera;
      if (d.animacion === 'cosquillas') reir();
      if (d.animacion === 'volar') volar();
      if (d.ideas) botonesIdea(d.ideas);
      chips(d.sugerencias);
    } catch (e) {
      esperando.remove();
      burbuja('bot', '⚠️ No pude responder. Revisa tu conexión.');
    } finally {
      btnEnviar.disabled = false;
      input.focus();
    }
  }

  // ==========================================================
  //  HABLARLE AL DUENDE (reconocimiento de voz)
  // ==========================================================
  const Reconocimiento = window.SpeechRecognition || window.webkitSpeechRecognition || null;
  let oyendo = false;
  let reconocedor = null;
  const btnMic = $('#duende-mic');

  function prepararMicrofono() {
    if (!btnMic) return;
    if (!Reconocimiento) { btnMic.style.display = 'none'; return; }

    reconocedor = new Reconocimiento();
    reconocedor.lang = 'es-PE';
    reconocedor.interimResults = true;
    reconocedor.continuous = false;
    reconocedor.maxAlternatives = 1;

    reconocedor.onstart = () => {
      oyendo = true;
      btnMic.classList.add('oyendo');
      widget.classList.add('oyendo-mic');          // abre mas los ojos: esta atento
      input.placeholder = 'Te escucho…';
    };
    reconocedor.onresult = (ev) => {
      let texto = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) texto += ev.results[i][0].transcript;
      input.value = texto;
      // si el resultado ya es definitivo, se envía solo
      if (ev.results[ev.results.length - 1].isFinal && texto.trim()) {
        setTimeout(() => { if (input.value.trim()) enviar(input.value); }, 350);
      }
    };
    reconocedor.onerror = (ev) => {
      btnMic.classList.remove('oyendo');
      widget.classList.remove('oyendo-mic');
      oyendo = false;
      input.placeholder = 'Escribe aquí…';
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
        burbuja('bot', '🎤 No me diste permiso para el micrófono. Puedes activarlo en el candado de la barra de direcciones.');
      }
    };
    reconocedor.onend = () => {
      oyendo = false;
      btnMic.classList.remove('oyendo');
      widget.classList.remove('oyendo-mic');
      input.placeholder = 'Escribe aquí…';
    };

    btnMic.addEventListener('click', () => {
      if (!reconocedor) return;
      if (oyendo) { try { reconocedor.stop(); } catch (e) {} return; }
      callar();                       // que no se escuche a sí mismo
      try { reconocedor.start(); } catch (e) { /* ya estaba activo */ }
    });
  }

  // ==========================================================
  //  COSQUILLAS
  // ==========================================================
  let toques = 0;
  let relojToques = null;

  function reir() {
    widget.classList.add('riendo');
    if (window.confetiNavidad) window.confetiNavidad(40);
    setTimeout(() => widget.classList.remove('riendo'), 2200);
  }

  function cosquillas() {
    toques++;
    clearTimeout(relojToques);
    relojToques = setTimeout(() => { toques = 0; }, 1400);
    if (toques >= 3) {
      toques = 0;
      reir();
      desbloquear();
      hablar(['¡Jajaja, no me hagas cosquillas!', '¡Jijiji, basta, basta!', '¡Ay, me da risa!'][Math.floor(Math.random() * 3)]);
      if (!panel.classList.contains('abierto')) {
        decir('¡JAJAJA no las cosquillas! 🤣 Me rindo… pero igual no suelto el secreto 🤐', 4200);
      }
      return true;
    }
    return false;
  }

  // ==========================================================
  //  EL DUENDE SE PASEA POR LA PÁGINA
  // ==========================================================
  let paseo = null;
  const quietoPorPreferencia = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function pasear() {
    if (quietoPorPreferencia) return;
    if (panel.classList.contains('abierto')) return;      // no estorbar el chat
    if (document.hidden) return;
    if (humor && humor.dormido) return;                   // durmiendo no camina

    // el widget está anclado abajo a la derecha: los desplazamientos son
    // negativos para moverse hacia la izquierda y hacia arriba
    const maxX = Math.max(0, window.innerWidth - 150);
    const maxY = Math.max(0, window.innerHeight - 260);
    const x = -Math.round(Math.random() * maxX);
    const y = -Math.round(Math.random() * maxY * 0.65);
    const vuela = Math.random() < 0.4;

    // la direccion decide si el muneco se da la vuelta para mirar hacia donde
    // va; con las piernas moviendose, eso es lo que lo hace parecer caminar
    const xPrevio = parseFloat((widget.style.transform.match(/translate\((-?[\d.]+)px/) || [0, 0])[1]) || 0;
    widget.classList.toggle('mira-izq', x < xPrevio - 12);
    widget.classList.toggle('volando', vuela);
    widget.classList.toggle('caminando', !vuela);
    widget.classList.add('paseando');
    widget.style.transform = `translate(${x}px, ${y}px)`;

    // al llegar, a veces comenta algo
    setTimeout(() => {
      widget.classList.remove('volando');
      widget.classList.remove('caminando');
      if (Math.random() < 0.45 && !panel.classList.contains('abierto')) {
        const frases = avisos();
        if (frases.length) decir(frases[Math.floor(Math.random() * frases.length)], 6000);
      }
    }, 4200);
  }

  function volverASuSitio() {
    widget.style.transform = '';
    widget.classList.remove('volando', 'caminando', 'mira-izq');
  }

  /** Un vuelo corto: cuando sale a entregar un recado o cuando despierta. */
  function volar() {
    if (quietoPorPreferencia) return;
    widget.classList.add('volando');
    setTimeout(() => widget.classList.remove('volando'), 2600);
  }

  function arrancarPaseo() {
    if (quietoPorPreferencia) return;
    clearInterval(paseo);
    paseo = setInterval(() => {
      if (Math.random() < 0.3) volverASuSitio(); else pasear();
    }, 21000);
  }

  // ==========================================================
  //  APERTURA Y CIERRE
  // ==========================================================
  function abrir() {
    volverASuSitio();                 // que no quede a medio camino
    panel.classList.add('abierto');
    globo.classList.remove('ver');
    punto.classList.remove('ver');
    saludo();
    setTimeout(() => input.focus(), 220);
  }
  function cerrar() { panel.classList.remove('abierto'); }

  lanzador.addEventListener('click', () => {
    if (cosquillas()) return;         // tres toques seguidos = cosquillas
    panel.classList.contains('abierto') ? cerrar() : abrir();
  });
  $('#duende-cerrar').addEventListener('click', cerrar);
  form.addEventListener('submit', (e) => { e.preventDefault(); enviar(input.value); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') cerrar(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) volverASuSitio(); });
  window.addEventListener('resize', volverASuSitio);
  window.abrirDuende = (texto) => { abrir(); if (texto) setTimeout(() => enviar(texto), 420); };
  prepararMicrofono();

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

  // ==========================================================
  //  EMOCIONES, DESCANSO Y PUENTE CON vision.js
  // ==========================================================
  const humorCara = $('#duende-humor-cara');
  const humorTxt = $('#duende-humor-txt');
  const humorPila = $('#duende-humor-pila');

  function pintarHumor() {
    if (!humor) return;
    if (humorCara) humorCara.textContent = humor.emoji || '\u{1F9DD}';
    if (humorTxt) {
      humorTxt.textContent = humor.dormido ? 'durmiendo'
        : humor.callado ? (humor.etiqueta || 'tranquilo') + ' · sin voz'
        : (humor.etiqueta || 'en línea');
    }
    if (humorPila) humorPila.style.width = Math.round((humor.energia || 1) * 100) + '%';
  }

  /**
   * Aplica el estado emocional que llega del servidor: la cara (via el
   * atributo data-animo, que lee duende-animo.css), la voz y la conducta.
   */
  function aplicarAnimo(a) {
    if (!a || !a.estado) return;
    humor = a;
    widget.dataset.animo = a.estado;
    pintarHumor();
    // si le pidieron callarse, se respeta aunque el boton estuviera activo
    if (a.callado && vozActiva) silenciarVoz(true);
    if (a.dormido) { callar(); volverASuSitio(); }
  }

  /** Enciende o apaga la voz, dejando el boton y la preferencia al dia. */
  function silenciarVoz(mudo) {
    vozActiva = !mudo;
    guardarPref(VOZ_KEY, vozActiva ? '1' : '0');
    pintarBotonVoz();
    if (mudo) callar(); else desbloquear();
  }

  /** Botones de descanso del panel: dormir, despertar, callar, hablar. */
  async function ordenar(accion) {
    try {
      const r = await fetch('/api/duende/estado', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': window.CSRF },
        body: JSON.stringify({ accion: accion, _csrf: window.CSRF })
      });
      const d = await r.json();
      if (!d.ok) return;
      if (accion === 'callar') silenciarVoz(true);
      if (accion === 'hablar') silenciarVoz(false);
      aplicarAnimo(d.animo);
      const dicho = {
        dormir: 'Zzz… \u{1F634} me acurruco. Llámame cuando quieras.',
        despertar: '¡Aquí estoy! \u{1F9DD} Dormí rico.',
        callar: 'Listo, me callo \u{1F910} Sigo escribiendo.',
        hablar: '¡Ya puedo hablar otra vez! \u{1F50A}'
      }[accion];
      if (dicho) {
        if (panel.classList.contains('abierto')) burbuja('bot', dicho); else decir(dicho, 4200);
        if (accion === 'despertar') volar();
      }
    } catch (e) { /* sin conexion: no pasa nada */ }
  }

  document.querySelectorAll('[data-duende-accion]').forEach(b => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      ordenar(b.getAttribute('data-duende-accion'));
    });
  });

  /**
   * Puente que consume vision.js: le deja pintar la cara, sacar un globo,
   * hablar, reir y preguntar si conviene interrumpir.
   */
  window.Duende = {
    aplicarAnimo: aplicarAnimo,
    decir: decir,
    hablar: hablar,
    reir: reir,
    abierto: () => panel.classList.contains('abierto'),
    dormido: () => !!(humor && humor.dormido),
    humor: () => humor
  };

  // ==========================================================
  //  LO QUE EL DUENDE DICE POR SU CUENTA
  // ==========================================================
  // El servidor decide QUE decir (ahi estan la memoria, el perfil y lo que le
  // falta); aqui solo se decide CUANDO, que es cuestion de no molestar: nunca
  // con el chat abierto, nunca dormido y nunca pisando otro aviso.

  let ultimaNota = 0;

  function mostrarNota(nota) {
    if (!nota || !nota.texto) return false;
    if (panel.classList.contains('abierto')) return false;
    if (humor && humor.dormido) return false;
    ultimaNota = Date.now();
    globo.classList.add('es-nota');
    decir(nota.texto, 11000);
    setTimeout(() => globo.classList.remove('es-nota'), 11200);
    return true;
  }

  /** Le pregunta al duende si se le ocurre algo que decir. */
  async function pedirNota() {
    if (document.hidden) return;
    if (panel.classList.contains('abierto')) return;
    if (humor && humor.dormido) return;
    if (Date.now() - ultimaNota < 90000) return;      // como maximo cada minuto y medio
    try {
      const r = await fetch('/api/duende/nota', { headers: { accept: 'application/json' } });
      if (!r.ok) return;
      const d = await r.json();
      mostrarNota(d.nota);
    } catch (e) { /* sin red, el duende se calla */ }
  }

  // -------------------------------------------------- arranque
  fetch('/api/estado', { headers: { accept: 'application/json' } })
    .then(r => r.ok ? r.json() : null)
    .then(d => {
      if (!d) return;
      estado = d;
      // el duende aparece con la cara con la que se quedo la ultima vez
      if (estado.animo) aplicarAnimo(estado.animo);
      if (estado.animo && estado.animo.dormido) {
        setTimeout(() => decir('Zzz… 😴 tócame o dime <b>despierta</b>', 6000), 2000);
      }
      if (estado.amigo && !estado.visto) {
        setTimeout(() => mostrarSorpresa(estado.amigo), 850);
        punto.classList.add('ver');
      } else {
        rotarAvisos();
      }
      // hay recados esperando: que se note sin tener que abrir el chat
      if (estado.recados && estado.recados.length) {
        punto.classList.add('ver');
        setTimeout(() => decir(
          `💌 Tienes <b>${estado.recados.length}</b> recado(s) del grupo. ¡Ábreme y te los cuento!`, 9000), 2400);
      }
      arrancarPaseo();

      // y lo que se le ocurrio decirte al verte entrar: va despues de los
      // avisos del sistema para no atropellarlos
      if (estado.nota) {
        const espera = (estado.recados && estado.recados.length) ? 12000
          : (estado.amigo && !estado.visto) ? 9000 : 4200;
        setTimeout(() => mostrarNota(estado.nota), espera);
      }
      // cada tanto vuelve a pensar si tiene algo que decir
      setInterval(pedirNota, 150000);
    })
    .catch(() => {});
})();
