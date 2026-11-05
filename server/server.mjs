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
import { Readable } from 'node:stream';
import { isPublicUrl, safeFetch, fetchOnce } from '../explorer/netguard.mjs';

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
loadEnv('.env'); // cada uno con su clave de Cartesia: la de la demo del hackathon es privada y no va en esta rama

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
function bridge(originalUrl, proxyOrigin, frame = null) {
  return `(function(ORIGINAL_URL, PROXY, FRAME){\n${bridgeSrc()}\n})(${jsLit(originalUrl)}, ${jsLit(proxyOrigin)}, ${frame ? JSON.stringify(frame).replace(/</g, '\\u003c') : 'null'});`;
}

// ---------- cada web en su propio origen (proxy inverso) ----------
// Cada host de la web explorada se sirve desde un origen local propio:
//   https://www.capcut.com/es-es  →  http://www-capcut-com.localhost:3001/es-es
// (Chrome resuelve *.localhost a este ordenador sin DNS). Así la página y sus scripts, estilos,
// fuentes y llamadas a su API son del mismo origen, como en la web real; las cookies y el
// localStorage funcionan, y el router de una SPA ve su ruta de verdad. Antes la página vivía en un
// origen «null» con <base> a la web real: el navegador bloqueaba por CORS sus módulos, CSS y fuentes,
// y las webs que leen document.cookie se caían (pantalla en blanco). Es otro origen distinto de la
// app (localhost:3000), así que sus scripts no pueden leer la app ni usar /api.
const FRAME_PORT = Number(process.env.FRAME_PORT) || Number(PORT) + 1;
const encHost = (h) => h.replace(/-/g, '--').replace(/\./g, '-'); // www.cap-cut.com → www-cap--cut-com
const decHost = (l) => l.replace(/--|-/g, (m) => (m === '--' ? '-' : '.'));
const siteHost = () => graph.getMap().app.host || '';
const inSite = (h, site = siteHost()) => !!site && !!h && (h === site || h.endsWith('.' + site));
const frameHost = (h) => `${encHost(h)}.localhost:${FRAME_PORT}`;
/** URL real → URL en su origen local, o null si no se puede (otra web, http, puerto raro). */
function frameUrl(u) {
  try {
    const x = new URL(u);
    if (x.protocol !== 'https:' || x.port || !inSite(x.hostname) || encHost(x.hostname).length > 63) return null;
    return `http://${frameHost(x.hostname)}${x.pathname}${x.search}${x.hash}`;
  } catch { return null; }
}
/** Host local (www-capcut-com.localhost:3001) → host real, solo si es de la web cargada. */
function upstreamHost(hostHeader) {
  const m = /^([a-z0-9-]+)\.localhost:(\d+)$/i.exec(hostHeader || '');
  if (!m || Number(m[2]) !== FRAME_PORT) return null;
  const h = decHost(m[1].toLowerCase());
  return inSite(h) ? h : null;
}
/** En el texto de la web, sus direcciones absolutas (https://, //, https:\/\/) pasan a su origen local. */
function rewriteSite(text, site = siteHost()) {
  if (!site || !text.includes(site)) return text;
  const rx = new RegExp(String.raw`(https?:)?(\/\/|\\\/\\\/)((?:[a-z0-9-]+\.)*` + site.replace(/[.]/g, '\\.') + String.raw`)(?![a-z0-9.:-])`, 'gi');
  return text.replace(rx, (all, scheme, sl, host) => {
    host = host.toLowerCase();
    if (encHost(host).length > 63) return all;
    return (scheme ? 'http:' : '') + sl + frameHost(host);
  });
}
function decodeHtml(buf, ct) {
  const cs = (/charset=["']?([\w-]+)/i.exec(ct || '') || [])[1] || (/<meta[^>]+charset=["']?([\w-]+)/i.exec(buf.subarray(0, 4096).toString('latin1')) || [])[1] || 'utf-8';
  try { return new TextDecoder(cs).decode(buf); } catch { return buf.toString('utf8'); }
}
// Sin service workers: se quedarían en el origen local y servirían páginas viejas de esta web.
const NO_SW = '<script>(function(){try{var s=navigator.serviceWorker;if(!s)return;s.register=function(){return Promise.reject(new Error("Lazarillo: sin service workers"))};s.getRegistrations().then(function(r){r.forEach(function(x){x.unregister()})}).catch(function(){})}catch(e){}})();</script>';
const FRAME_CSP = 'sandbox allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation';
// Los datos de React Server Components (self.__next_f) llevan la longitud de cada texto delante: si se
// reescriben, React no los puede leer («Connection closed») y la página se queda a medias. Se dejan tal cual;
// sus enlaces a la web real los reconduce el puente al navegar.
function rewriteHtml(html) {
  const keep = [];
  const masked = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (m) => (m.includes('__next_f') ? `\u0000LZ${keep.push(m) - 1}\u0000` : m));
  return rewriteSite(masked).replace(/\u0000LZ(\d+)\u0000/g, (_, i) => keep[+i]);
}
function framePage(html, realUrl) {
  const $ = cheerio.load(rewriteHtml(html));
  $('meta[http-equiv]').each((_, el) => {
    const v = ($(el).attr('http-equiv') || '').toLowerCase();
    if (v.includes('content-security-policy') || v.includes('x-frame-options') || v === 'content-type') $(el).remove();
  });
  $('meta[charset]').remove();
  $('[integrity]').removeAttr('integrity'); // el texto se ha reescrito: su huella ya no coincide
  if (!$('head').length) $.root().prepend('<head></head>');
  $('head').prepend(`<meta charset="utf-8">${NO_SW}`);
  $('body').append(`<script>${bridge(realUrl, `http://localhost:${PORT}`, { port: FRAME_PORT, site: siteHost() })}</script>`);
  return $.html();
}
const DROP_REQ = new Set(['host', 'cookie', 'connection', 'content-length', 'accept-encoding', 'origin', 'referer', 'keep-alive', 'transfer-encoding', 'upgrade', 'te', 'trailer', 'service-worker']);
const DROP_RES = new Set(['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'keep-alive', 'set-cookie', 'content-security-policy', 'content-security-policy-report-only', 'x-frame-options', 'strict-transport-security', 'cross-origin-opener-policy', 'cross-origin-embedder-policy', 'cross-origin-resource-policy', 'report-to', 'reporting-endpoints', 'nel', 'link', 'clear-site-data', 'alt-svc', 'permissions-policy', 'origin-agent-cluster', 'location']);
/** URL u origen local → el real (para Origin y Referer hacia la web). */
function toUpstream(v, originOnly) {
  try { const x = new URL(v); const h = upstreamHost(x.host); return h ? (originOnly ? `https://${h}` : `https://${h}${x.pathname}${x.search}`) : null; } catch { return null; }
}

/** Página en lugar de una pantalla en blanco cuando algo no se puede abrir dentro de la demo. */
function outside(res, url, why) {
  const safe = String(url).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': FRAME_CSP, 'Cache-Control': 'no-store' });
  res.end(`<!doctype html><meta charset="utf-8"><body style="font:16px system-ui;padding:40px;color:#333">${why} <a href="${safe}" target="_blank" rel="noopener">Abrirla en una pestaña nueva ↗</a></body>`);
}

async function frameHandler(req, res) {
  const host = upstreamHost(req.headers.host);
  if (!host) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Esta web no es la que está cargada en Lazarillo.'); }
  if (req.headers['service-worker']) { res.writeHead(404); return res.end(); }
  const target = `https://${host}${req.url}`;
  const dest = req.headers['sec-fetch-dest'] || '';
  const isDoc = dest === 'iframe' || dest === 'document';
  const method = req.method || 'GET';
  let body;
  if (method !== 'GET' && method !== 'HEAD') {
    const chunks = [];
    let n = 0;
    for await (const c of req) { n += c.length; if (n > 5e6) { res.writeHead(413); return res.end(); } chunks.push(c); }
    body = Buffer.concat(chunks);
  }
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) if (!DROP_REQ.has(k) && !k.startsWith('proxy-')) headers[k] = v;
  const o = req.headers.origin && toUpstream(req.headers.origin, true);
  if (o) headers.origin = o;
  const ref = req.headers.referer && toUpstream(req.headers.referer);
  if (ref) headers.referer = ref;

  // La página que el agente de mapeo ya ha descargado se sirve al momento.
  const hit = isDoc && method === 'GET' ? cachedHtml(target) : null;
  if (hit && hit.url === target) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': FRAME_CSP, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
    return res.end(framePage(hit.html, target));
  }
  let r;
  try { r = await fetchOnce(target, { method, headers, body, timeoutMs: isDoc ? 15000 : 60000 }); }
  catch (e) {
    const blocked = e && e.code === 'EBLOCKED';
    if (!blocked) console.error(`  [pantalla] ${target.slice(0, 100)}: ${(e && e.cause && e.cause.message) || (e && e.message)}`);
    res.writeHead(blocked ? 403 : 502, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end(blocked ? 'solo webs públicas' : 'No se ha podido cargar esta página.');
  }
  // Cloudflare a veces frena las peticiones del servidor (no las de un navegador). Un recurso frenado lo
  // pide el navegador directamente a la web, como antes; una página frenada se ofrece en una pestaña aparte.
  if (r.headers.get('cf-mitigated')) {
    try { await r.body?.cancel(); } catch {}
    if (!isDoc) { res.writeHead(307, { Location: target }); return res.end(); }
    return outside(res, target, 'Esta web no deja que se abra dentro de la demo.');
  }
  const out = {};
  for (const [k, v] of r.headers) if (!DROP_RES.has(k)) out[k] = v;
  const acao = r.headers.get('access-control-allow-origin');
  if (acao && acao !== '*') { try { const h = new URL(acao).hostname; if (inSite(h)) out['access-control-allow-origin'] = `http://${frameHost(h)}`; } catch {} }
  const loc = r.status >= 300 && r.status < 400 ? r.headers.get('location') : null;
  if (loc) {
    try { await r.body?.cancel(); } catch {}
    const abs = new URL(loc, target).href;
    const f = frameUrl(abs);
    if (!f && isDoc) return outside(res, abs, 'Esta página está en otra web.'); // en vez de dejar la pantalla en blanco
    res.writeHead(r.status, { ...out, Location: f || abs });
    return res.end();
  }
  const ct = r.headers.get('content-type') || '';
  if (isDoc && /text\/html|application\/xhtml/i.test(ct)) {
    const html = decodeHtml(Buffer.from(await r.arrayBuffer()), ct);
    res.writeHead(r.status, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': FRAME_CSP, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
    return res.end(framePage(html, target));
  }
  // Scripts, estilos y JSON: sus direcciones a la web, al origen local (no las de React Server
  // Components, text/x-component: van con longitudes y se romperían).
  if (method !== 'HEAD' && r.body && /javascript|ecmascript|text\/css|json|text\/html/i.test(ct) && !/charset=(?!utf-?8)/i.test(ct)) {
    const text = rewriteSite(Buffer.from(await r.arrayBuffer()).toString('utf8'));
    res.writeHead(r.status, out);
    return res.end(text);
  }
  res.writeHead(r.status, out);
  if (method === 'HEAD' || !r.body) return res.end();
  Readable.fromWeb(r.body).on('error', () => res.destroy()).pipe(res);
}
const frameServer = http.createServer((req, res) => {
  frameHandler(req, res).catch((e) => {
    console.error(`  [pantalla] ${req.headers.host}${req.url.slice(0, 80)}: ${e && e.message}`);
    try { if (!res.headersSent) res.writeHead(502); res.end(); } catch {}
  });
});

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
function body(req) { return new Promise((r) => { let b = ''; req.on('data', (c) => { b += c; if (b.length > 1e6) { req.destroy(); r({}); } }); req.on('end', () => { try { r(b ? JSON.parse(b) : {}); } catch { r({}); } }); }); }
function serveStatic(req, res) {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';
  const file = path.join(WEB, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(WEB) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  // Las páginas de la app no se pueden meter en un iframe (ni en el de la web explorada).
  const noFrame = path.extname(file) === '.html' ? { 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "frame-ancestors 'none'" } : {};
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', ...noFrame });
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
    if (url === '/api/config' && req.method === 'GET') return sendJson(res, 200, { targetUrl: TARGET_URL(), agenteMejoras: !!AGENT_MEJORAS, framePort: frameOk ? FRAME_PORT : 0, site: siteHost() });
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
    // Lo que se ve en la pantalla de la demo (la página ya pintada): detalle de la página y enlaces nuevos.
    if (url === '/api/rendered' && req.method === 'POST') {
      const { url: u, data } = await body(req);
      const r = graph.setRendered(typeof u === 'string' ? u : '', data && typeof data === 'object' ? data : {});
      return sendJson(res, 200, r ? { ok: true, ...r } : { ok: false });
    }
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

// Si el puerto de la pantalla está ocupado, la app sigue con /proxy?url= (framePort 0 en /api/config).
let frameOk = false;
frameServer.on('listening', () => { frameOk = true; });
frameServer.on('error', (e) => console.error(`  ⚠  Pantalla: no se puede usar el puerto ${FRAME_PORT} (${e.code || e.message}); las webs irán por /proxy.`));
frameServer.listen(FRAME_PORT, '127.0.0.1');
server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  Lazarillo v2 → http://localhost:${PORT}  (Chrome)`);
  console.log(`  web: ${TARGET_URL()}   token.mjs: ${token.__missing ? '✗' : '✓'}   agente de mejoras: ${AGENT_MEJORAS ? '✓' : '✗ (los mapas no se cargan en la voz)'}`);
  if (!process.env.CARTESIA_API_KEY) console.log('  ⚠  Falta CARTESIA_API_KEY: copia .env.example a .env y pon tu clave (https://play.cartesia.ai/keys), luego npm run setup.');
});
