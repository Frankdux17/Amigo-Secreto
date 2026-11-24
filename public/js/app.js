/* ==========================================================
   Amigo Secreto Navidad — interacciones del cliente
   ========================================================== */
(function () {
  'use strict';

  const $ = (s, c) => (c || document).querySelector(s);
  const $$ = (s, c) => Array.from((c || document).querySelectorAll(s));
  const reducido = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------------------------------------------------------
  // 1. Nieve
  // ---------------------------------------------------------
  (function nieve() {
    const cv = $('#nieve');
    if (!cv || reducido) return;
    const ctx = cv.getContext('2d');
    let w, h, copos;

    function medir() {
      w = cv.width = window.innerWidth;
      h = cv.height = window.innerHeight;
      const n = Math.min(110, Math.round(w / 14));
      copos = Array.from({ length: n }, () => nuevo(Math.random() * h));
    }
    function nuevo(y) {
      return {
        x: Math.random() * w, y: y,
        r: Math.random() * 2.6 + 0.8,
        v: Math.random() * 0.75 + 0.35,
        o: Math.random() * 0.5 + 0.35,
        d: Math.random() * Math.PI * 2
      };
    }
    function pinta() {
      ctx.clearRect(0, 0, w, h);
      for (const c of copos) {
        c.y += c.v;
        c.d += 0.012;
        c.x += Math.sin(c.d) * 0.55;
        if (c.y > h + 6) Object.assign(c, nuevo(-8));
        ctx.globalAlpha = c.o;
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      requestAnimationFrame(pinta);
    }
    medir();
    window.addEventListener('resize', medir);
    pinta();
  })();

  // ---------------------------------------------------------
  // 2. Confeti
  // ---------------------------------------------------------
  function confeti(cantidad) {
    if (reducido) return;
    const capa = document.createElement('div');
    capa.className = 'confeti';
    document.body.appendChild(capa);
    const colores = ['#e63946', '#f4c44b', '#37c173', '#ffffff', '#ff5a67', '#ffe08a'];
    for (let i = 0; i < (cantidad || 110); i++) {
      const p = document.createElement('i');
      p.style.left = Math.random() * 100 + 'vw';
      p.style.top = -20 - Math.random() * 120 + 'px';
      p.style.background = colores[(Math.random() * colores.length) | 0];
      p.style.animationDuration = (2.4 + Math.random() * 2.2) + 's';
      p.style.animationDelay = (Math.random() * 0.7) + 's';
      capa.appendChild(p);
    }
    setTimeout(() => capa.remove(), 6200);
  }
  window.confetiNavidad = confeti;

  // ---------------------------------------------------------
  // 3. Papá Noel / duende paseando las fotos
  // ---------------------------------------------------------
  (function desfile() {
    const cam = $('#caminante');
    if (!cam || reducido) return;

    let lista = [];
    try { lista = JSON.parse($('#datos-caminata').textContent) || []; } catch (e) { lista = []; }

    const frases = [
      'Mira qué linda foto 📸',
      '¡Ho ho ho! 🎅',
      'Ya tengo su regalo 🤫',
      '¿Y tu lista de deseos? 🎁',
      'Falta poco para Navidad ❄️',
      'Este sí se portó bien 😇',
      'El duende tiene ideas para ti 🧝',
      'Anota tus deseos en el chat 💬'
    ];
    const figuras = ['🎅', '🧝', '🤶', '🦌', '⛄'];

    const marco = $('#marco-foto');
    const vacia = $('#foto-vacia');
    const nombre = $('#trineo-nombre');
    const globo = $('#globo-caminante');
    const personaje = $('#personaje');
    let i = 0;

    function vuelta() {
      const ancho = window.innerWidth;
      const persona = lista.length ? lista[i % lista.length] : null;
      i++;

      personaje.textContent = figuras[(Math.random() * figuras.length) | 0];

      marco.innerHTML = '';
      if (persona && persona.f) {
        const img = document.createElement('img');
        img.src = persona.f;
        img.alt = '';
        marco.appendChild(img);
      } else {
        marco.textContent = persona ? (persona.n || '🎁').charAt(0).toUpperCase() : '🎁';
      }
      nombre.textContent = persona ? persona.n : 'Amigo Secreto';
      nombre.style.display = persona ? '' : 'none';

      globo.textContent = frases[(Math.random() * frases.length) | 0];
      const dur = Math.max(16000, (ancho + 460) * 13);

      cam.style.transition = 'none';
      cam.style.transform = 'translateX(0)';
      void cam.offsetWidth;
      cam.style.transition = `transform ${dur}ms linear`;
      cam.style.transform = `translateX(${ancho + 320}px)`;

      // El personaje arranca fuera de la pantalla (left:-220px). Si el globo se
      // mostraba al segundo, aparecia a medias por el borde izquierdo. Se
      // muestra cuando ya entro del todo y se oculta antes de salir por la
      // derecha, de modo que el mensaje siempre se lee completo.
      setTimeout(() => globo.classList.add('ver'), dur * 0.22);
      setTimeout(() => globo.classList.remove('ver'), dur * 0.66);
      setTimeout(vuelta, dur + 2600);
    }
    setTimeout(vuelta, 1400);
    if (vacia) vacia.remove();
  })();

  // ---------------------------------------------------------
  // 4. Caja de regalo: revelar amigo secreto
  // ---------------------------------------------------------
  (function revelar() {
    const caja = $('#caja-regalo');
    if (!caja) return;
    const panel = $('#revelacion');
    let abierto = false;

    caja.addEventListener('click', async () => {
      if (abierto) return;
      abierto = true;
      caja.classList.add('abierta');
      try {
        const r = await fetch('/revelar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-csrf-token': window.CSRF, accept: 'application/json' },
          body: JSON.stringify({ _csrf: window.CSRF })
        });
        const d = await r.json();
        if (!d.ok) throw new Error(d.error || 'error');
        pintarAmigo(d.amigo);
        setTimeout(() => { panel.classList.add('visible'); confeti(150); }, 480);
        // seguro: si el navegador pausa la animación, la tarjeta igual queda visible
        setTimeout(() => { panel.style.opacity = '1'; panel.style.transform = 'none'; }, 1600);
      } catch (e) {
        abierto = false;
        caja.classList.remove('abierta');
        alert('No se pudo abrir el regalo. Recarga la página e inténtalo otra vez.');
      }
    });

    function pintarAmigo(a) {
      $('#rev-nombre').textContent = a.nombre;
      const alias = $('#rev-alias');
      alias.textContent = a.apodo ? `"${a.apodo}"` : '';
      const av = $('#rev-avatar');
      av.innerHTML = a.foto
        ? `<img src="${a.foto}" alt="${a.nombre}">`
        : a.nombre.charAt(0).toUpperCase();
      $('#rev-gustos').textContent = a.gustos || '—';
      $('#rev-hobbies').textContent = a.hobbies || '—';
      $('#rev-color').textContent = a.color_favorito || '—';
      $('#rev-tallas').textContent = `Ropa ${a.talla_ropa} · Zapato ${a.talla_zapato}`;
      const ul = $('#rev-deseos');
      ul.innerHTML = (a.deseos || []).map(d => `<li>${escapar(d)}</li>`).join('') || '<li>Sin deseos registrados</li>';
      const no = $('#rev-nogustos');
      if (a.no_gustos) { no.textContent = `⚠️ No le gusta: ${a.no_gustos}`; no.style.display = ''; }
      $('#rev-link').href = '/participante/' + a.id;
      $('#rev-bot').href = '/bot';
    }
  })();

  function escapar(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---------------------------------------------------------
  // 5. Foto: previsualizar y comprimir antes de enviar
  // ---------------------------------------------------------
  $$('[data-foto]').forEach(bloque => {
    const file = $('input[type=file]', bloque);
    const hidden = $('input[type=hidden].foto-datos', bloque);
    const vista = $('.avatar', bloque);
    const info = $('.foto-info', bloque);
    if (!file || !hidden) return;

    file.addEventListener('change', () => {
      const f = file.files && file.files[0];
      if (!f) return;
      if (!/^image\//.test(f.type)) { alert('Selecciona un archivo de imagen.'); return; }
      const fr = new FileReader();
      fr.onload = () => {
        const img = new Image();
        img.onload = () => {
          const LADO = 420;
          const cv = document.createElement('canvas');
          const min = Math.min(img.width, img.height);
          cv.width = cv.height = LADO;
          const ctx = cv.getContext('2d');
          ctx.drawImage(img, (img.width - min) / 2, (img.height - min) / 2, min, min, 0, 0, LADO, LADO);
          let q = 0.82, data = cv.toDataURL('image/jpeg', q);
          while (data.length > 900000 && q > 0.4) { q -= 0.12; data = cv.toDataURL('image/jpeg', q); }
          hidden.value = data;
          if (vista) vista.innerHTML = `<img src="${data}" alt="">`;
          if (info) info.textContent = `Foto lista (${Math.round(data.length / 1024)} KB)`;
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(f);
    });
  });

  // ---------------------------------------------------------
  // 6. Chat con el duende
  // ---------------------------------------------------------
  (function chat() {
    const form = $('#chat-form');
    if (!form) return;
    const cuerpo = $('#chat-cuerpo');
    const input = $('#chat-input');
    const btn = $('#chat-btn');

    function burbuja(rol, texto) {
      const d = document.createElement('div');
      d.className = 'msj ' + rol;
      d.textContent = texto;
      cuerpo.appendChild(d);
      cuerpo.scrollTop = cuerpo.scrollHeight;
      return d;
    }

    async function enviar(texto) {
      if (!texto.trim()) return;
      burbuja('user', texto);
      input.value = '';
      btn.disabled = true;
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
        if (d.aprendido && d.aprendido.length) {
          confeti(60);
          pintarDeseos(d.deseos || []);
        }
      } catch (e) {
        esperando.remove();
        burbuja('bot', '⚠️ No pude responder. Revisa tu conexión.');
      } finally {
        btn.disabled = false;
        input.focus();
      }
    }

    function pintarDeseos(lista) {
      const ul = $('#mis-deseos');
      if (!ul) return;
      ul.innerHTML = lista.length
        ? lista.map(d => `<li>${escapar(d.texto)}</li>`).join('')
        : '<li>Todavía no has pedido nada</li>';
    }

    form.addEventListener('submit', e => { e.preventDefault(); enviar(input.value); });
    $$('.chip[data-enviar]').forEach(c => c.addEventListener('click', () => enviar(c.dataset.enviar)));
    cuerpo.scrollTop = cuerpo.scrollHeight;
    input.focus();
  })();

  // ---------------------------------------------------------
  // 7. Detalles varios
  // ---------------------------------------------------------
  $$('form[data-confirmar]').forEach(f => {
    f.addEventListener('submit', e => {
      if (!confirm(f.dataset.confirmar)) e.preventDefault();
    });
  });

  // confeti al completar el cupo / al cargar el dashboard con sorteo nuevo
  if (document.body.dataset.festejo === '1') setTimeout(() => confeti(170), 500);

  // ocultar flash
  const fl = $('.flash');
  if (fl) setTimeout(() => { fl.style.transition = 'opacity .6s'; fl.style.opacity = '0'; setTimeout(() => fl.remove(), 650); }, 6000);
})();
