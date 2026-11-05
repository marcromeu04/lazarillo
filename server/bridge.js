// Puente que se inyecta en cada página del proxy (dentro del iframe) y habla con la app por postMessage.
// El servidor lo envuelve así:  (function(ORIGINAL_URL, PROXY, FRAME){ …este fichero… })(url, origen, frame)
//  - FRAME = { port, site }: la página se sirve desde su origen local (www.x.com → www-x-com.localhost:port)
//    y navega de forma normal dentro de él; los enlaces a otras webs se abren en una pestaña aparte.
//  - FRAME = null: la página va por /proxy?url= (origen «null», <base> a la web real).
// No escribas aquí la etiqueta de cierre de script: este código va dentro de un <script> en línea.
'use strict';
if (window.parent !== window.top) return; // un iframe de la propia web dentro de la página: no es la pantalla

function encH(h) { return h.replace(/-/g, '--').replace(/\./g, '-'); }
function decH(l) { return l.replace(/--|-/g, function (m) { return m === '--' ? '-' : '.'; }); }
function isLocal(u) { return !!FRAME && /^[a-z0-9-]+\.localhost$/i.test(u.hostname) && String(u.port) === String(FRAME.port); }
function inSite(h) { h = (h || '').toLowerCase(); return !!FRAME && (h === FRAME.site || h.slice(-FRAME.site.length - 1) === '.' + FRAME.site); }
// URL de la web real de lo que se ve ahora (para la app y el grafo).
function realUrl() {
  if (!FRAME) return ORIGINAL_URL;
  try { var u = new URL(location.href); return isLocal(u) ? 'https://' + decH(u.hostname.slice(0, -'.localhost'.length)) + u.pathname + u.search : ORIGINAL_URL; } catch (e) { return ORIGINAL_URL; }
}
// Adónde navegar para abrir h dentro de la demo; null si es de otra web.
function prox(h) {
  try {
    if (!FRAME) return PROXY + '/proxy?url=' + encodeURIComponent(new URL(h, ORIGINAL_URL).href);
    var u = new URL(h, location.href);
    if (isLocal(u)) return u.href;
    if (u.protocol === 'https:' && !u.port && inSite(u.hostname)) return 'http://' + encH(u.hostname.toLowerCase()) + '.localhost:' + FRAME.port + u.pathname + u.search + u.hash;
    return null;
  } catch (e) { return null; }
}
function post(m) { try { parent.postMessage(m, '*'); } catch (e) {} }
var LAST = ''; try { LAST = sessionStorage.getItem('lz_via') || ''; sessionStorage.removeItem('lz_via'); } catch (e) {}
window.addEventListener('load', function () { post({ type: 'page', url: realUrl(), title: document.title, via: LAST }); sendSnapshot(700, true); });

