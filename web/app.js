// Lazarillo v2 — voz web (P1). Vanilla JS, sin build, sin deps.
// Flujo: POST /api/token → WS Cartesia → session_create → session_ready →
// micro (AudioWorklet) → audio_input; audio_output → altavoz; client tools.

import { createGraph } from './graph.js';
import { createDashboard } from './dashboard.js';

const SR = 16000;
const CARTESIA_VERSION = '2026-08-14';

// ---------- UI ----------
const $ = (id) => document.getElementById(id);
const btnStart = $('btnStart');
const btnStop = $('btnStop');
const dot = $('dot');
const statusText = $('statusText');
const warnbox = $('warnbox');
const logEl = $('log');
const siteFrame = $('site');
const locEl = $('loc');
let visitorUrl = '';
const graphUi = createGraph($('graph'), $('ginfo'), $('ghead'));
const predictEl = $('predict');
const chatEl = $('chat');
const stage = $('stage');
const pillDot = $('pillDot');
const pillText = $('pillText');
const dashboard = createDashboard($('dashPane'), { isLive: () => running });

let statusKind = 'idle';
function setStatus(kind, text) {
  statusKind = kind;
  dot.className = 'dot ' + kind;
  statusText.textContent = text;
  pillDot.className = 'dot sm ' + kind;
  renderPill();
}
// Píldora de la llamada (vistas Web y Panel): estado y lo último que ha dicho Lazarillo.
let pillLine = '';
function renderPill() {
  const s = document.createElement('small');
  s.textContent = statusText.textContent;
  pillText.replaceChildren(s, document.createTextNode(pillLine));
}

// ---------- conversación (burbujas) ----------
function chatStick() { return chatEl.scrollHeight - chatEl.scrollTop - chatEl.clientHeight < 90; }
function chatAppend(node) {
  const stick = chatStick();
  $('chatEmpty')?.remove();
  chatEl.appendChild(node);
  if (stick) chatEl.scrollTop = chatEl.scrollHeight;
}
function addMsg(role, text) {
  const m = document.createElement('div');
  m.className = 'msg ' + role;
  m.innerHTML = '<div class="av"></div><div class="body"><div class="meta"></div><div class="bub"></div></div>';
  m.querySelector('.av').textContent = role === 'you' ? 'TÚ' : 'L';
  m.querySelector('.meta').textContent = `${role === 'you' ? 'Visitante' : 'Lazarillo'} · ${new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`;
  m.querySelector('.bub').textContent = text;
  chatAppend(m);
  if (role === 'ia') { pillLine = text; renderPill(); }
}
let lastNote = '';
function addNote(text, cls = '') {
  if (text === lastNote) return;
  lastNote = text;
  const n = document.createElement('div');
  n.className = 'note ' + cls;
  const s = document.createElement('span');
  s.textContent = text;
  n.appendChild(s);
  chatAppend(n);
}

function log(kind, key, msg) {
  const row = document.createElement('div');
  row.className = 'row';
  const t = new Date().toLocaleTimeString('es-ES', { hour12: false });
  row.innerHTML =
    `<span class="t">${t}</span>` +
    `<span class="k ${kind}">${key}</span>` +
    `<span class="m"></span>`;
  row.querySelector('.m').textContent = msg == null ? '' : String(msg);
  logEl.appendChild(row);
  logEl.scrollTop = logEl.scrollHeight;
}

function showWarn(text) {
  warnbox.textContent = text;
  warnbox.style.display = 'block';
}

// ---------- estado de sesión ----------
let ws = null;
let micStream = null;
let micCtx = null;       // AudioContext de entrada @16 kHz
let workletNode = null;
let scriptNode = null;   // fallback
let micSource = null;
let playCtx = null;      // AudioContext de salida
let nextStartTime = 0;
let liveSources = [];    // AudioBufferSourceNode activos (para interrupción)
let running = false;

// ---------- base64 <-> bytes ----------
function bytesToB64(bytes) {
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  }
  return btoa(bin);
}
function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---------- reproducción de audio_output ----------
function ensurePlayCtx() {
  if (!playCtx) {
    // NO forzamos sampleRate: muchos equipos no reproducen un contexto a 16 kHz
    // y se oye silencio. Dejamos el rate del dispositivo; createBuffer(...,16000)
    // hace que el navegador remuestree al vuelo.
    playCtx = new (window.AudioContext || window.webkitAudioContext)();
    nextStartTime = 0;
  }
  if (playCtx.state === 'suspended') playCtx.resume();
  return playCtx;
}

