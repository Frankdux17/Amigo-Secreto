/* ==========================================================
   vision.js — LA COGNICION VISUAL DEL DUENDE

   El duende no tiene camara ni se la pediria a nadie. Lo que si puede
   "ver" es su propia pagina y lo que hace el cursor encima de el, que es
   lo unico que el navegador le deja mirar. Con eso:

     1. MIRADA       las pupilas siguen el cursor por toda la pantalla
     2. ATENCION     nota cuando te quedas un rato encima de el
     3. GESTOS       reconoce caricias, sacudidas y vueltas analizando la
                     trayectoria del mouse (velocidad, cambios de sentido y
                     angulo acumulado)
     4. PRESENCIA    se da cuenta si te fuiste y si volviste

   Cada gesto reconocido se le cuenta al servidor (POST /api/gesto), que
   decide la emocion con src/animo.js y devuelve la frase y la cara. Asi el
   duende aprende con que gestos reacciona cada persona.

   Depende de window.Duende, el puente que publica duende.js.
   ========================================================== */
(function () {
  'use strict';
  if (!window.HAY_SESION) return;

  const widget = document.getElementById('duende-widget');
  if (!widget) return;

  const quieto = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const puente = () => window.Duende || null;

  // ==========================================================
  //  1. LA MIRADA
  // ==========================================================
  // Centro de la cabeza en coordenadas del viewBox (0 0 120 140)
  const CABEZA = { x: 60, y: 40, vbW: 120, vbH: 140 };
  const ALCANCE = 300;          // px de cursor para llegar al desvio maximo
  const DESVIO_X = 2.0;         // unidades del viewBox
  const DESVIO_Y = 1.7;

  let raton = null;
  let pintando = false;

  function svgVisible() {
    const s = widget.querySelector('.duende-lanzador .duende');
    if (!s) return null;
    const r = s.getBoundingClientRect();
    return r.width > 4 ? r : null;
  }

  function mirar() {
    pintando = false;
    if (!raton) return;
    const r = svgVisible();
    if (!r) return;

    const cx = r.left + (CABEZA.x / CABEZA.vbW) * r.width;
    const cy = r.top + (CABEZA.y / CABEZA.vbH) * r.height;
    const dx = raton.x - cx;
    const dy = raton.y - cy;
    const d = Math.hypot(dx, dy) || 1;
    const k = Math.min(1, d / ALCANCE);          // de cerca mira poco, de lejos al tope

    widget.style.setProperty('--px', ((dx / d) * DESVIO_X * k).toFixed(2) + 'px');
    widget.style.setProperty('--py', ((dy / d) * DESVIO_Y * k).toFixed(2) + 'px');
  }

  function pedirMirada() {
    if (pintando || quieto) return;
    pintando = true;
    requestAnimationFrame(mirar);
  }

  // ==========================================================
  //  Aviso al servidor, con freno para no ser pesado
  // ==========================================================
  const ultimoDe = {};            // gesto -> timestamp
  let ultimoCualquiera = 0;
  const ESPERA_POR_GESTO = 45000; // el mismo gesto, una vez cada 45 s
  const ESPERA_GENERAL = 9000;    // cualquier gesto, una vez cada 9 s

  async function avisar(gesto, dato) {
    const ahora = Date.now();
    if (ahora - ultimoCualquiera < ESPERA_GENERAL) return;
    if (ahora - (ultimoDe[gesto] || 0) < ESPERA_POR_GESTO) return;
    ultimoDe[gesto] = ahora;
    ultimoCualquiera = ahora;

    try {
      const res = await fetch('/api/gesto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': window.CSRF || '' },
        body: JSON.stringify({ gesto, dato: dato || '' })
      });
      if (!res.ok) return;
      const d = await res.json();
      const P = puente();
      if (!P) return;

      if (d.animo) P.aplicarAnimo(d.animo);
      // si el chat esta abierto no se le interrumpe con un globo
      if (d.texto && !P.abierto()) P.decir(d.texto, 4200);
      if (d.texto && gesto !== 'ausencia') P.hablar(d.texto);
      if (d.animacion === 'cosquillas') P.reir();
    } catch (e) { /* si falla, el duende simplemente no se enteró */ }
  }

  // ==========================================================
  //  2. ATENCION: el mouse se queda encima
  // ==========================================================
  const lanzador = widget.querySelector('.duende-lanzador');
  let relojHover = null;

  if (lanzador) {
    lanzador.addEventListener('pointerenter', () => {
      clearTimeout(relojHover);
      // hay que quedarse de verdad: 1,6 s, no un roce de paso
      relojHover = setTimeout(() => avisar('hover'), 1600);
    });
    lanzador.addEventListener('pointerleave', () => {
      clearTimeout(relojHover);
      reiniciarTrazo();
    });
  }

  // ==========================================================
  //  3. GESTOS: se analiza la trayectoria del mouse sobre el duende
  //
  //  Se guarda una ventana corta de puntos (los ultimos 900 ms) y sobre
  //  ella se miden tres cosas:
  //    - velocidad media
  //    - cambios de sentido horizontal (ir y volver)
  //    - angulo acumulado alrededor del centro del duende (dar vueltas)
  //
  //  Con eso se distingue una caricia (lenta, de ida y vuelta) de una
  //  sacudida (rapida, de ida y vuelta) y de una vuelta completa.
  // ==========================================================
  const VENTANA = 900;          // ms de historia que se analiza
  let trazo = [];

  function reiniciarTrazo() { trazo = []; }

  function registrarTrazo(x, y) {
    const r = svgVisible();
    if (!r) return;
    // solo interesa lo que pasa cerca del cuerpo del duende
    const cerca = x > r.left - 40 && x < r.right + 40 && y > r.top - 40 && y < r.bottom + 40;
    if (!cerca) { reiniciarTrazo(); return; }

    const ahora = performance.now();
    trazo.push({ x, y, t: ahora });
    while (trazo.length && ahora - trazo[0].t > VENTANA) trazo.shift();
    if (trazo.length < 8) return;

    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;

    let distancia = 0;
    let cambios = 0;
    let angulo = 0;
    let signoPrevio = 0;

    for (let i = 1; i < trazo.length; i++) {
      const a = trazo[i - 1], b = trazo[i];
      const dx = b.x - a.x, dy = b.y - a.y;
      distancia += Math.hypot(dx, dy);

      // cambio de sentido horizontal
      const signo = dx > 1 ? 1 : dx < -1 ? -1 : 0;
      if (signo && signoPrevio && signo !== signoPrevio) cambios++;
      if (signo) signoPrevio = signo;

      // angulo recorrido alrededor del centro (producto cruz normalizado)
      const a1 = Math.atan2(a.y - cy, a.x - cx);
      const a2 = Math.atan2(b.y - cy, b.x - cx);
      let da = a2 - a1;
      while (da > Math.PI) da -= 2 * Math.PI;
      while (da < -Math.PI) da += 2 * Math.PI;
      angulo += da;
    }

    const ms = trazo[trazo.length - 1].t - trazo[0].t || 1;
    const velocidad = distancia / ms;          // px por ms

    if (Math.abs(angulo) > 2 * Math.PI * 0.95) {
      reiniciarTrazo();
      avisar('vuelta', 'giro completo');
    } else if (cambios >= 5 && velocidad > 1.2) {
      reiniciarTrazo();
      avisar('sacudida', 'v=' + velocidad.toFixed(2));
    } else if (cambios >= 4 && velocidad <= 1.2 && velocidad > 0.08) {
      reiniciarTrazo();
      avisar('caricia', 'v=' + velocidad.toFixed(2));
    }
  }

  // ==========================================================
  //  4. PRESENCIA: se fue / volvio
  // ==========================================================
  const AUSENCIA = 3 * 60 * 1000;      // 3 minutos quieto = te fuiste
  let ultimaSenal = Date.now();
  let ausente = false;

  function hayVida() {
    ultimaSenal = Date.now();
    if (ausente) {
      ausente = false;
      const P = puente();
      if (P && !P.dormido()) avisar('regreso');
    }
  }

  setInterval(() => {
    if (ausente || document.hidden) return;
    const P = puente();
    if (P && (P.dormido() || P.abierto())) return;     // dormido o chateando, no se queja
    if (Date.now() - ultimaSenal > AUSENCIA) {
      ausente = true;
      avisar('ausencia');
    }
  }, 30000);

  // ==========================================================
  //  Enganche de eventos
  // ==========================================================
  document.addEventListener('pointermove', (e) => {
    raton = { x: e.clientX, y: e.clientY };
    pedirMirada();
    registrarTrazo(e.clientX, e.clientY);
    vigilarPersecucion(e.clientX, e.clientY);
    hayVida();
  }, { passive: true });

  ['keydown', 'scroll', 'pointerdown', 'touchstart'].forEach(ev =>
    document.addEventListener(ev, hayVida, { passive: true }));

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      // mirada al frente y a olvidar el trazo
      widget.style.setProperty('--px', '0px');
      widget.style.setProperty('--py', '0px');
      reiniciarTrazo();
    } else {
      hayVida();
    }
  });

  // en tactil no hay cursor que seguir, pero si hay toques: un toque
  // sostenido encima del duende cuenta como caricia
  if (lanzador && window.matchMedia('(pointer: coarse)').matches) {
    let relojToque = null;
    lanzador.addEventListener('touchstart', () => {
      clearTimeout(relojToque);
      relojToque = setTimeout(() => avisar('caricia', 'toque sostenido'), 1200);
    }, { passive: true });
    ['touchend', 'touchcancel', 'touchmove'].forEach(ev =>
      lanzador.addEventListener(ev, () => clearTimeout(relojToque), { passive: true }));
  }

  // ==========================================================
  //  5. EL JUEGO DE PILLARLO
  // ==========================================================
  // Si el cursor se le viene encima, el duende se aparta de un brinco. No
  // siempre: a la tercera se deja pillar y se rie, porque un duende que nunca
  // se deja atrapar deja de tener gracia.
  //
  // Se mide la distancia del cursor al centro del muneco y la VELOCIDAD con la
  // que se acerca: acercarse despacio es una caricia (eso ya lo ve el trazo),
  // venirsele encima rapido es perseguirlo.

  const CERCA = 90;             // px: a esta distancia ya lo esta tocando
  const RAPIDO = 0.55;          // px/ms de acercamiento para que cuente

  let esquives = 0;            // seguidos, se reinicia al dejarse pillar
  let totalEsquives = 0;       // acumulado, solo para poder comprobarlo
  let distanciaPrevia = null;
  let tiempoPrevio = 0;
  let ultimoEsquive = 0;
  let relojEsquive = null;

  function centroDelMuneco() {
    const r = svgVisible();
    if (!r) return null;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  function esquivar(hacia) {
    // un brinco corto y de vuelta: no se mueve de su esquina, solo se aparta
    widget.classList.add('esquivando');
    widget.style.setProperty('--esquive-x', (hacia > 0 ? 54 : -54) + 'px');
    widget.style.setProperty('--esquive-r', (hacia > 0 ? 9 : -9) + 'deg');
    clearTimeout(relojEsquive);
    relojEsquive = setTimeout(() => {
      widget.classList.remove('esquivando');
      widget.style.removeProperty('--esquive-x');
      widget.style.removeProperty('--esquive-r');
    }, 620);
  }

  function vigilarPersecucion(x, y) {
    if (quieto) return;
    const P = puente();
    if (!P || P.dormido() || P.abierto()) return;

    const c = centroDelMuneco();
    if (!c) return;

    const d = Math.hypot(x - c.x, y - c.y);
    const ahora = Date.now();
    const dt = ahora - tiempoPrevio;

    // Varios movimientos pueden llegar en el mismo milisegundo (un raton
    // rapido, o eventos sinteticos). Si se exigiera dt > 0 esos se perderian,
    // que es justo cuando mas deprisa viene el cursor. Se toma un minimo de
    // 8 ms, que es mas o menos un fotograma.
    if (distanciaPrevia !== null && dt >= 0 && dt < 260) {
      const acercamiento = (distanciaPrevia - d) / Math.max(dt, 8);   // px/ms, positivo = viene
      if (d < CERCA && acercamiento > RAPIDO && ahora - ultimoEsquive > 900) {
        ultimoEsquive = ahora;
        esquives++;
        totalEsquives++;
        if (esquives >= 3) {
          esquives = 0;
          avisar('pillado', 'me atrapo tras ' + '3 intentos');
        } else {
          esquivar(x < c.x ? 1 : -1);          // se aparta al lado contrario
          avisar('esquive', 'intento ' + esquives);
        }
      }
    }
    distanciaPrevia = d;
    tiempoPrevio = ahora;
  }

  // si deja de perseguirlo un rato, el duende se relaja y vuelve a empezar
  setInterval(() => {
    if (Date.now() - ultimoEsquive > 12000) esquives = 0;
  }, 6000);

  // ==========================================================
  //  6. SU ENTORNO: en que parte de la pagina esta la persona
  // ==========================================================
  // El duende no ve la habitacion, pero si ve SU pagina. Saber en que seccion
  // anda la persona le permite decir algo con sentido en vez de una frase
  // suelta: si lleva un rato mirando la lista de amigos, comenta eso.

  const ZONAS = [
    { sel: '[data-zona="amigo"], .tarjeta-amigo, #mi-amigo', zona: 'amigo' },
    { sel: '[data-zona="grupo"], .lista-amigos, #participantes', zona: 'grupo' },
    { sel: '[data-zona="perfil"], form[action*="perfil"], #mi-perfil', zona: 'perfil' },
    { sel: '[data-zona="evento"], #evento, .datos-evento', zona: 'evento' }
  ];

  let zonaActual = null;
  let desdeCuando = 0;

  function zonaVisible() {
    const alto = window.innerHeight;
    for (const z of ZONAS) {
      for (const el of document.querySelectorAll(z.sel)) {
        const r = el.getBoundingClientRect();
        // visible y ocupando de verdad la pantalla, no asomando una esquina
        if (r.top < alto * 0.75 && r.bottom > alto * 0.25) return z.zona;
      }
    }
    return null;
  }

  function vigilarEntorno() {
    const P = puente();
    if (!P || P.dormido() || P.abierto() || document.hidden) return;
    const z = zonaVisible();
    if (z !== zonaActual) {
      zonaActual = z;
      desdeCuando = Date.now();
      return;
    }
    // lleva 8 segundos largos en la misma zona: ahi si tiene algo que decir
    if (z && Date.now() - desdeCuando > 8000) {
      desdeCuando = Date.now() + 60000;        // y no lo repite en un minuto
      avisar('zona', z);
    }
  }
  setInterval(vigilarEntorno, 2500);

  // queda a mano para depurar desde la consola
  window.DuendeVision = {
    avisar,
    estado: () => ({ ausente, trazo: trazo.length, raton, esquives, totalEsquives, zona: zonaActual })
  };
})();
