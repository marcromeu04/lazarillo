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
const TARGET_URL = () => graph.targetUrl() || process.env.TARGET_URL || 'https://books.toscrape.com/';
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

async function load(mod) {
  try { return await import(mod); }
  catch (e) { return { __missing: true, __err: String(e.message || e) }; }
}
const token = await load('./token.mjs');

// ---------- proxy del sitio + bridge inyectado ----------
function bridge(originalUrl, proxyOrigin) {
  return `(function(){
  var ORIGINAL_URL=${JSON.stringify(originalUrl)}, PROXY=${JSON.stringify(proxyOrigin)};
  function prox(h){ try{ return PROXY+'/proxy?url='+encodeURIComponent(new URL(h,ORIGINAL_URL).href);}catch(e){return null;} }
  function post(m){ try{ parent.postMessage(m,'*'); }catch(e){} }
  var LAST=''; try{ LAST=sessionStorage.getItem('lz_via')||''; sessionStorage.removeItem('lz_via'); }catch(e){}
  window.addEventListener('load',function(){ post({type:'page',url:ORIGINAL_URL,title:document.title,via:LAST}); });
  document.addEventListener('click',function(e){
    var a=e.target.closest?e.target.closest('a[href]'):null;
    if(a){ var h=a.getAttribute('href'); if(h&&!/^(mailto:|tel:|javascript:|#)/i.test(h)){ var p=prox(h); if(p){ e.preventDefault(); e.stopPropagation(); var tx=(a.innerText||'').trim().slice(0,80); try{ sessionStorage.setItem('lz_via',tx.slice(0,40)); }catch(e){} post({type:'click',text:tx}); location.href=p; return; } } }
  },true);
  function norm(s){ return (s||'').toLowerCase().replace(/\\s+/g,' ').trim(); }
  function find(text){
    var want=norm(text), els=document.querySelectorAll('a,button,[role=button],[role=tab],h1,h2,h3,label,li,input'), best=null,bs=0;
    for(var i=0;i<els.length;i++){ var el=els[i], r=el.getBoundingClientRect(); if(r.width===0||r.height===0) continue;
      var t=norm(el.innerText||el.textContent||el.value||el.placeholder||el.getAttribute('aria-label')); if(!t||t.length>120) continue;
      var sc=0; if(t===want)sc=100; else if(t.indexOf(want)>=0)sc=70; else if(want.indexOf(t)>=0&&t.length>3)sc=50; else{ var w=want.split(' '),h=0; for(var k=0;k<w.length;k++) if(w[k].length>2&&t.indexOf(w[k])>=0)h++; sc=h*14; }
      if(/^(a|button)$/i.test(el.tagName)||el.getAttribute('role')) sc+=5;
      if(sc>bs){bs=sc;best=el;} }
    return bs>=14?best:null;
  }
  function ring(el,ms){
    var ringEl=document.createElement('div');
    ringEl.style.cssText='position:fixed;z-index:2147483647;pointer-events:none;border:3px solid #a855f7;border-radius:12px;box-shadow:0 0 0 4px rgba(168,85,247,.35),0 0 24px 8px rgba(168,85,247,.6);animation:lzp 1s infinite';
    if(!document.getElementById('lzs')){ var st=document.createElement('style'); st.id='lzs'; st.textContent='@keyframes lzp{0%,100%{opacity:1}50%{opacity:.45}}'; document.head.appendChild(st); }
    function place(){ var rr=el.getBoundingClientRect(); ringEl.style.left=(rr.left-6)+'px';ringEl.style.top=(rr.top-6)+'px';ringEl.style.width=(rr.width+12)+'px';ringEl.style.height=(rr.height+12)+'px'; }
    place(); document.body.appendChild(ringEl); var iv=setInterval(place,120); setTimeout(function(){ clearInterval(iv); ringEl.remove(); },ms);
  }
  function clickText(text){
    var el=find(text);
    if(!el){ post({type:'click_result',ok:false,text:text}); return; }
    el.scrollIntoView({behavior:'smooth',block:'center'}); ring(el,900);
    setTimeout(function(){
      var a=el.closest?el.closest('a[href]'):null, label=(el.innerText||el.value||'').trim().slice(0,40);
      post({type:'click_result',ok:true,text:label,nav:!!(a&&a.getAttribute('href')&&!/^(#|javascript:)/i.test(a.getAttribute('href')))});
      el.click();
    },550);
  }
  function hi(text){
    var want=norm(text), els=document.querySelectorAll('a,button,[role=button],h1,h2,h3,label,li,input'), best=null,bs=0;
    for(var i=0;i<els.length;i++){ var el=els[i], r=el.getBoundingClientRect(); if(r.width===0||r.height===0) continue;
      var t=norm(el.innerText||el.textContent||el.value||el.placeholder||el.getAttribute('aria-label')); if(!t||t.length>120) continue;
      var sc=0; if(t===want)sc=100; else if(t.indexOf(want)>=0)sc=70; else if(want.indexOf(t)>=0&&t.length>3)sc=50; else{ var w=want.split(' '),h=0; for(var k=0;k<w.length;k++) if(w[k].length>2&&t.indexOf(w[k])>=0)h++; sc=h*14; }
      if(sc>bs){bs=sc;best=el;} }
    if(!best||bs<14){ post({type:'highlight_result',ok:false}); return; }
    best.scrollIntoView({behavior:'smooth',block:'center'});
    var ring=document.createElement('div');
    ring.style.cssText='position:fixed;z-index:2147483647;pointer-events:none;border:3px solid #a855f7;border-radius:12px;box-shadow:0 0 0 4px rgba(168,85,247,.35),0 0 24px 8px rgba(168,85,247,.6);animation:lzp 1s infinite';
    var chip=document.createElement('div'); chip.textContent='aquí';
    chip.style.cssText='position:fixed;z-index:2147483647;pointer-events:none;background:#a855f7;color:#fff;font:600 13px system-ui;padding:3px 10px;border-radius:999px;transform:translateY(-120%);box-shadow:0 4px 12px rgba(0,0,0,.3)';
    if(!document.getElementById('lzs')){ var st=document.createElement('style'); st.id='lzs'; st.textContent='@keyframes lzp{0%,100%{opacity:1}50%{opacity:.45}}'; document.head.appendChild(st); }
    function place(){ var rr=best.getBoundingClientRect(); ring.style.left=(rr.left-6)+'px';ring.style.top=(rr.top-6)+'px';ring.style.width=(rr.width+12)+'px';ring.style.height=(rr.height+12)+'px'; chip.style.left=rr.left+'px';chip.style.top=(rr.top-4)+'px'; }
    place(); document.body.appendChild(ring); document.body.appendChild(chip);
    var iv=setInterval(place,200); setTimeout(function(){ clearInterval(iv); ring.remove(); chip.remove(); },4000);
    post({type:'highlight_result',ok:true});
  }
  window.addEventListener('message',function(e){ var d=e.data||{}; if(d.type==='highlight') hi(d.text); else if(d.type==='click') clickText(d.text); else if(d.type==='go'&&d.url){ var p=prox(d.url); if(p) location.href=p; } });
})();`;
}