function playAudioOutput(b64) {
  const bytes = b64ToBytes(b64);
  // PCM 16-bit LE mono → Float32
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = Math.floor(bytes.byteLength / 2);
  if (n === 0) return;
  const ctx = ensurePlayCtx();
  const buf = ctx.createBuffer(1, n, SR);
  const f32 = buf.getChannelData(0);
  for (let i = 0; i < n; i++) {
    const s = dv.getInt16(i * 2, true);
    f32[i] = s < 0 ? s / 0x8000 : s / 0x7fff;
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);

  const now = ctx.currentTime;
  if (nextStartTime < now) nextStartTime = now;
  src.start(nextStartTime);
  nextStartTime += buf.duration;

  liveSources.push(src);
  src.onended = () => {
    const i = liveSources.indexOf(src);
    if (i >= 0) liveSources.splice(i, 1);
    if (running && liveSources.length === 0) setStatus('listen', 'escuchando');
  };
  setStatus('speak', 'hablando');
}

function clearAudioOutput() {
  for (const s of liveSources) { try { s.stop(); } catch {} }
  liveSources = [];
  if (playCtx) nextStartTime = playCtx.currentTime;
  if (running) setStatus('listen', 'escuchando');
}

// ---------- captura de micro ----------
function sendAudioInput(int16buffer) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const b64 = bytesToB64(new Uint8Array(int16buffer));
  ws.send(JSON.stringify({ type: 'audio_input', audio: b64 }));
}

async function startMic() {
  micStream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
  });
  micCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SR });
  if (micCtx.state === 'suspended') await micCtx.resume();
  micSource = micCtx.createMediaStreamSource(micStream);

  let workletOk = false;
  try {
    if (micCtx.audioWorklet) {
      await micCtx.audioWorklet.addModule('pcm-worklet.js');
      workletNode = new AudioWorkletNode(micCtx, 'pcm-worklet');
      workletNode.port.onmessage = (e) => sendAudioInput(e.data);
      micSource.connect(workletNode);
      // no conectamos a destination para no oírnos a nosotros mismos
      workletOk = true;
      log('info', 'mic', 'captura vía AudioWorklet (40 ms)');
    }
  } catch (e) {
    log('info', 'mic', 'worklet falló, uso ScriptProcessor: ' + (e.message || e));
  }

  if (!workletOk) startMicFallback();
}

// Fallback ScriptProcessorNode: convierte a Int16 en trozos de 40 ms.
function startMicFallback() {
  const bufSize = 2048; // ~128 ms; reagrupamos a 640
  scriptNode = micCtx.createScriptProcessor(bufSize, 1, 1);
  const CHUNK = 640;
  let acc = new Int16Array(CHUNK);
  let accN = 0;
  scriptNode.onaudioprocess = (ev) => {
    const ch = ev.inputBuffer.getChannelData(0);
    for (let i = 0; i < ch.length; i++) {
      let s = ch[i];
      if (s > 1) s = 1; else if (s < -1) s = -1;
      acc[accN++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (accN === CHUNK) {
        const out = new Int16Array(CHUNK);
        out.set(acc);
        sendAudioInput(out.buffer);
        accN = 0;
      }
    }
  };
  micSource.connect(scriptNode);
  // ScriptProcessor sólo dispara si está conectado a destination; usamos ganancia 0.
  const silent = micCtx.createGain();
  silent.gain.value = 0;
  scriptNode.connect(silent);
  silent.connect(micCtx.destination);
  log('info', 'mic', 'captura vía ScriptProcessor (fallback)');
}

// ---------- esperas por mensajes del iframe ----------
const waiters = [];
function waitFor(type, ms) {
  return new Promise((resolve) => {
    const w = { type, resolve };
    waiters.push(w);
    setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); resolve(null); } }, ms);
  });
}
function wake(d) {
  for (let i = waiters.length - 1; i >= 0; i--) if (waiters[i].type === d.type) { waiters[i].resolve(d); waiters.splice(i, 1); }
}
const api = (u, body) => fetch(u, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => ({}));

