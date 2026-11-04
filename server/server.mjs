// Lazarillo v2 — servidor local (node:http). Sirve web/, el proxy del sitio a
// explorar (para verlo DENTRO de la página) y las rutas del contrato.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';
import * as graph from '../explorer/graph.mjs';
import { cachedHtml } from '../explorer/deep.mjs';
import * as tracker from '../insights/tracker.mjs';
import { isPublicUrl, safeFetch } from '../explorer/netguard.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const WEB = path.join(ROOT, 'web');

function loadEnv(file) {
  try {
    const raw = fs.readFileSync(path.join(ROOT, file), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch {}
}
loadEnv('.env');
loadEnv('.env.demo');

const PORT = process.env.PORT || 3000;
// Mejoras: la voz usa un agente propio si existe (CARTESIA_AGENT_ID_MEJORAS). El de la
// entrega (CARTESIA_AGENT_ID) nunca se reescribe desde aquí.
const AGENT_MEJORAS = process.env.CARTESIA_AGENT_ID_MEJORAS || '';
if (AGENT_MEJORAS) process.env.CARTESIA_AGENT_ID = AGENT_MEJORAS;
graph.loadInitial();
graph.ensureFicha().catch(() => {}); // si la web cargada no tiene ficha, se interpreta en segundo plano
const TARGET_URL = () => graph.targetUrl() || process.env.TARGET_URL || 'https://books.toscrape.com/';
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

async function load(mod) {
  try { return await import(mod); }
  catch (e) { return { __missing: true, __err: String(e.message || e) }; }
}
const token = await load('./token.mjs');

// ---------- proxy del sitio + bridge inyectado ----------
// Puente inyectado en cada página del proxy: server/bridge.js, JS normal (sin escapar nada a mano).
// Las dos cadenas van con «<» escapado para que una URL no pueda cerrar el <script> en línea.
// Se relee si cambia el fichero, as\u00ed un ajuste del puente se aplica al recargar la p\u00e1gina.
const BRIDGE_FILE = path.join(__dirname, 'bridge.js');
let bridgeCache = { mtime: 0, src: '' };
function bridgeSrc() {
  const mtime = fs.statSync(BRIDGE_FILE).mtimeMs;
  if (mtime !== bridgeCache.mtime) bridgeCache = { mtime, src: fs.readFileSync(BRIDGE_FILE, 'utf8') };
  return bridgeCache.src;
}
const jsLit = (v) => JSON.stringify(String(v)).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
function bridge(originalUrl, proxyOrigin) {
  return `(function(ORIGINAL_URL, PROXY){\n${bridgeSrc()}\n})(${jsLit(originalUrl)}, ${jsLit(proxyOrigin)});`;
}

async function proxyHandler(req, res, target) {
  let r;
  if (!/^https?:\/\//i.test(target)) { res.writeHead(400); return res.end('solo http(s)'); }
  const site = graph.getMap().app.host;
  const h = (() => { try { return new URL(target).hostname.replace(/^www\./, ''); } catch { return ''; } })();
  if (!site || !(await isPublicUrl(target))) { res.writeHead(403); return res.end('solo webs públicas'); }
  if (h !== site && !h.endsWith('.' + site)) { res.writeHead(302, { Location: target }); return res.end(); } // enlace a otra web: se abre fuera del proxy
  let html;
  const hit = cachedHtml(target) || cachedHtml(target.replace(/\/$/, ''));
  if (hit) { html = hit.html; r = { url: hit.url }; }
  else {
    let finalUrl;
    try { ({ res: r, url: finalUrl } = await safeFetch(target, { timeoutMs: 12000, headers: { 'User-Agent': CHROME_UA, 'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8' } })); }
    catch (e) { res.writeHead(e && e.code === 'EBLOCKED' ? 403 : 502); return res.end(e && e.code === 'EBLOCKED' ? 'solo webs públicas' : 'proxy fetch failed'); }
    const ct = r.headers.get('content-type') || '';
    if (!ct.includes('html')) { try { await r.body?.cancel(); } catch {} res.writeHead(302, { Location: finalUrl }); return res.end(); }
    html = await r.text();
    r = { url: finalUrl };
  }
  const $ = cheerio.load(html);
  $('meta[http-equiv]').each((_, el) => {
    const v = ($(el).attr('http-equiv') || '').toLowerCase();
    if (v.includes('content-security-policy') || v.includes('x-frame-options')) $(el).remove();
  });
  const proxyOrigin = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;
  const base = `<base href="${r.url || target}">`;
  if ($('head').length) $('head').prepend(base); else $.root().prepend(`<head>${base}</head>`);
  $('body').append(`<script>${bridge(r.url || target, proxyOrigin)}</script>`);
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    // Sin allow-same-origin: los scripts de la web explorada no pueden tocar /api ni leer esta app.
    'Content-Security-Policy': 'sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end($.html());
}

// ---------- utilidades HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
function sendJson(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); }
function body(req) { return new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { try { r(b ? JSON.parse(b) : {}); } catch { r({}); } }); }); }
function serveStatic(req, res) {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';
  const file = path.join(WEB, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(WEB) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

// ---------- eventos en vivo para el panel (SSE) ----------
const clients = new Set();
const broadcast = (ev) => { const line = `data: ${JSON.stringify(ev)}\n\n`; for (const c of clients) c.write(line); };
graph.onEvent(broadcast);
// Trazabilidad: cada página visitada abre un tramo de la sesión.
const pageOf = (id) => graph.graphView().nodes.find((n) => n.id === id);
graph.onEvent((ev) => {
  if (ev.type !== 'current') return;
  const n = pageOf(ev.id);
  if (n) { tracker.enterPage({ id: n.id, title: n.title, path: n.path }); graph.setInterestScores(tracker.liveInterest()); }
});

async function pushToAgent(brain) {
  if (!AGENT_MEJORAS) return { ok: false, skipped: 'Sin CARTESIA_AGENT_ID_MEJORAS: el mapa no se carga en ningún agente (el de la entrega no se toca).' };
  try {
    const { pushBrain } = await import('../cartesia/push-brain.mjs');
    const r = await pushBrain(AGENT_MEJORAS, brain);
    return { ok: true, chars: r.instructionsLength };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
}

const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  const q = new URLSearchParams(req.url.split('?')[1] || '');
  // Solo esta app puede usar /api y /proxy: otra web abierta en el navegador no puede manejarla.
  if (url.startsWith('/api/') || url === '/proxy') {
    const allowed = [`localhost:${PORT}`, `127.0.0.1:${PORT}`];
    const origin = req.headers.origin;
    const fetchSite = req.headers['sec-fetch-site'];
    if (!allowed.includes(req.headers.host || '') || (origin && !allowed.some((h) => origin === `http://${h}`)) || (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none' && url !== '/proxy')) return sendJson(res, 403, { error: 'origen no permitido' });
  }
  try {
    if (url === '/proxy') return proxyHandler(req, res, q.get('url') || TARGET_URL());
    if (url === '/api/config' && req.method === 'GET') return sendJson(res, 200, { targetUrl: TARGET_URL(), agenteMejoras: !!AGENT_MEJORAS });
    if (url === '/api/token' && req.method === 'POST') {
      if (token.__missing || !token.createToken) return sendJson(res, 503, { error: 'token.mjs no disponible' });
      graph.resetSession();
      tracker.startSession(graph.getMap().app.host);
      const cur = pageOf(graph.graphView().current);
      if (cur) tracker.enterPage({ id: cur.id, title: cur.title, path: cur.path });
      return sendJson(res, 200, await token.createToken());
    }
    if (url === '/api/graph' && req.method === 'GET') return sendJson(res, 200, graph.graphView());
    if (url === '/api/events' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(`data: ${JSON.stringify({ type: 'hello', graph: graph.graphView() })}\n\n`);
      clients.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 20000);
      req.on('close', () => { clearInterval(ping); clients.delete(res); });
      return;
    }
    if (url === '/api/explore' && req.method === 'POST') {
      const { url: u, max } = await body(req);
      if (!/^https?:\/\//i.test(u || '')) return sendJson(res, 400, { error: 'La URL tiene que empezar por http:// o https://' });
      if (!(await isPublicUrl(u))) return sendJson(res, 400, { error: 'Solo se pueden explorar webs públicas (nada de localhost ni de tu red)' });
      if (graph.isExploring()) return sendJson(res, 409, { error: 'Ya hay una exploración en marcha' });
      graph.explore(u, { max: Math.min(Number(max) || 40, 80) })
        .then(async ({ brain }) => broadcast({ type: 'pushed', ...(await pushToAgent(brain)) }))
        .catch(() => {});
      return sendJson(res, 202, { ok: true });
    }
    if (url === '/api/visitor-url' && req.method === 'POST') {
      const { url: u, title, via } = await body(req);
      const s = u ? graph.setVisitor(u, { title, via }) : null;
      return sendJson(res, 200, { ok: true, id: s && s.id });
    }
    if (url === '/api/current' && req.method === 'GET') return sendJson(res, 200, await graph.context());
    if (url === '/api/hint' && req.method === 'POST') {
      const { text, role } = await body(req);
      const r = role === 'assistant' ? 'assistant' : 'user';
      tracker.addTurn(r, String(text || ''));
      graph.setInterestScores(tracker.liveInterest()); // por detrás: solo para predecir
      graph.noteTurn(r, String(text || '')); // y el modelo de mapeo afina la predicción en segundo plano
      return sendJson(res, 200, { probables: graph.predict(String(text || '').slice(0, 600), r) });
    }
    if (url === '/api/session-end' && req.method === 'POST') {
      const r = tracker.endSession();
      if (r) { const { transcripcion, ...resumen } = r; broadcast({ type: 'insights', report: resumen }); }
      return sendJson(res, 200, r || {});
    }
    if (url === '/api/insights' && req.method === 'GET') return sendJson(res, 200, tracker.report() || {});
    if (url === '/api/insights/todas' && req.method === 'GET') return sendJson(res, 200, tracker.aggregate(graph.getMap().app.host));
    if (url === '/api/suggest' && req.method === 'GET') return sendJson(res, 200, { siguientes: graph.suggest() });
    if (url === '/api/resolve' && req.method === 'POST') {
      const { destino } = await body(req);
      const s = graph.resolveTarget(destino || '');
      return sendJson(res, 200, s ? { ok: true, id: s.id, url: s.url } : { ok: false });
    }
    if (url === '/api/highlight' && req.method === 'POST') { const { text } = await body(req); return sendJson(res, 200, { ok: true, text }); } // el resaltado real lo hace el iframe (cliente)
    if (url === '/api/open' && req.method === 'POST') { const { url: u } = await body(req); if (u) graph.setVisitor(u); return sendJson(res, 200, { ok: true }); }
    if (req.method === 'GET') return serveStatic(req, res);
    res.writeHead(404); res.end('not found');
  } catch (e) { sendJson(res, 500, { error: String(e.message || e) }); }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  Lazarillo v2 → http://localhost:${PORT}  (Chrome)`);
  console.log(`  web: ${TARGET_URL()}   token.mjs: ${token.__missing ? '✗' : '✓'}   agente de mejoras: ${AGENT_MEJORAS ? '✓' : '✗ (los mapas no se cargan en la voz)'}`);
  if (!process.env.CARTESIA_API_KEY) console.log('  ⚠  Falta CARTESIA_API_KEY (está en .env.demo).');
});
