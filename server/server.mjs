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
  // Avisos de cookies: se rechazan (o «solo necesarias»); si no hay botón de rechazar, se oculta
  // el aviso. Nunca se acepta. Se repite unos segundos porque muchos avisos llegan tarde.
  var CMP_REJECT=['#onetrust-reject-all-handler','#CybotCookiebotDialogBodyButtonDecline','#didomi-notice-disagree-button','.cky-btn-reject','.cmplz-deny','#cookiescript_reject','.osano-cm-denyAll','[data-testid=uc-deny-all-button]','.fc-cta-do-not-consent','#axeptio_btn_dismiss','.iubenda-cs-reject-btn','#tarteaucitronAllDenied2','.cc-deny'];
  var REJECT_RX=/^(rechazar( todo| todas| todas las cookies| cookies)?|denegar( todo)?|no acepto|no aceptar|solo (las )?(cookies )?(necesarias|esenciales|tecnicas)|usar solo (las )?(cookies )?necesarias|continuar sin aceptar|reject( all)?( cookies)?|decline( all)?|deny( all)?|only (necessary|essential)( cookies)?|use necessary cookies only|refuse( all)?|continue without accepting|necessary only|tout refuser|refuser)$/i;
  var cookieDone=false;
  function looksLikeBanner(el){ var t=norm((el.innerText||'').slice(0,600)); return /cookie|consent|privacidad|privacy|rgpd|gdpr/.test(t); }
  function dismissCookies(){
    if(cookieDone) return;
    for(var i=0;i<CMP_REJECT.length;i++){ var b=document.querySelector(CMP_REJECT[i]); if(b&&b.getBoundingClientRect().width>0){ b.click(); cookieDone=true; post({type:'cookies',how:'rechazadas'}); return; } }
    var btns=document.querySelectorAll('button,a,[role=button],input[type=button],input[type=submit]');
    for(var j=0;j<btns.length;j++){ var el=btns[j], r=el.getBoundingClientRect(); if(r.width===0||r.height===0) continue;
      var t=norm(el.innerText||el.value||el.getAttribute('aria-label')).normalize('NFD').replace(/[̀-ͯ]/g,'');
      if(!t||t.length>45||!REJECT_RX.test(t)) continue;
      var box=el.parentElement, ok=false; for(var up=0; box&&up<8; up++, box=box.parentElement){ if(looksLikeBanner(box)){ ok=true; break; } if(box===document.body) break; }
      if(ok){ el.click(); cookieDone=true; post({type:'cookies',how:'rechazadas'}); return; } }
    // Sin botón de rechazar: se oculta el aviso (fijo o pegado a la pantalla) sin aceptar nada.
    var all=document.querySelectorAll('body *');
    for(var k=0;k<all.length&&k<4000;k++){ var e=all[k], cs=getComputedStyle(e);
      if((cs.position==='fixed'||cs.position==='sticky')&&e.getBoundingClientRect().height>40&&looksLikeBanner(e)&&e.querySelector('button,a,[role=button]')){
        e.style.setProperty('display','none','important'); cookieDone=true; post({type:'cookies',how:'ocultado'}); return; } }
  }
  [0,500,1200,2500,4500].forEach(function(ms){ setTimeout(dismissCookies,ms); });
  try{ var mo=new MutationObserver(function(){ if(!cookieDone) dismissCookies(); }); mo.observe(document.documentElement,{childList:true,subtree:true}); setTimeout(function(){ mo.disconnect(); },7000); }catch(e){}
  // Recorrido: la página baja sección a sección mientras habla la IA.
  var TOUR={i:-1,items:null};
  function tourItems(){
    if(TOUR.items) return TOUR.items;
    var els=document.querySelectorAll('h1,h2,h3,[role=heading]'), out=[], last=-1e9;
    for(var i=0;i<els.length;i++){ var r=els[i].getBoundingClientRect(); if(r.width===0||r.height===0) continue;
      var y=r.top+window.scrollY; if(y-last<140) continue; last=y; out.push({el:els[i],y:y}); }
    out.sort(function(a,b){return a.y-b.y;}); TOUR.items=out; return out;
  }
  function soft(el,ms){
    var r=document.createElement('div');
    r.style.cssText='position:fixed;z-index:2147483646;pointer-events:none;border-radius:10px;box-shadow:0 0 0 2px rgba(168,85,247,.55),0 0 18px 4px rgba(168,85,247,.25);transition:opacity .4s';
    function place(){ var rr=el.getBoundingClientRect(); r.style.left=(rr.left-8)+'px';r.style.top=(rr.top-6)+'px';r.style.width=(rr.width+16)+'px';r.style.height=(rr.height+12)+'px'; }
    place(); document.body.appendChild(r); var iv=setInterval(place,100);
    setTimeout(function(){ r.style.opacity='0'; setTimeout(function(){ clearInterval(iv); r.remove(); },400); },ms);
  }
  function tourStep(){
    var items=tourItems(), y=window.scrollY, next=null;
    for(var k=0;k<items.length;k++){ if(items[k].y>y+innerHeight*0.30){ next=items[k]; TOUR.i=k; break; } }
    if(next){ window.scrollTo({top:Math.max(0,next.y-innerHeight*0.18),behavior:'smooth'}); soft(next.el,1600); post({type:'tour_result',ok:true,text:(next.el.innerText||'').trim().slice(0,60)}); }
    else if(y+innerHeight<document.documentElement.scrollHeight-40){ window.scrollBy({top:innerHeight*0.6,behavior:'smooth'}); post({type:'tour_result',ok:true,text:''}); }
    else post({type:'tour_result',ok:false,end:true});
  }
  // La pantalla sigue a la voz: dada una frase de la IA, va a la parte de la página que coincide.
  var FSTOP={'para':1,'como':1,'esta':1,'este':1,'esto':1,'pero':1,'porque':1,'donde':1,'cuando':1,'tambien':1,'tienes':1,'puedes':1,'aqui':1,'mira':1,'fijate':1,'vale':1,'sobre':1,'entre':1,'todo':1,'toda':1,'todos':1,'cada':1,'muy':1,'mucho':1,'mas':1,'menos':1,'tu':1,'tus':1,'nos':1,'les':1,'una':1,'unos':1,'unas':1,'que':1,'con':1,'los':1,'las':1,'del':1,'pagina':1,'web':1,'seccion':1,'parte':1,'abajo':1,'arriba':1,'ves':1,'ver':1,'vamos':1};
  function fstems(t){ return norm(t).normalize('NFD').replace(/[̀-ͯ]/g,'').split(/[^a-z0-9ñ]+/).filter(function(w){ return w.length>=4&&!FSTOP[w]; }).map(function(w){ return w.slice(0,6); }); }
  var FOLLOW={el:null,at:0,idx:null};
  function followIndex(){
    if(FOLLOW.idx) return FOLLOW.idx;
    var els=document.querySelectorAll('h1,h2,h3,h4,p,li,blockquote,figcaption,td,dt,dd,[class*=card] span,[class*=stat],[class*=metric]'), out=[], df={};
    for(var i=0;i<els.length;i++){ var el=els[i], r=el.getBoundingClientRect(); if(r.width===0||r.height===0) continue;
      var t=(el.innerText||'').trim(); if(t.length<3||t.length>320) continue;
      var st=fstems(t); if(!st.length) continue; var set={}; st.forEach(function(s){ set[s]=1; });
      Object.keys(set).forEach(function(s){ df[s]=(df[s]||0)+1; });
      out.push({el:el,set:set,head:/^H[1-4]$/.test(el.tagName)}); }
    FOLLOW.idx={items:out,df:df,n:Math.max(1,out.length)}; return FOLLOW.idx;
  }
  function followText(text){
    var q=fstems(text); if(!q.length) return;
    var ix=followIndex(), best=null, bs=0;
    for(var i=0;i<ix.items.length;i++){ var it=ix.items[i], sc=0, hits=0;
      if(HOLD.on){ var ir=it.el.getBoundingClientRect(); if(ir.top<0||ir.bottom>innerHeight) continue; } // parada: solo lo que ya se ve
      for(var k=0;k<q.length;k++) if(it.set[q[k]]){ hits++; sc+=Math.log(1+ix.n/ix.df[q[k]]); }
      if(!hits) continue; if(it.head) sc*=1.35; if(hits>=2) sc*=1.25;
      if(sc>bs){ bs=sc; best=it.el; } }
    if(!best||bs<2.2||best===FOLLOW.el) return;
    FOLLOW.el=best; FOLLOW.at=Date.now();
    var r=best.getBoundingClientRect();
    if(!HOLD.on&&(r.top<innerHeight*0.12||r.bottom>innerHeight*0.80)) best.scrollIntoView({behavior:'smooth',block:'center'});
    soft(best,1800);
    post({type:'follow_result',ok:true,text:(best.innerText||'').trim().slice(0,50)});
  }
  // Foco: el visitante ha dicho «párate aquí»: la pantalla se queda en esta zona.
  var HOLD={on:false,y:0};
  function centerBlock(){
    var el=document.elementFromPoint(innerWidth/2, innerHeight*0.45);
    while(el&&el!==document.body){ var t=(el.innerText||'').trim(); if(t.length>=40&&t.length<=900) return el; el=el.parentElement; }
    return null;
  }
  function setHold(on){
    HOLD.on=!!on;
    if(on){ var f=(FOLLOW.el&&FOLLOW.el.getBoundingClientRect().bottom>0&&FOLLOW.el.getBoundingClientRect().top<innerHeight)?FOLLOW.el:centerBlock();
      HOLD.y=f?f.getBoundingClientRect().top+window.scrollY:window.scrollY+innerHeight*0.4; if(f) soft(f,1400); }
  }
  function peek(){
    var f=(FOLLOW.el&&FOLLOW.el.getBoundingClientRect().bottom>0&&FOLLOW.el.getBoundingClientRect().top<innerHeight)?FOLLOW.el:centerBlock();
    var heads=[].slice.call(document.querySelectorAll('h1,h2,h3')).filter(function(h){ var r=h.getBoundingClientRect(); return r.height>0&&r.top>=0&&r.bottom<=innerHeight; }).slice(0,4).map(function(h){ return (h.innerText||'').trim().slice(0,90); });
    post({type:'peek_result',foco:f?(f.innerText||'').trim().replace(/\\s+/g,' ').slice(0,320):'',titulares_visibles:heads,parado:HOLD.on});
  }
  function showText(text){
    var want=norm(text), els=document.querySelectorAll('h1,h2,h3,h4,p,li,a,button,blockquote,figcaption,td,th,span'), best=null, bs=0;
    for(var i=0;i<els.length;i++){ var el=els[i], r=el.getBoundingClientRect(); if(r.width===0||r.height===0) continue;
      var t=norm(el.innerText||el.textContent); if(!t||t.length>220) continue;
      var sc=0; if(t===want)sc=100; else if(t.indexOf(want)>=0)sc=70-Math.min(30,t.length/10); else{ var w=want.split(' '),h=0; for(var k=0;k<w.length;k++) if(w[k].length>3&&t.indexOf(w[k])>=0)h++; sc=h*15; }
      if(/^H[1-4]$/.test(el.tagName)) sc+=8;
      if(sc>bs){bs=sc;best=el;} }
    if(!best||bs<15){ post({type:'show_result',ok:false,text:text}); return; }
    best.scrollIntoView({behavior:'smooth',block:'center'}); soft(best,2200);
    var y=best.getBoundingClientRect().top+window.scrollY, items=tourItems();
    for(var k=0;k<items.length;k++) if(items[k].y<=y+5) TOUR.i=k;
    post({type:'show_result',ok:true,text:(best.innerText||'').trim().slice(0,60)});
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
  window.addEventListener('message',function(e){ var d=e.data||{}; if(d.type==='highlight') hi(d.text); else if(d.type==='click') clickText(d.text); else if(d.type==='tour_step') tourStep(); else if(d.type==='show') showText(d.text||''); else if(d.type==='follow') followText(d.text||''); else if(d.type==='hold') setHold(d.on); else if(d.type==='peek') peek(); else if(d.type==='go'&&d.url){ var p=prox(d.url); if(p) location.href=p; } });
})();`;
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