// La IA navega: resalta y pulsa un botón visible; si no lo hay, salta a la página del grafo.
// Siempre responde en menos de ~6 s, con ok:false y alternativas si algo falla.
async function irA(destino) {
  const fail = async (motivo) => ({ ok: false, motivo, siguientes: (await api('/api/suggest')).siguientes || [] });
  if (!destino) return fail('falta el destino');
  const before = visitorUrl;
  let nav = false;
  if (!/^s\d+$/i.test(destino.trim())) {
    const pageP = waitFor('page', 5000);
    try { siteFrame.contentWindow.postMessage({ type: 'click', text: destino }, '*'); } catch {}
    const clicked = await waitFor('click_result', 1500);
    if (clicked && clicked.ok) {
      if (clicked.nav) { nav = !!(await pageP); if (!nav) return fail('la página no ha cargado a tiempo'); }
      else { await new Promise((r) => setTimeout(r, 600)); nav = true; }
    }
  }
  if (!nav) {
    const t = await api('/api/resolve', { destino });
    if (!t.ok) return fail('no encuentro ese botón ni esa página');
    const pageP = waitFor('page', 5000);
    showSite(t.url);
    if (!(await pageP)) return fail('la página no ha cargado a tiempo');
  }
  const ctx = await api('/api/current');
  return { ok: true, ...(visitorUrl === before ? { aviso: 'sigues en la misma página' } : {}), ...ctx };
}

// ---------- client tools ----------
async function handleToolCall(msg) {
  const { tool_call_id, tool_name, parameters, expects_response } = msg;
  log('tool', tool_name || '?', JSON.stringify(parameters || {}));

  const reply = (result, isError) => {
    if (expects_response === false) return;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      type: 'client_tool_result',
      tool_call_id,
      result: typeof result === 'string' ? result : JSON.stringify(result),
      is_error: !!isError,
    }));
  };

  try {
    if (tool_name === 'ir_a') {
      setHold(false);
      const destino = (parameters && parameters.destino) || '';
      const data = await irA(destino);
      log(data.ok ? 'tool' : 'err', 'ir_a', data.ok ? `«${destino}» → ${data.pagina || 'ok'}` : `«${destino}» → ${data.motivo}`);
      reply(JSON.stringify(data), false); // ok:false va dentro: la IA pasa a otra cosa sin drama
      return;
    }
    if (tool_name === 'mostrar') {
      setHold(false);
      const texto = (parameters && parameters.texto) || '';
      lastDirectedAt = Date.now();
      try { siteFrame.contentWindow.postMessage({ type: 'show', text: texto }, '*'); } catch {}
      log('tool', 'mostrar', `«${texto}»`);
      reply(JSON.stringify({ ok: true }), false);
      return;
    }
    if (tool_name === 'pantalla_actual') {
      const peekP = waitFor('peek_result', 600);
      try { siteFrame.contentWindow.postMessage({ type: 'peek' }, '*'); } catch {}
      const r = await fetch('/api/current');
      const data = await r.json().catch(() => ({}));
      const pk = await peekP;
      if (pk) data.en_pantalla = { foco: pk.foco, titulares_visibles: pk.titulares_visibles, parado: pk.parado };
      if (!r.ok) { reply(JSON.stringify(data), true); log('err', 'pantalla_actual', 'HTTP ' + r.status); return; }
      reply(JSON.stringify(data), false);
      log('info', 'pantalla_actual', data && data.pantalla ? data.pantalla.title : 'ok');
      return;
    }
    if (tool_name === 'resaltar') {
      const texto = parameters && parameters.texto;
      // El resaltado ocurre DENTRO del iframe (visible en la misma ventana).
      try { siteFrame.contentWindow.postMessage({ type: 'highlight', text: texto }, '*'); } catch {}
      log('tool', 'resaltar', `«${texto}»`);
      reply(JSON.stringify({ ok: true }), false);
      return;
    }
    // herramienta desconocida
    reply(JSON.stringify({ error: 'unknown tool: ' + tool_name }), true);
    log('err', 'tool', 'desconocida: ' + tool_name);
  } catch (e) {
    reply(JSON.stringify({ error: String(e.message || e) }), true);
    log('err', tool_name || 'tool', e.message || e);
  }
}