async function proxyHandler(req, res, target) {
  let r;
  if (!/^https?:\/\//i.test(target)) { res.writeHead(400); return res.end('solo http(s)'); }
  const site = graph.getMap().app.host;
  const h = (() => { try { return new URL(target).hostname.replace(/^www\./, ''); } catch { return ''; } })();
  if (site && h !== site && !h.endsWith('.' + site)) { res.writeHead(302, { Location: target }); return res.end(); }
  let html;
  const hit = cachedHtml(target) || cachedHtml(target.replace(/\/$/, ''));
  if (hit) { html = hit.html; r = { url: hit.url }; }
  else {
    try { r = await fetch(target, { redirect: 'follow', headers: { 'User-Agent': CHROME_UA, 'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8' } }); }
    catch (e) { res.writeHead(502); return res.end('proxy fetch failed: ' + e.message); }
    const ct = r.headers.get('content-type') || '';
    if (!ct.includes('html')) { res.writeHead(302, { Location: r.url || target }); return res.end(); }
    html = await r.text();
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
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
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
  if (n) { tracker.enterPage({ id: n.id, title: n.title, path: n.path }); broadcast({ type: 'interest', scores: tracker.liveInterest() }); }
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
    if (!allowed.includes(req.headers.host || '') || (origin && !allowed.some((h) => origin === `http://${h}`)) || req.headers['sec-fetch-site'] === 'cross-site') return sendJson(res, 403, { error: 'origen no permitido' });
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
      if (graph.isExploring()) return sendJson(res, 409, { error: 'Ya hay una exploración en marcha' });
      graph.explore(u, { max: Math.min(Number(max) || 30, 60) })
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
      broadcast({ type: 'interest', scores: tracker.liveInterest() });
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
