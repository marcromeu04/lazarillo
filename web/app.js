// Lazarillo v2 — voz web (P1). Vanilla JS, sin build, sin deps.
// Flujo: POST /api/token → WS Cartesia → session_create → session_ready →
// micro (AudioWorklet) → audio_input; audio_output → altavoz; client tools.

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

function setStatus(kind, text) {
  dot.className = 'dot ' + kind;
  statusText.textContent = text;
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
    playCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SR });
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
    if (tool_name === 'pantalla_actual') {
      const r = await fetch('/api/current');
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { reply(JSON.stringify(data), true); log('err', 'pantalla_actual', 'HTTP ' + r.status); return; }
      reply(JSON.stringify(data), false);
      log('info', 'pantalla_actual', data && data.pantalla ? data.pantalla.title : 'ok');
      return;
    }
    if (tool_name === 'resaltar') {
      const texto = parameters && parameters.texto;
      const r = await fetch('/api/highlight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: texto }),
      });
      const data = await r.json().catch(() => ({}));
      log('info', 'resaltar', `«${texto}» → ${data && data.found ? 'encontrado' : 'no encontrado'}`);
      reply(JSON.stringify(data), false); // inofensivo si expects_response=false
      return;
    }
    if (tool_name === 'ir_a') {
      const destino = parameters && parameters.destino;
      const r = await fetch('/api/navigate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ destino }),
      });
      const data = await r.json().catch(() => ({}));
      log('info', 'ir_a', `«${destino}» → ${data && data.ok ? (data.pantalla && data.pantalla.title) || 'ok' : data.error || 'error'}`);
      reply(JSON.stringify(data), !data.ok);
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
      if (msg.audio) playAudioOutput(msg.audio);
      break;
    case 'audio_output_clear':
      log('evt', 'audio_clear', 'interrupción');
      clearAudioOutput();
      break;
    case 'client_tool_call':
      handleToolCall(msg);
      break;
    case 'error':
      log('err', 'error', msg.message || JSON.stringify(msg));
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
}

btnStart.addEventListener('click', start);
btnStop.addEventListener('click', stop);

// estado inicial
setStatus('idle', 'en reposo');
log('info', 'listo', 'pulsa «Empezar demo» para hablar');