// ---------- mensajes WS ----------
function onWsMessage(ev) {
  if (typeof ev.data !== 'string') return; // sólo JSON de texto
  let msg;
  try { msg = JSON.parse(ev.data); } catch { return; }
  const type = msg.type;

  switch (type) {
    case 'session_ready':
      log('evt', 'session_ready', 'sesión lista');
      setStatus('listen', 'escuchando');
      startMic().catch((e) => {
        log('err', 'mic', e.message || e);
        setStatus('error', 'micro denegado');
      });
      break;
    case 'audio_output':
      if (msg.audio) { if (follow.audioStart == null) follow.audioStart = Date.now(); playAudioOutput(msg.audio); }
      break;
    case 'audio_output_clear':
      log('evt', 'audio_clear', 'interrupción');
      clearAudioOutput();
      followReset();
      if (!holding) { holdByBargeIn = true; setHold(true, 'te ha interrumpido'); }
      break;
    case 'client_tool_call':
      handleToolCall(msg);
      break;
    case 'error':
      log('err', 'error', msg.message || JSON.stringify(msg));
      break;
    case 'turn_started':
      if (msg.role === 'assistant') followReset();
      break;
    case 'turn_output_text_delta':
      if (msg.text) followDelta(msg.text); // la pantalla sigue a lo que va diciendo
      break;
    case 'turn_ended':
      if (msg.role === 'assistant' && follow.buf.trim()) { followPush(follow.buf); follow.buf = ''; }
      if (msg.role === 'user' && msg.text) {
        if (HOLD_RX.test(msg.text)) { holdByBargeIn = false; setHold(true, 'lo ha pedido'); }
        else if (GO_RX.test(msg.text) || holdByBargeIn) { holdByBargeIn = false; setHold(false); }
      }
      if (msg.text) {
        say(msg.role === 'user' ? 'you' : 'ia', msg.role === 'user' ? 'tú' : 'lazarillo', msg.text);
        api('/api/hint', { text: msg.text, role: msg.role });
      }
      break;
    default:
      // transcripciones / eventos de turno / etc.
      if (type) log('evt', type, msg.text || msg.transcript || '');
  }
}

// ---------- arranque / parada ----------
async function start() {
  btnStart.disabled = true;
  warnbox.style.display = 'none';
  setStatus('connect', 'conectando');
  log('info', 'inicio', 'pidiendo token…');

  let tok;
  try {
    const r = await fetch('/api/token', { method: 'POST' });
    tok = await r.json();
  } catch (e) {
    setStatus('error', 'sin servidor');
    log('err', 'token', e.message || e);
    btnStart.disabled = false;
    return;
  }

  if (!tok || tok.mock || !tok.token || !tok.agentId) {
    setStatus('error', 'voz no configurada');
    showWarn('voz no configurada — falta CARTESIA_API_KEY');
    log('err', 'token', tok && tok.error ? tok.error : 'mock / sin agentId');
    btnStart.disabled = false;
    return;
  }

  const url = `wss://api.cartesia.ai/v1/agents/websocket/${encodeURIComponent(tok.agentId)}` +
    `?cartesia_version=${CARTESIA_VERSION}&access_token=${encodeURIComponent(tok.token)}`;

  try {
    ws = new WebSocket(url);
  } catch (e) {
    setStatus('error', 'ws falló');
    log('err', 'ws', e.message || e);
    btnStart.disabled = false;
    return;
  }

  ensurePlayCtx(); // crear/resumir dentro del gesto de usuario
  running = true;
  btnStop.disabled = false;
  lastNote = '';
  addNote('Llamada iniciada');

  ws.onopen = () => {
    log('evt', 'ws_open', 'conectado a Cartesia');
    ws.send(JSON.stringify({
      type: 'session_create',
      audio: { input_format: 'pcm_16000', output_delivery: 'speaking_pace' },
    }));
    log('info', 'session_create', 'esperando session_ready…');
  };
  ws.onmessage = onWsMessage;
  ws.onerror = () => { log('err', 'ws', 'error de conexión'); };
  ws.onclose = (e) => {
    log('evt', 'ws_close', `cerrado (${e.code})`);
    if (running) stop();
  };
}

function stop() {
  running = false;
  btnStop.disabled = true;
  btnStart.disabled = false;
  setStatus('idle', 'en reposo');

  try { if (ws && ws.readyState === WebSocket.OPEN) ws.close(); } catch {}
  ws = null;

  clearAudioOutput();

  try { if (workletNode) { workletNode.port.onmessage = null; workletNode.disconnect(); } } catch {}
  try { if (scriptNode) { scriptNode.onaudioprocess = null; scriptNode.disconnect(); } } catch {}
  try { if (micSource) micSource.disconnect(); } catch {}
  try { if (micStream) micStream.getTracks().forEach((t) => t.stop()); } catch {}
  try { if (micCtx) micCtx.close(); } catch {}
  workletNode = scriptNode = micSource = micStream = micCtx = null;

  log('info', 'fin', 'demo colgada');
  addNote('Llamada terminada');
  pillLine = '';
  renderPill();
  api('/api/session-end', {});
}

