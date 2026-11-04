// Lazarillo v2 — servidor local (node:http). Sirve web/, el proxy del sitio a
// explorar (para verlo DENTRO de la página) y las rutas del contrato.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';

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
const TARGET_URL = process.env.TARGET_URL || 'https://books.toscrape.com/';
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

async function load(mod) {
  try { return await import(mod); }
  catch (e) { return { __missing: true, __err: String(e.message || e) }; }
}
const token = await load('./token.mjs');

// ---------- mapa (brain/app-map.json o el fixture) ----------
function loadMap() {
  for (const f of ['brain/app-map.json', 'contracts/app-map.example.json']) {
    try { return JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')); } catch {}
  }
  return { screens: [], edges: [] };
}
function matchScreen(map, url) {
  if (!url) return null;
  const screens = map.screens || [];
  let exact = screens.find((s) => s.url === url);
  if (exact) return exact;
  // sin barra final / con barra
  const alt = url.endsWith('/') ? url.slice(0, -1) : url + '/';
  exact = screens.find((s) => s.url === alt);
  if (exact) return exact;
  // prefijo más largo
  let best = null;
  for (const s of screens) {
    try {
      const su = new URL(s.url).pathname;
      const uu = new URL(url).pathname;
      if (uu.startsWith(su) && (!best || su.length > new URL(best.url).pathname.length)) best = s;
    } catch {}
  }
  return best;
}
function routesFrom(map, screenId) {
  const edges = (map.edges || []).filter((e) => e.from === screenId);
  const byId = Object.fromEntries((map.screens || []).map((s) => [s.id, s]));
  return edges.slice(0, 6).map((e) => ({
    a: (byId[e.to] && byId[e.to].title) || e.to,
    pasos: [`pulsa «${e.via}»`],
  }));
}
// current() a partir de la URL que reporta el iframe
let visitorUrl = TARGET_URL;
function currentFromUrl(url) {
  const map = loadMap();
  const s = matchScreen(map, url);
  if (!s) return { url, pantalla: null, acciones: [], rutas: [] };
  return {
    url,
    pantalla: { id: s.id, title: s.title, purpose: s.purpose },
    acciones: (s.actions || []).map((a) => a.label).slice(0, 12),
    rutas: routesFrom(map, s.id),
  };
}

// ---------- proxy del sitio + bridge inyectado ----------
function bridge(originalUrl, proxyOrigin) {
  return `(function(){
  var ORIGINAL_URL=${JSON.stringify(originalUrl)}, PROXY=${JSON.stringify(proxyOrigin)};
  function prox(h){ try{ return PROXY+'/proxy?url='+encodeURIComponent(new URL(h,ORIGINAL_URL).href);}catch(e){return null;} }
  function post(m){ try{ parent.postMessage(m,'*'); }catch(e){} }
  window.addEventListener('load',function(){ post({type:'page',url:ORIGINAL_URL,title:document.title}); });
  document.addEventListener('click',function(e){
    var a=e.target.closest?e.target.closest('a[href]'):null;
    if(a){ var h=a.getAttribute('href'); if(h&&!/^(mailto:|tel:|javascript:|#)/i.test(h)){ var p=prox(h); if(p){ e.preventDefault(); e.stopPropagation(); post({type:'click',text:(a.innerText||'').trim().slice(0,80)}); location.href=p; return; } } }
  },true);
  function norm(s){ return (s||'').toLowerCase().replace(/\\s+/g,' ').trim(); }
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
  window.addEventListener('message',function(e){ var d=e.data||{}; if(d.type==='highlight') hi(d.text); else if(d.type==='go'&&d.url){ var p=prox(d.url); if(p) location.href=p; } });
})();`;
}

async function proxyHandler(req, res, target) {
  let r;
  try { r = await fetch(target, { redirect: 'follow', headers: { 'User-Agent': CHROME_UA } }); }
  catch (e) { res.writeHead(502); return res.end('proxy fetch failed: ' + e.message); }
  const ct = r.headers.get('content-type') || '';
  if (!ct.includes('html')) { res.writeHead(302, { Location: r.url || target }); return res.end(); }
  const $ = cheerio.load(await r.text());
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

const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  const q = new URLSearchParams(req.url.split('?')[1] || '');
  try {
    if (url === '/proxy') return proxyHandler(req, res, q.get('url') || TARGET_URL);
    if (url === '/api/config' && req.method === 'GET') return sendJson(res, 200, { targetUrl: TARGET_URL });
    if (url === '/api/token' && req.method === 'POST') {
      if (token.__missing || !token.createToken) return sendJson(res, 503, { error: 'token.mjs no disponible' });
      return sendJson(res, 200, await token.createToken());
    }
    if (url === '/api/visitor-url' && req.method === 'POST') { const { url: u } = await body(req); if (u) visitorUrl = u; return sendJson(res, 200, { ok: true }); }
    if (url === '/api/current' && req.method === 'GET') return sendJson(res, 200, currentFromUrl(visitorUrl));
    if (url === '/api/highlight' && req.method === 'POST') { const { text } = await body(req); return sendJson(res, 200, { ok: true, text }); } // el resaltado real lo hace el iframe (cliente)
    if (url === '/api/open' && req.method === 'POST') { const { url: u } = await body(req); if (u) visitorUrl = u; return sendJson(res, 200, { ok: true }); }
    if (req.method === 'GET') return serveStatic(req, res);
    res.writeHead(404); res.end('not found');
  } catch (e) { sendJson(res, 500, { error: String(e.message || e) }); }
});

server.listen(PORT, () => {
  console.log(`\n  Lazarillo v2 → http://localhost:${PORT}  (Chrome)`);
  console.log(`  target: ${TARGET_URL}   token.mjs: ${token.__missing ? '✗' : '✓'}`);
  if (!process.env.CARTESIA_API_KEY) console.log('  ⚠  Falta CARTESIA_API_KEY (está en .env.demo).');
});