// ---------- lo que se ve, para el agente de mapeo ----------
// En webs que se pintan con JavaScript el HTML llega casi vacío. Aquí la página ya está pintada: se leen
// sus titulares, texto, listas, botones, cifras y enlaces y se mandan al agente de mapeo. Gratis: sin
// otro Chrome ni descargas. Nunca se lee lo que el visitante escribe en un formulario.
function txt(e) { return (e.innerText || e.textContent || '').replace(/\s+/g, ' ').trim(); }
function shown(e) {
  if (e.closest('script,style,noscript,template,[aria-hidden=true],[hidden]')) return false;
  var r = e.getBoundingClientRect();
  if (!r.width && !r.height) return false;
  var cs = getComputedStyle(e);
  return cs.visibility !== 'hidden' && cs.display !== 'none';
}
function pick(sel, scope, max, len, keep) {
  var out = [], seen = {}, els = scope.querySelectorAll(sel);
  for (var i = 0; i < els.length && i < 600 && out.length < max; i++) {
    if (!shown(els[i])) continue;
    var t = txt(els[i]) || els[i].getAttribute('aria-label') || '';
    t = t.slice(0, len);
    if (!t || seen[t] || (keep && !keep(t))) continue;
    seen[t] = 1; out.push(t);
  }
  return out;
}
function realOf(href) { // dirección real de un enlace (en la demo apunta al origen local)
  try {
    var u = new URL(href, location.href);
    if (isLocal(u)) return 'https://' + decH(u.hostname.slice(0, -'.localhost'.length)) + u.pathname + u.search;
    return u.href;
  } catch (e) { return ''; }
}
function sameSite(h) {
  if (FRAME) return inSite(h);
  try { return h.replace(/^www\./, '') === new URL(ORIGINAL_URL).hostname.replace(/^www\./, ''); } catch (e) { return false; }
}
function snapshot() {
  var body = document.body;
  if (!body) return null;
  var root = document.querySelector('main') || body;
  var paras = pick('p', root, 40, 400, function (t) { return t.length > 40; }), text = '';
  for (var i = 0; i < paras.length && text.length + paras[i].length <= 1600; i++) text += (text ? ' ' : '') + paras[i];
  var forms = [], inputs = body.querySelectorAll('input:not([type=hidden]),textarea,select');
  for (var j = 0; j < inputs.length && forms.length < 10; j++) { // la etiqueta del campo, nunca su valor
    var f = inputs[j].getAttribute('aria-label') || inputs[j].getAttribute('placeholder') || inputs[j].getAttribute('name') || '';
    if (f && forms.indexOf(f) < 0) forms.push(f.slice(0, 40));
  }
  var figures = (txt(root).slice(0, 20000).match(/(?:\d[\d.,]*\s?(?:%|€|\$|x|k|M)(?![a-z])|(?:€|\$)\s?\d[\d.,]*)/g) || []).filter(function (x, k, a) { return a.indexOf(x) === k; }).slice(0, 10);
  var links = [], seenL = {}, as = body.querySelectorAll('a[href]');
  for (var k = 0; k < as.length && links.length < 60; k++) {
    var href = as[k].getAttribute('href') || '';
    if (/^(#|mailto:|tel:|javascript:)/i.test(href)) continue;
    var real = realOf(href);
    if (!real || seenL[real]) continue;
    try { if (!sameSite(new URL(real).hostname)) continue; } catch (e2) { continue; }
    seenL[real] = 1;
    links.push({ href: real, label: (txt(as[k]) || as[k].getAttribute('aria-label') || '').slice(0, 40) });
  }
  return {
    title: (document.title || '').slice(0, 120),
    heads: pick('h1,h2,h3', root, 12, 90),
    text: text,
    items: pick('li', root, 15, 90, function (t) { return t.length > 8 && t.length < 90; }),
    buttons: pick('a,button,[role=button]', body, 30, 40),
    forms: forms,
    figures: figures,
    links: links,
  };
}
var snapTimer = 0;
function sendSnapshot(delay, retry) {
  clearTimeout(snapTimer);
  snapTimer = setTimeout(function () {
    var d = null;
    try { d = snapshot(); } catch (e) {}
    if (!d) return;
    if (retry && d.text.length < 200 && d.heads.length < 2) { sendSnapshot(1800, false); return; } // aún pintándose
    post({ type: 'contenido', url: realUrl(), data: d });
  }, delay);
}
document.addEventListener('click', function (e) {
  var a = e.target.closest ? e.target.closest('a[href]') : null;
  if (!a) return;
  var h = a.getAttribute('href');
  if (!h || /^(mailto:|tel:|javascript:|#)/i.test(h)) return;
  var p = prox(h), tx = (a.innerText || '').trim().slice(0, 80);
  if (FRAME && !p) { // otra web: aparte, sin perder la demo
    e.preventDefault(); e.stopPropagation();
    try { window.open(new URL(h, location.href).href, '_blank', 'noopener'); } catch (e3) {}
    post({ type: 'click', text: tx, fuera: true });
    return;
  }
  if (!p) return;
  LAST = tx.slice(0, 40);
  try { sessionStorage.setItem('lz_via', LAST); } catch (e2) {}
  post({ type: 'click', text: tx });
  // En su origen local la web navega sola (y una SPA usa su propio router); solo se fuerza si abría otra
  // pestaña o si el enlace apunta a la web real (p. ej. desde datos de React que no se reescriben).
  if (FRAME && !(a.target && a.target !== '_self') && p === new URL(h, location.href).href) return;
  e.preventDefault(); e.stopPropagation();
  location.href = p;
}, true);
// Red de seguridad: cualquier salto a la web real (location.href = …, formularios, redirecciones por JS)
// se reconduce a su origen local; a otra web, en una pestaña aparte. Sin esto la pantalla se queda en blanco
// (la web real no deja que la metan en un iframe).
if (FRAME && window.navigation && navigation.addEventListener) {
  var jumps = [];
  navigation.addEventListener('navigate', function (e) {
    try {
      if (!e.cancelable || e.downloadRequest || e.hashChange) return;
      var url = e.destination.url, u = new URL(url);
      if (isLocal(u) || !/^https?:$/.test(u.protocol)) return;
      e.preventDefault();
      var p = prox(url);
      if (!p) { window.open(url, '_blank', 'noopener'); post({ type: 'click', text: '', fuera: true }); return; }
      if (p.split('#')[0] === location.href.split('#')[0]) return; // la web quería «salir» a sí misma: se queda
      var now = Date.now(); jumps = jumps.filter(function (t) { return now - t < 4000; }); jumps.push(now);
      if (jumps.length > 3) return; // nada de bucles de recarga
      location.href = p;
    } catch (err) {}
  });
}
// SPA: cambia de página sin recargar (pushState). Se avisa a la app y la pantalla vuelve a empezar.
if (FRAME) {
  var lastPath = location.pathname;
  var navChanged = function () {
    setTimeout(function () {
      if (location.pathname === lastPath) return;
      lastPath = location.pathname;
      try { FOLLOW.idx = null; CURSOR.y = null; } catch (e) {}
      post({ type: 'page', url: realUrl(), title: document.title, via: LAST });
      LAST = '';
      sendSnapshot(900, true);
    }, 400);
  };
  ['pushState', 'replaceState'].forEach(function (k) {
    var orig = history[k];
    if (typeof orig !== 'function') return;
    history[k] = function () { var r = orig.apply(this, arguments); navChanged(); return r; };
  });
  window.addEventListener('popstate', navChanged);
}

function norm(s) { return (s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }
function fold(s) { return norm(s).normalize('NFD').replace(/[̀-ͯ]/g, ''); }
function onScreenX(r) { return r.right > 0 && r.left < innerWidth; }

// ---------------------------------------------------------------------------------------------
// MOTOR DE DESPLAZAMIENTO. Todo movimiento de pantalla pasa por aquí; nunca scrollIntoView.
//  · Un solo movimiento a la vez, con curva suave y duración según la distancia.
//  · Solo vertical: los carruseles y contenedores horizontales no se tocan.
//  · Encuadra la sección entera si cabe, si no el bloque en el tercio superior, bajo la cabecera fija.
//  · Distancias largas: fundido corto en vez de cruzar media web a toda velocidad.
//  · Corrige el destino en marcha (animaciones de aparición, imágenes que cargan tarde).
//  · Respeta scroll-snap, scroll-behavior y Lenis si la web lo expone; usa el contenedor que de
//    verdad se desplaza (webs-app donde no se mueve la página sino un panel).
//  · Si el visitante mueve la página, la IA deja de mover la pantalla unos segundos.
// ---------------------------------------------------------------------------------------------
var RM = false; try { RM = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
var ROOT_SC = document.scrollingElement || document.documentElement;
var SCC = { el: null, at: 0 };
function scroller() {
  if (SCC.el && Date.now() - SCC.at < 3000) return SCC.el;
  var el = ROOT_SC;
  if (ROOT_SC.scrollHeight <= innerHeight + 40) {
    var best = null, area = 0, all = document.querySelectorAll('body *');
    for (var i = 0; i < all.length && i < 6000; i++) {
      var e = all[i];
      if (e.scrollHeight <= e.clientHeight + 40 || e.clientHeight < 150) continue;
      if (!/(auto|scroll|overlay)/.test(getComputedStyle(e).overflowY)) continue;
      var r = e.getBoundingClientRect(), a = r.width * r.height;
      if (a > area) { area = a; best = e; }
    }
    if (best && area > innerWidth * innerHeight * 0.3) el = best;
  }
  SCC.el = el; SCC.at = Date.now();
  return el;
}
function isRoot(sc) { return sc === ROOT_SC || sc === document.body || sc === document.documentElement; }
function getTop(sc) { return isRoot(sc) ? (window.scrollY || ROOT_SC.scrollTop) : sc.scrollTop; }
function viewTop(sc) { return isRoot(sc) ? 0 : sc.getBoundingClientRect().top; }
function viewH(sc) { return isRoot(sc) ? innerHeight : sc.clientHeight; }
function maxTop(sc) { return Math.max(0, (isRoot(sc) ? ROOT_SC.scrollHeight : sc.scrollHeight) - viewH(sc)); }
function clampTop(sc, y) { return Math.max(0, Math.min(maxTop(sc), y)); }
function setTop(sc, y) {
  // behavior 'instant' gana a un scroll-behavior:smooth del CSS de la web (si no, cada fotograma se animaría)
  try { if (isRoot(sc)) window.scrollTo({ top: y, left: window.scrollX, behavior: 'instant' }); else sc.scrollTo({ top: y, behavior: 'instant' }); }
  catch (e) { if (isRoot(sc)) window.scrollTo(window.scrollX, y); else sc.scrollTop = y; }
}
function docY(el, sc) { sc = sc || scroller(); return el.getBoundingClientRect().top - viewTop(sc) + getTop(sc); }

// Altura de la cabecera fija o pegada arriba (para no dejar el contenido debajo de ella).
var INS = { v: 0, at: 0 };
function topInset() {
  if (Date.now() - INS.at < 1500) return INS.v;
  var v = 0, xs = [innerWidth * 0.5, 24, innerWidth - 24];
  for (var i = 0; i < xs.length; i++) {
    var stack = document.elementsFromPoint(xs[i], 3) || [];
    for (var j = 0; j < stack.length && j < 6; j++) {
      for (var e = stack[j], up = 0; e && e !== document.body && e !== document.documentElement && up < 8; e = e.parentElement, up++) {
        var p = getComputedStyle(e).position;
        if (p === 'fixed' || p === 'sticky') {
          var r = e.getBoundingClientRect();
          if (r.top <= 4 && r.height < innerHeight * 0.3 && r.width > innerWidth * 0.4) v = Math.max(v, r.bottom);
          break;
        }
      }
    }
  }
  INS.v = Math.min(v, innerHeight * 0.3); INS.at = Date.now();
  return INS.v;
}

// La sección que contiene al bloque: el ancestro más grande que todavía cabe en pantalla.
function frameOf(el, vh) {
  var best = null;
  for (var e = el.parentElement, up = 0; e && e !== document.body && up < 10; e = e.parentElement, up++) {
    var h = e.getBoundingClientRect().height;
    if (h > vh * 0.9) break;
    if (h >= vh * 0.3) best = e;
  }
  return best;
}
// Dónde tiene que quedar la página para que ese bloque se vea bien.
function anchorFor(el) {
  var sc = scroller(), vh = viewH(sc), ins = isRoot(sc) ? topInset() : 0, pad = ins + Math.min(40, vh * 0.05);
  var r = el.getBoundingClientRect(), fr = frameOf(el, vh);
  if (fr) {
    var f = fr.getBoundingClientRect();
    if (f.height <= vh - pad - 16 && r.bottom - f.top <= vh - pad) {
      var spare = vh - pad - f.height;
      return clampTop(sc, f.top - viewTop(sc) + getTop(sc) - pad - Math.min(spare * 0.35, vh * 0.12));
    }
  }
  var y = docY(el, sc) - (r.height > vh * 0.6 ? pad : Math.max(pad, vh * 0.28));
  return clampTop(sc, y);
}
// ¿Ya se ve bien sin moverse? (evita micro-desplazamientos que marean)
function comfortable(el) {
  var sc = scroller(), vt = viewTop(sc), vh = viewH(sc), ins = isRoot(sc) ? topInset() : 0, r = el.getBoundingClientRect();
  var top = r.top - vt, bot = r.bottom - vt;
  if (r.height > vh * 0.6) return top >= ins - 4 && top <= vh * 0.45;
  return top >= ins + 6 && bot <= vh * 0.86;
}
function visibleNow(el) {
  var sc = scroller(), vt = viewTop(sc), vh = viewH(sc), r = el.getBoundingClientRect();
  return r.height > 0 && r.bottom - vt > 0 && r.top - vt < vh && onScreenX(r);
}

function lenis() { var l = window.lenis || window.__lenis; return l && typeof l.scrollTo === 'function' ? l : null; }
var SNAP = null;
function pauseSnap(sc) {
  var el = isRoot(sc) ? document.documentElement : sc, t = getComputedStyle(el).scrollSnapType;
  if (t && t !== 'none' && !SNAP) { SNAP = { el: el, v: el.style.scrollSnapType }; el.style.scrollSnapType = 'none'; }
}
function restoreSnap() { if (SNAP) { SNAP.el.style.scrollSnapType = SNAP.v; SNAP = null; } }

var GL = { raf: 0, cb: null, tm: 0 };
function moving() { return !!(GL.raf || GL.cb); }
function cancelGlide() {
  if (GL.raf) cancelAnimationFrame(GL.raf);
  clearTimeout(GL.tm);
  GL.raf = 0; GL.cb = null; restoreSnap();
}
function finish() { GL.raf = 0; restoreSnap(); var cb = GL.cb; GL.cb = null; if (cb) cb(); }
function ease(p) { return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; }

// Lleva la pantalla hasta el bloque «el» (o hasta la altura yTarget si no hay bloque).
function glide(el, done, yTarget) {
  cancelGlide();
  var sc = scroller(), from = getTop(sc), to = el ? anchorFor(el) : clampTop(sc, yTarget), vh = viewH(sc);
  var dist = Math.abs(to - from);
  if (dist < 6) { if (done) done(); return; }
  GL.cb = done || null;
  var L = isRoot(sc) ? lenis() : null;
  if (L) {
    var d = Math.min(1.5, 0.45 + Math.sqrt(dist) * 0.016);
    try { L.scrollTo(to, { duration: d, force: true }); } catch (e) { setTop(sc, to); }
    GL.tm = setTimeout(finish, d * 1000 + 60);
    return;
  }
  if (RM) { setTop(sc, to); finish(); return; }
  if (dist > vh * 2.2) { cut(sc, el, to); return; }
  pauseSnap(sc);
  var dur = Math.min(1500, 450 + Math.sqrt(dist) * 16), t0 = performance.now(), lastFix = t0;
  function step(now) {
    var p = Math.min(1, (now - t0) / dur);
    if (el && p < 0.85 && now - lastFix > 160) { lastFix = now; var nt = anchorFor(el); if (Math.abs(nt - to) > 4) to = nt; }
    setTop(sc, from + (to - from) * ease(p));
    if (p < 1) GL.raf = requestAnimationFrame(step); else finish();
  }
  GL.raf = requestAnimationFrame(step);
}
function veilColor() {
  var none = /^(transparent|rgba\(0, 0, 0, 0\))$/;
  var c = getComputedStyle(document.body).backgroundColor;
  if (!c || none.test(c)) c = getComputedStyle(document.documentElement).backgroundColor;
  return !c || none.test(c) ? '#fff' : c;
}
// Salto largo: fundido breve, aparece un poco antes del destino y recorre el último tramo.
function cut(sc, el, to) {
  var v = document.createElement('div');
  v.style.cssText = 'position:fixed;inset:0;z-index:2147483645;pointer-events:none;opacity:0;transition:opacity 160ms ease;background:' + veilColor();
  document.documentElement.appendChild(v);
  requestAnimationFrame(function () { v.style.opacity = '0.92'; });
  GL.tm = setTimeout(function () {
    var down = to > getTop(sc);
    pauseSnap(sc);
    setTop(sc, clampTop(sc, to + (down ? -1 : 1) * viewH(sc) * 0.22));
    v.style.transition = 'opacity 260ms ease'; v.style.opacity = '0';
    setTimeout(function () { v.remove(); }, 320);
    var cb = GL.cb; GL.cb = null; restoreSnap();
    glide(el, cb, to);
  }, 180);
}

// Halo suave que acompaña al bloque del que se habla (uno solo, sigue al bloque mientras se mueve).
var MK = { el: null, box: null, raf: 0, until: 0 };
function mark(el, ms) {
  if (!MK.box) {
    var b = document.createElement('div');
    b.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;border-radius:10px;box-shadow:0 0 0 2px rgba(168,85,247,.55),0 0 18px 4px rgba(168,85,247,.25);opacity:0;transition:opacity .35s ease';
    document.documentElement.appendChild(b); MK.box = b;
  }
  MK.el = el; MK.until = Date.now() + (ms || 2000);
  MK.box.style.opacity = '1';
  if (!MK.raf) MK.raf = requestAnimationFrame(markTick);
}
function markTick() {
  var b = MK.box, el = MK.el;
  if (!el || !el.isConnected || Date.now() > MK.until) { b.style.opacity = '0'; MK.raf = 0; return; }
  var r = el.getBoundingClientRect();
  b.style.left = (r.left - 8) + 'px'; b.style.top = (r.top - 6) + 'px'; b.style.width = (r.width + 16) + 'px'; b.style.height = (r.height + 12) + 'px';
  MK.raf = requestAnimationFrame(markTick);
}

// El visitante manda: si mueve la página, la IA no la mueve durante unos segundos.
var USER = { until: 0 };
function userScrolled() {
  USER.until = Date.now() + 7000;
  cancelGlide(); clearTimeout(PACE.timer); PACE.pending = null;
  CURSOR.y = null; // a partir de ahora se sigue desde donde lo ha dejado él
}
addEventListener('wheel', userScrolled, { passive: true, capture: true });
addEventListener('touchmove', userScrolled, { passive: true, capture: true });
addEventListener('keydown', function (e) { if (/^(ArrowUp|ArrowDown|PageUp|PageDown|Home|End| |Spacebar)$/.test(e.key)) userScrolled(); }, true);
addEventListener('mousedown', function (e) { if (e.clientX >= document.documentElement.clientWidth) userScrolled(); }, true);

// Ritmo: como mucho un movimiento cada DWELL ms; si llegan varias frases, cuenta solo la última.
var PACE = { last: 0, pending: null, timer: 0 }, DWELL = 1800;
function schedule(ms) {
  clearTimeout(PACE.timer);
  PACE.timer = setTimeout(function () { var p = PACE.pending; PACE.pending = null; if (p) follow(p); }, ms);
}
function follow(el) {
  if (HOLD.on || Date.now() < USER.until) { if (visibleNow(el)) mark(el); return; }
  if (comfortable(el)) { mark(el); return; }
  if (moving()) { PACE.pending = el; return; }
  var wait = PACE.last + DWELL - Date.now();
  if (wait > 0) { PACE.pending = el; schedule(wait); return; }
  mark(el, 4000);
  glide(el, function () { mark(el); PACE.last = Date.now(); if (PACE.pending) schedule(DWELL); });
}
// Movimiento pedido expresamente (mostrar, resaltar, pulsar): sin esperas, y manda sobre el seguimiento.
function moveNow(el, done) {
  clearTimeout(PACE.timer); PACE.pending = null; USER.until = 0;
  FOLLOW.el = el; CURSOR.y = docY(el);
  mark(el, 4000);
  glide(el, function () { PACE.last = Date.now(); mark(el, 2200); if (done) done(); });
}

// ---------------------------------------------------------------------------------------------
// La pantalla sigue a la voz: cada frase de la IA se compara con los bloques de la página.
// La explicación avanza en orden, así que pesa la cercanía al punto por el que va: un salto lejos
// (o hacia atrás) solo se hace si la coincidencia es mucho más clara que cualquier otra.
// ---------------------------------------------------------------------------------------------
var FSTOP = { 'para': 1, 'como': 1, 'esta': 1, 'este': 1, 'esto': 1, 'pero': 1, 'porque': 1, 'donde': 1, 'cuando': 1, 'tambien': 1, 'tienes': 1, 'puedes': 1, 'aqui': 1, 'mira': 1, 'fijate': 1, 'vale': 1, 'sobre': 1, 'entre': 1, 'todo': 1, 'toda': 1, 'todos': 1, 'cada': 1, 'muy': 1, 'mucho': 1, 'mas': 1, 'menos': 1, 'tu': 1, 'tus': 1, 'nos': 1, 'les': 1, 'una': 1, 'unos': 1, 'unas': 1, 'que': 1, 'con': 1, 'los': 1, 'las': 1, 'del': 1, 'pagina': 1, 'web': 1, 'seccion': 1, 'parte': 1, 'abajo': 1, 'arriba': 1, 'ves': 1, 'ver': 1, 'vamos': 1 };
function fstems(t) { return fold(t).split(/[^a-z0-9ñ]+/).filter(function (w) { return w.length >= 4 && !FSTOP[w]; }).map(function (w) { return w.slice(0, 6); }); }
var SKIP_SEL = 'nav,[role=navigation],[aria-hidden=true],[hidden],script,style,noscript,template,dialog:not([open])';
// <header> a veces es la barra del menú y a veces la portada entera (hero): solo se descarta la barra.
function menuBar(e) {
  if (e.tagName !== 'HEADER' && e.getAttribute('role') !== 'banner') return false;
  return e.getBoundingClientRect().height < innerHeight * 0.3 && !e.querySelector('h1');
}
var FOLLOW = { el: null, idx: null, at: 0, h: 0 };
var CURSOR = { y: null };
function followIndex() {
  var H = document.documentElement.scrollHeight;
  if (FOLLOW.idx && Date.now() - FOLLOW.at < 8000 && Math.abs(H - FOLLOW.h) < H * 0.1) return FOLLOW.idx;
  var memo = new Map();
  // Fuera del índice: menús y cabeceras, cosas fijas en pantalla, ocultas y marquesinas en bucle.
  function bad(e) {
    if (!e || e === document.body || e === document.documentElement) return false;
    if (memo.has(e)) return memo.get(e);
    var v = false;
    if (e.matches(SKIP_SEL) || menuBar(e)) v = true;
    else {
      var cs = getComputedStyle(e);
      if (cs.position === 'fixed' || cs.position === 'sticky' || cs.display === 'none' || cs.visibility === 'hidden') v = true;
      else if (cs.animationName !== 'none' && e.scrollWidth > innerWidth * 1.3) v = true;
    }
    if (!v) v = bad(e.parentElement);
    memo.set(e, v); return v;
  }
  var els = document.querySelectorAll('h1,h2,h3,h4,p,li,blockquote,figcaption,td,dt,dd,summary,[class*=card] span,[class*=stat],[class*=metric]'), out = [], df = {};
  for (var i = 0; i < els.length; i++) {
    var el = els[i], r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || bad(el)) continue;
    var t = (el.innerText || '').trim(); if (t.length < 3 || t.length > 320) continue;
    var st = fstems(t); if (!st.length) continue;
    var set = {}; st.forEach(function (s) { set[s] = 1; });
    Object.keys(set).forEach(function (s) { df[s] = (df[s] || 0) + 1; });
    out.push({ el: el, set: set, head: /^H[1-4]$/.test(el.tagName) });
  }
  FOLLOW.idx = { items: out, df: df, n: Math.max(1, out.length) }; FOLLOW.at = Date.now(); FOLLOW.h = H;
  return FOLLOW.idx;
}
function followText(text) {
  var q = fstems(text); if (!q.length) return;
  var ix = followIndex(), sc = scroller(), vh = viewH(sc), top = getTop(sc), vt = viewTop(sc);
  var cy = CURSOR.y == null ? top + vh * 0.3 : CURSOR.y;
  var best = null, bs = 0, by = 0;
  for (var i = 0; i < ix.items.length; i++) {
    var it = ix.items[i], r = it.el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || !onScreenX(r)) continue; // diapositiva de carrusel fuera de vista: no
    var s = 0, hits = 0;
    for (var k = 0; k < q.length; k++) if (it.set[q[k]]) { hits++; s += Math.log(1 + ix.n / ix.df[q[k]]); }
    if (!hits) continue;
    if (it.head) s *= 1.35; if (hits >= 2) s *= 1.25;
    var y = r.top - vt + top, rel = (y - cy) / vh, w;
    if (HOLD.on) { if (r.top - vt < 0 || r.bottom - vt > vh) continue; w = 1; } // parada: solo lo que ya se ve
    else if (rel >= -0.4 && rel <= 2.2) w = 1;                                     // lo siguiente en la página
    else if (rel > 2.2) w = 1 / (1 + (rel - 2.2) * 0.5);                           // mucho más abajo
    else w = 0.6 / (1 + (-rel - 0.4) * 1.2);                                       // volver atrás cuesta más
    s *= w;
    if (s > bs) { bs = s; best = it.el; by = y; }
  }
  if (!best || bs < 2.2 || best === FOLLOW.el) return;
  FOLLOW.el = best; CURSOR.y = by;
  follow(best);
  post({ type: 'follow_result', ok: true, text: (best.innerText || '').trim().slice(0, 50) });
}

// Foco: el visitante ha dicho «párate aquí»: la pantalla se queda en esta zona.
var HOLD = { on: false, y: 0 };
function centerBlock() {
  var el = document.elementFromPoint(innerWidth / 2, innerHeight * 0.45);
  while (el && el !== document.body) { var t = (el.innerText || '').trim(); if (t.length >= 40 && t.length <= 900) return el; el = el.parentElement; }
  return null;
}
function focusEl() { return FOLLOW.el && FOLLOW.el.isConnected && visibleNow(FOLLOW.el) ? FOLLOW.el : centerBlock(); }
function setHold(on) {
  HOLD.on = !!on;
  if (on) {
    cancelGlide(); clearTimeout(PACE.timer); PACE.pending = null;
    var f = focusEl();
    HOLD.y = f ? docY(f) : getTop(scroller()) + innerHeight * 0.4;
    if (f) mark(f, 1600);
  }
}
function peek() {
  var f = focusEl();
  var heads = [].slice.call(document.querySelectorAll('h1,h2,h3')).filter(function (h) { var r = h.getBoundingClientRect(); return r.height > 0 && r.top >= 0 && r.bottom <= innerHeight && onScreenX(r); }).slice(0, 4).map(function (h) { return (h.innerText || '').trim().slice(0, 90); });
  post({ type: 'peek_result', foco: f ? (f.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 320) : '', titulares_visibles: heads, parado: HOLD.on });
}

// ---------------------------------------------------------------------------------------------
// Herramientas de la IA: pulsar, mostrar, resaltar.
// ---------------------------------------------------------------------------------------------
function find(text) {
  var want = norm(text), els = document.querySelectorAll('a,button,[role=button],[role=tab],h1,h2,h3,label,li,input'), best = null, bs = 0;
  for (var i = 0; i < els.length; i++) {
    var el = els[i], r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0) continue;
    var t = norm(el.innerText || el.textContent || el.value || el.placeholder || el.getAttribute('aria-label')); if (!t || t.length > 120) continue;
    var sc = 0;
    if (t === want) sc = 100; else if (t.indexOf(want) >= 0) sc = 70; else if (want.indexOf(t) >= 0 && t.length > 3) sc = 50;
    else { var w = want.split(' '), h = 0; for (var k = 0; k < w.length; k++) if (w[k].length > 2 && t.indexOf(w[k]) >= 0) h++; sc = h * 14; }
    if (/^(a|button)$/i.test(el.tagName) || el.getAttribute('role')) sc += 5;
    if (!onScreenX(r)) sc -= 30; // en un carrusel fuera de vista
    if (sc > bs) { bs = sc; best = el; }
  }
  return bs >= 14 ? best : null;
}
function ensureKeyframes() {
  if (document.getElementById('lzs')) return;
  var st = document.createElement('style'); st.id = 'lzs'; st.textContent = '@keyframes lzp{0%,100%{opacity:1}50%{opacity:.45}}';
  (document.head || document.documentElement).appendChild(st);
}
function ring(el, ms, chipText) {
  ensureKeyframes();
  var r = document.createElement('div');
  r.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;border:3px solid #a855f7;border-radius:12px;box-shadow:0 0 0 4px rgba(168,85,247,.35),0 0 24px 8px rgba(168,85,247,.6);animation:lzp 1s infinite';
  var chip = null;
  if (chipText) {
    chip = document.createElement('div'); chip.textContent = chipText;
    chip.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;background:#a855f7;color:#fff;font:600 13px system-ui;padding:3px 10px;border-radius:999px;transform:translateY(-120%);box-shadow:0 4px 12px rgba(0,0,0,.3)';
  }
  var end = Date.now() + ms, raf = 0;
  function place() {
    var rr = el.getBoundingClientRect();
    r.style.left = (rr.left - 6) + 'px'; r.style.top = (rr.top - 6) + 'px'; r.style.width = (rr.width + 12) + 'px'; r.style.height = (rr.height + 12) + 'px';
    if (chip) { chip.style.left = rr.left + 'px'; chip.style.top = (rr.top - 4) + 'px'; }
    if (Date.now() < end && el.isConnected) raf = requestAnimationFrame(place); else { r.remove(); if (chip) chip.remove(); }
  }
  document.documentElement.appendChild(r); if (chip) document.documentElement.appendChild(chip);
  place();
}
function clickText(text) {
  var el = find(text);
  if (!el) { post({ type: 'click_result', ok: false, text: text }); return; }
  var a = el.closest ? el.closest('a[href]') : null, label = (el.innerText || el.value || '').trim().slice(0, 40);
  post({ type: 'click_result', ok: true, text: label, nav: !!(a && a.getAttribute('href') && !/^(#|javascript:)/i.test(a.getAttribute('href'))) });
  function fire() { ring(el, 900); setTimeout(function () { el.click(); }, 380); }
  if (comfortable(el)) fire(); else moveNow(el, fire); // se pulsa cuando la pantalla ha llegado, no antes
}
function showText(text) {
  var want = norm(text), els = document.querySelectorAll('h1,h2,h3,h4,p,li,a,button,blockquote,figcaption,td,th,span'), best = null, bs = 0;
  for (var i = 0; i < els.length; i++) {
    var el = els[i], r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0) continue;
    var t = norm(el.innerText || el.textContent); if (!t || t.length > 220) continue;
    var sc = 0;
    if (t === want) sc = 100; else if (t.indexOf(want) >= 0) sc = 70 - Math.min(30, t.length / 10);
    else { var w = want.split(' '), h = 0; for (var k = 0; k < w.length; k++) if (w[k].length > 3 && t.indexOf(w[k]) >= 0) h++; sc = h * 15; }
    if (/^H[1-4]$/.test(el.tagName)) sc += 8;
    if (!onScreenX(r)) sc -= 30;
    if (sc > bs) { bs = sc; best = el; }
  }
  if (!best || bs < 15) { post({ type: 'show_result', ok: false, text: text }); return; }
  moveNow(best);
  post({ type: 'show_result', ok: true, text: (best.innerText || '').trim().slice(0, 60) });
}
function hi(text) {
  var best = find(text);
  if (!best) { post({ type: 'highlight_result', ok: false }); return; }
  function show() { ring(best, 4000, 'aquí'); }
  if (comfortable(best)) show(); else moveNow(best, show);
  post({ type: 'highlight_result', ok: true });
}
// Recorrido por secciones (lo usa la versión anterior de la app; se mantiene por compatibilidad).
function tourStep() {
  var heads = document.querySelectorAll('h1,h2,h3,[role=heading]'), sc = scroller(), y = getTop(sc), vh = viewH(sc), next = null;
  for (var i = 0; i < heads.length; i++) {
    var r = heads[i].getBoundingClientRect(); if (r.width === 0 || r.height === 0 || !onScreenX(r)) continue;
    if (r.top - viewTop(sc) > vh * 0.3) { next = heads[i]; break; }
  }
  if (next) { moveNow(next); post({ type: 'tour_result', ok: true, text: (next.innerText || '').trim().slice(0, 60) }); }
  else if (y < maxTop(sc) - 40) { glide(null, null, y + vh * 0.6); post({ type: 'tour_result', ok: true, text: '' }); }
  else post({ type: 'tour_result', ok: false, end: true });
}

// ---------------------------------------------------------------------------------------------
// Avisos de cookies: se rechazan (o «solo necesarias»); si no hay botón de rechazar, se oculta
// el aviso. Nunca se acepta. Se repite unos segundos porque muchos avisos llegan tarde.
// ---------------------------------------------------------------------------------------------
var CMP_REJECT = ['#onetrust-reject-all-handler', '#CybotCookiebotDialogBodyButtonDecline', '#didomi-notice-disagree-button', '.cky-btn-reject', '.cmplz-deny', '#cookiescript_reject', '.osano-cm-denyAll', '[data-testid=uc-deny-all-button]', '.fc-cta-do-not-consent', '#axeptio_btn_dismiss', '.iubenda-cs-reject-btn', '#tarteaucitronAllDenied2', '.cc-deny'];
var REJECT_RX = /^(rechazar( todo| todas| todas las cookies| cookies)?|denegar( todo)?|no acepto|no aceptar|solo (las )?(cookies )?(necesarias|esenciales|tecnicas)|usar solo (las )?(cookies )?necesarias|continuar sin aceptar|reject( all)?( cookies)?|decline( all)?|deny( all)?|only (necessary|essential)( cookies)?|use necessary cookies only|refuse( all)?|continue without accepting|necessary only|tout refuser|refuser)$/i;
var cookieDone = false;
function looksLikeBanner(el) { var t = norm((el.innerText || '').slice(0, 600)); return /cookie|consent|privacidad|privacy|rgpd|gdpr/.test(t); }
function dismissCookies() {
  if (cookieDone) return;
  for (var i = 0; i < CMP_REJECT.length; i++) {
    var b = document.querySelector(CMP_REJECT[i]);
    if (b && b.getBoundingClientRect().width > 0) { b.click(); cookieDone = true; post({ type: 'cookies', how: 'rechazadas' }); return; }
  }
  var btns = document.querySelectorAll('button,a,[role=button],input[type=button],input[type=submit]');
  for (var j = 0; j < btns.length; j++) {
    var el = btns[j], r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0) continue;
    var t = fold(el.innerText || el.value || el.getAttribute('aria-label'));
    if (!t || t.length > 45 || !REJECT_RX.test(t)) continue;
    var ok = false;
    for (var box = el.parentElement, up = 0; box && up < 8; up++, box = box.parentElement) { if (looksLikeBanner(box)) { ok = true; break; } if (box === document.body) break; }
    if (ok) { el.click(); cookieDone = true; post({ type: 'cookies', how: 'rechazadas' }); return; }
  }
  // Sin botón de rechazar: se oculta el aviso (fijo o pegado a la pantalla) sin aceptar nada.
  var all = document.querySelectorAll('body *');
  for (var k = 0; k < all.length && k < 4000; k++) {
    var e = all[k], cs = getComputedStyle(e);
    if ((cs.position === 'fixed' || cs.position === 'sticky') && e.getBoundingClientRect().height > 40 && looksLikeBanner(e) && e.querySelector('button,a,[role=button]')) {
      e.style.setProperty('display', 'none', 'important'); cookieDone = true; post({ type: 'cookies', how: 'ocultado' }); return;
    }
  }
}
[0, 500, 1200, 2500, 4500].forEach(function (ms) { setTimeout(dismissCookies, ms); });
try { var mo = new MutationObserver(function () { if (!cookieDone) dismissCookies(); }); mo.observe(document.documentElement, { childList: true, subtree: true }); setTimeout(function () { mo.disconnect(); }, 7000); } catch (e) {}

window.addEventListener('message', function (e) {
  var d = e.data || {};
  if (d.type === 'highlight') hi(d.text);
  else if (d.type === 'click') clickText(d.text);
  else if (d.type === 'tour_step') tourStep();
  else if (d.type === 'show') showText(d.text || '');
  else if (d.type === 'follow') followText(d.text || '');
  else if (d.type === 'hold') setHold(d.on);
  else if (d.type === 'peek') peek();
  else if (d.type === 'go' && d.url) { var p = prox(d.url); if (p) location.href = p; }
});