btnStart.addEventListener('click', start);
btnStop.addEventListener('click', stop);

// ---------- iframe del sitio (todo en una sola ventana) ----------
// Cada host de la web va en su propio origen local (www.x.com → http://www-x-com.localhost:3001), igual
// que en el servidor; si no se puede (http, puerto raro), por /proxy?url=.
const FRAME = { port: 0, site: '' };
function frameSrc(u) {
  try {
    const x = new URL(u);
    const h = x.hostname.toLowerCase();
    const enc = h.replace(/-/g, '--').replace(/\./g, '-');
    const inSite = FRAME.site && (h === FRAME.site || h.endsWith('.' + FRAME.site));
    if (FRAME.port && inSite && x.protocol === 'https:' && !x.port && enc.length <= 63) return `http://${enc}.localhost:${FRAME.port}${x.pathname}${x.search}${x.hash}`;
  } catch {}
  return '/proxy?url=' + encodeURIComponent(u);
}
// allow-same-origin solo para el origen local de la web (otro origen que esta app). Lo que va por
// /proxy?url= se sirve desde el mismo origen que la app y tiene que quedarse con origen opaco.
const SANDBOX = 'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation';
function showSite(u) {
  const src = frameSrc(u);
  siteFrame.setAttribute('sandbox', src.startsWith('http://') ? SANDBOX + ' allow-same-origin' : SANDBOX);
  siteFrame.src = src;
}
async function initSite() {
  let target = 'https://books.toscrape.com/';
  try {
    const r = await fetch('/api/config');
    const c = await r.json();
    if (c && c.targetUrl) target = c.targetUrl;
    if (c && c.framePort) { FRAME.port = c.framePort; FRAME.site = c.site || ''; }
  } catch {}
  visitorUrl = target;
  showSite(target);
}
window.addEventListener('message', (ev) => {
  if (ev.source !== siteFrame.contentWindow) return; // solo la pantalla de la web (no sus iframes ni ventanas)
  const d = ev.data || {};
  wake(d);
  if (d.type === 'tour_result') { tourEnded = !!d.end; return; }
  if (d.type === 'cookies') { log('info', 'cookies', d.how === 'rechazadas' ? 'aviso de cookies rechazado' : 'aviso de cookies ocultado'); return; }
  if (d.type === 'show_result') { if (!d.ok) log('info', 'mostrar', 'no está en esta página'); return; }
  if (d.type === 'page' && d.url) {
    lastPageAt = Date.now();
    tourEnded = false;
    holding = false;
    holdByBargeIn = false;
    visitorUrl = d.url;
    locEl.textContent = '📍 Estás en: '; const b = document.createElement('b'); b.textContent = d.title || d.url; locEl.appendChild(b);
    if (running) addNote('📍 ' + (d.title || d.url), 'nav');
    fetch('/api/visitor-url', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: d.url, title: d.title, via: d.via }) }).catch(() => {});
  } else if (d.type === 'highlight_result') {
    log('info', 'resaltar', d.ok ? 'resaltado ✓' : 'no encontrado en pantalla');
  } else if (d.type === 'click') {
    log('evt', 'clic', d.text || '');
  }
});

// ---------- la pantalla sigue a la voz ----------
// Cartesia manda el texto de la IA según lo genera (turn_output_text_delta), algo antes de que suene.
// Se parte en frases y cada una se manda a la web cuando le toca sonar, estimado por caracteres desde
// que empezó el audio del turno. La web va a la parte que coincide con lo que dice y la ilumina.
let lastDirectedAt = 0;
let lastPageAt = 0;
// Foco: «párate aquí», «explícame esto»… → la pantalla se queda; «sigue», «adelante» → la suelta.
const HOLD_RX = /\b(para(te)?|parate|espera|detente|quieto|stop|un momento|aqu[ií])\b|expl[ií]ca(me)?\s+(m[aá]s|esto|eso|bien)|qu[eé] es esto|esto (de|que)|m[aá]s (en )?detalle/i;
const GO_RX = /\b(sigue|seguimos|contin[uú]a|adelante|siguiente|vale,? (sigue|vamos)|vamos|pasa(mos)? a)\b/i;
let holding = false;
let holdByBargeIn = false;
function setHold(on, why) {
  if (holding === on) return;
  holding = on;
  try { siteFrame.contentWindow.postMessage({ type: 'hold', on }, '*'); } catch {}
  log('info', 'pantalla', on ? `parada aquí (${why})` : 'sigue a la voz');
}
let tourEnded = false;
const CHARS_PER_SEC = 15; // ritmo aproximado de la voz en español
const follow = { buf: '', chars: 0, queue: [], audioStart: null };
function followReset() { follow.buf = ''; follow.chars = 0; follow.queue = []; follow.audioStart = null; }
function followPush(sentence) {
  const s = sentence.trim();
  if (s.length < 4) return;
  follow.queue.push({ text: s, offset: follow.chars });
  follow.chars += s.length + 1;
}
function followDelta(text) {
  follow.buf += text;
  let m;
  while ((m = follow.buf.match(/^([\s\S]*?[.!?…:;])(\s+|$)/)) || follow.buf.length > 110) {
    if (m) { followPush(m[1]); follow.buf = follow.buf.slice(m[0].length); }
    else { const cut = follow.buf.lastIndexOf(',', 100); const n = cut > 30 ? cut + 1 : 100; followPush(follow.buf.slice(0, n)); follow.buf = follow.buf.slice(n); }
  }
}
setInterval(() => {
  if (!running || follow.audioStart == null || !follow.queue.length) return;
  const heard = ((Date.now() - follow.audioStart) / 1000) * CHARS_PER_SEC;
  while (follow.queue.length && follow.queue[0].offset <= heard + 8) {
    const item = follow.queue.shift();
    if (Date.now() - lastDirectedAt < 2500) continue; // acaba de usar «mostrar»: manda la IA
    try { siteFrame.contentWindow.postMessage({ type: 'follow', text: item.text }, '*'); } catch {}
  }
}, 200);

// ---------- transcripción ----------
function say(kind, who, text) {
  log(kind, who, text); // también en «Actividad», con todo lo técnico
  addMsg(kind === 'you' ? 'you' : 'ia', text);
}

// ---------- vistas: Demo · Web · Grafo · Conversación · Panel ----------
const VIEWS = ['demo', 'web', 'graph', 'chat', 'panel'];
function setView(v) {
  if (!VIEWS.includes(v)) v = 'demo';
  stage.dataset.view = v;
  document.querySelectorAll('button[data-view]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === v)));
  graphUi.setBig(v === 'graph');
  dashboard.activate(v === 'panel');
  if (v === 'chat') chatEl.scrollTop = chatEl.scrollHeight;
  try { localStorage.setItem('lz_view', v); } catch {}
}
document.querySelectorAll('button[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
document.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.goto)));
// Conversación o actividad técnica en la tarjeta del lateral
function setFeed(f) {
  document.querySelectorAll('[data-feed]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.feed === f)));
  chatEl.hidden = f !== 'chat';
  logEl.hidden = f !== 'log';
  if (f === 'log') logEl.scrollTop = logEl.scrollHeight;
}
document.querySelectorAll('[data-feed]').forEach((b) => b.addEventListener('click', () => setFeed(b.dataset.feed)));

// Pantalla completa: la vista que esté activa ocupa toda la pantalla (la web, el grafo, el panel…).
const fsbar = $('fsbar');
let fsTimer = 0;
function toggleFs() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else if (stage.requestFullscreen) stage.requestFullscreen().catch(() => {});
}
function peekFsBar() { fsbar.classList.add('show'); clearTimeout(fsTimer); fsTimer = setTimeout(() => fsbar.classList.remove('show'), 2500); }
$('fsBtn').addEventListener('click', toggleFs);
$('fsExit').addEventListener('click', () => document.exitFullscreen().catch(() => {}));
$('fshot').addEventListener('mouseenter', peekFsBar); // franja de arriba: también encima de la web
stage.addEventListener('mousemove', (e) => { if (document.fullscreenElement && e.clientY < 70) peekFsBar(); });
document.addEventListener('fullscreenchange', () => { if (document.fullscreenElement) peekFsBar(); });
// Atajos: 1-5 cambian de vista, F pantalla completa (Esc la quita).
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  const i = '12345'.indexOf(e.key);
  if (i >= 0) { e.preventDefault(); setView(VIEWS[i]); return; }
  if (e.key === 'f' || e.key === 'F') { e.preventDefault(); toggleFs(); }
});
let savedView = 'demo';
try { savedView = localStorage.getItem('lz_view') || 'demo'; } catch {}
setView(savedView);

// ---------- grafo en vivo (agente de mapeo) ----------
function onGraphEvent(ev) {
  switch (ev.type) {
    case 'hello': graphUi.reset(ev.graph); break;
    case 'explore_start': graphUi.reset({ app: { host: ev.host } }); predictEl.textContent = ''; FRAME.site = ev.host || FRAME.site; log('map', 'mapeo', `explorando ${ev.url}…`); break;
    case 'node': graphUi.addNode(ev.node); break;
    case 'edge': graphUi.addEdge(ev.edge); break;
    case 'log': break;
    case 'explore_done':
      graphUi.setTokens(ev.brainTokens);
      log('map', 'mapeo', `${ev.app.pages} páginas en ${ev.app.seconds} s · grafo para la voz: ~${ev.brainTokens} tokens`);
      FRAME.site = ev.app.host || FRAME.site;
      showSite(ev.app.startUrl);
      btnExplore.disabled = false;
      break;
    case 'ficha': {
      const f = ev.ficha || {};
      log('map', 'interpreta', `${f.que_es || '—'} · ${(f.funcionalidades || []).length} funcionalidades · ${ev.via}${ev.ms ? ` (${(ev.ms / 1000).toFixed(1)} s)` : ''}`);
      graphUi.setTokens(ev.brainTokens);
      break;
    }
    case 'explore_error': log('err', 'mapeo', ev.error); btnExplore.disabled = false; break;
    case 'pushed': log(ev.ok ? 'map' : 'err', 'voz', ev.ok ? 'grafo cargado en el agente de la demo' : (ev.skipped || ev.error)); break;
    case 'current': graphUi.setCurrent(ev.id); break;
    case 'insights': {
      const r = ev.report || {};
      log('map', 'interés', r.resumen || 'sin datos');
      const tops = (r.paginas || []).slice(0, 3).map((p) => `${p.title.slice(0, 22)} ${p.interes}`).join(' · ');
      if (tops) log('map', 'páginas', tops);
      if ((r.pain || []).length) log('map', 'pain', r.pain.slice(0, 2).join(' | '));
      if (r.perfil && Object.keys(r.perfil).length) log('map', 'perfil', Object.entries(r.perfil).map(([k, v]) => `${k}: ${v.join(', ')}`).join(' · '));
      dashboard.show(r); // al colgar, el informe en la vista Panel
      setView('panel');
      break;
    }
    case 'deep': graphUi.setDeep(ev.id, ev.state); break;
    case 'predict':
      graphUi.setProbable(ev.items.map((i) => i.id));
      predictEl.textContent = ev.items.length ? 'Probable: ' + ev.items.map((i) => `${graphUi.title(i.id).slice(0, 18)} ${i.p}%`).join(' · ') : '';
      break;
  }
}
const events = new EventSource('/api/events');
events.onmessage = (m) => { try { onGraphEvent(JSON.parse(m.data)); } catch {} };

const btnExplore = $('btnExplore');
$('btnReport').addEventListener('click', (e) => { e.preventDefault(); setView('panel'); });
$('siteForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = $('siteUrl').value.trim();
  if (!/^https?:\/\//i.test(url)) { log('err', 'mapeo', 'escribe una URL que empiece por https://'); return; }
  btnExplore.disabled = true;
  const r = await fetch('/api/explore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
  if (!r.ok) { const j = await r.json().catch(() => ({})); log('err', 'mapeo', j.error || 'no se pudo explorar'); btnExplore.disabled = false; }
});

// Para probar sin voz: await lazarilloTool('ir_a', { destino: 'Clientes' })
window.lazarilloTool = async (name, parameters = {}) => {
  if (name === 'ir_a') return irA(parameters.destino || '');
  if (name === 'pantalla_actual') return api('/api/current');
  if (name === 'resaltar') { siteFrame.contentWindow.postMessage({ type: 'highlight', text: parameters.texto }, '*'); return { ok: true }; }
  return { error: 'desconocida' };
};
window.lazarilloHint = (text, role = 'user') => api('/api/hint', { text, role });

// estado inicial
setStatus('idle', 'en reposo');
log('info', 'listo', 'pulsa «Empezar demo» para hablar');
initSite();
