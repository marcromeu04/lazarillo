import express from 'express';
import * as cheerio from 'cheerio';
import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const MAP_MODEL = process.env.MAP_MODEL || 'claude-sonnet-5-5';
const TURN_MODEL = process.env.TURN_MODEL || 'claude-haiku-5-5';
const CACHE_DIR = path.join(__dirname, 'cache');
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Load knowledge once at boot — this is our "RAG" of how to communicate.
const KNOWLEDGE = ['comunicacion.md', 'demo-playbook.md']
  .map((f) => {
    try { return fs.readFileSync(path.join(__dirname, 'knowledge', f), 'utf8'); }
    catch { return ''; }
  })
  .join('\n\n---\n\n');

const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ------------------------------------------------------------------ helpers

function fetchWithTimeout(url, opts = {}, ms = 6000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, {
    ...opts,
    redirect: 'follow',
    signal: ctrl.signal,
    headers: { 'User-Agent': CHROME_UA, Accept: 'text/html,*/*', ...(opts.headers || {}) },
  }).finally(() => clearTimeout(t));
}

const BAD_EXT = /\.(pdf|jpg|jpeg|png|gif|svg|webp|zip|mp4|mp3|avi|dmg|exe|css|js|ico)(\?|$)/i;
const BAD_PATH = /(mailto:|tel:|javascript:|login|signin|sign-in|logout|aviso-legal|legal|privacy|privacidad|cookie|terms|terminos)/i;

function cleanLinks($, baseUrl) {
  const origin = new URL(baseUrl).origin;
  const ordered = [];
  const seen = new Set();
  const regions = ['header', 'nav', 'main', 'footer', 'body'];
  for (const region of regions) {
    $(`${region} a[href]`).each((_, el) => {
      const raw = $(el).attr('href');
      if (!raw) return;
      let abs;
      try { abs = new URL(raw, baseUrl); } catch { return; }
      if (abs.origin !== origin) return;
      if (BAD_EXT.test(abs.pathname) || BAD_PATH.test(abs.href)) return;
      abs.hash = '';
      const key = abs.pathname + abs.search;
      if (seen.has(key)) return;
      seen.add(key);
      ordered.push(abs.href);
    });
  }
  return ordered;
}

function textChunk($, sel, max) {
  const out = [];
  $(sel).each((_, el) => {
    const t = $(el).text().trim().replace(/\s+/g, ' ');
    if (t && t.length <= 120) out.push(t);
  });
  return [...new Set(out)].slice(0, max);
}

async function extractPage(url) {
  const res = await fetchWithTimeout(url);
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('html')) return null;
  const html = await res.text();
  const $ = cheerio.load(html);
  $('script,style,noscript,svg').remove();
  const u = new URL(res.url || url);

  const headings = [];
  $('h1,h2,h3').each((_, el) => {
    const t = $(el).text().trim().replace(/\s+/g, ' ');
    if (t) headings.push(t);
  });

  const menu = textChunk($, 'header a, nav a', 25);
  const buttons = textChunk($, 'button, [role=button], a.btn, .btn, a.button, [class*=cta]', 25);
  const shortLinks = [];
  $('a').each((_, el) => {
    const t = $(el).text().trim().replace(/\s+/g, ' ');
    if (t && t.length > 1 && t.length <= 30) shortLinks.push(t);
  });

  const formBits = [];
  $('label').each((_, el) => { const t = $(el).text().trim(); if (t) formBits.push(t); });
  $('input,textarea,select').each((_, el) => {
    const p = $(el).attr('placeholder') || $(el).attr('name') || $(el).attr('aria-label');
    if (p) formBits.push(p);
  });

  const main = $('main').text() || $('article').text() || $('body').text();
  const bodyText = main.trim().replace(/\s+/g, ' ').slice(0, 1200);

  return {
    links: cleanLinks($, res.url || url),
    url: res.url || url,
    path: u.pathname + u.search || '/',
    title: ($('title').first().text() || $('h1').first().text() || u.pathname).trim().replace(/\s+/g, ' ').slice(0, 120),
    description: ($('meta[name=description]').attr('content') || $('meta[property="og:description"]').attr('content') || '').trim().slice(0, 300),
    headings: headings.slice(0, 15),
    menu,
    buttons: [...new Set([...buttons, ...shortLinks])].slice(0, 30),
    form: [...new Set(formBits)].slice(0, 15),
    text: bodyText,
  };
}

async function pool(items, size, worker) {
  const results = [];
  let i = 0;
  const run = async () => {
    while (i < items.length) {
      const idx = i++;
      try { results[idx] = await worker(items[idx], idx); }
      catch { results[idx] = null; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, run));
  return results.filter(Boolean);
}

const SITE_MAP_SCHEMA = {
  type: 'object',
  properties: {
    product: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        one_liner: { type: 'string' },
        audience: { type: 'string' },
      },
      required: ['name', 'one_liner', 'audience'],
    },
    pages: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          title: { type: 'string' },
          purpose: { type: 'string', description: 'Una frase: para qué sirve la página' },
          key_elements: { type: 'array', items: { type: 'string' }, description: 'Textos EXACTOS de botones, enlaces y títulos de esta página' },
          wow: { type: 'string', description: 'Lo más potente de la página, una frase' },
          how_to_get_here: { type: 'string', description: 'Desde la home, dicho como se habla, p.ej. "arriba a la derecha, en Precios"' },
        },
        required: ['path', 'title', 'purpose', 'key_elements', 'wow', 'how_to_get_here'],
      },
    },
    main_nav: { type: 'array', items: { type: 'string' } },
    suggested_tour: { type: 'array', items: { type: 'string' }, description: 'paths en orden' },
  },
  required: ['product', 'pages', 'main_nav', 'suggested_tour'],
};

// ------------------------------------------------------------------ /api/crawl (SSE)

app.get('/api/crawl', async (req, res) => {
  const target = req.query.url;
  const fresh = req.query.fresh === '1';
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders?.();
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    if (!target) throw new Error('missing url');
    const start = Date.now();
    const home = new URL(target);
    const domain = home.hostname.replace(/^www\./, '');
    const cacheFile = path.join(CACHE_DIR, domain + '.json');

    if (!fresh && fs.existsSync(cacheFile)) {
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      send('done', { ...cached, ms: 0, cached: true });
      return res.end();
    }

    // Home first.
    const homePage = await extractPage(home.href);
    if (!homePage) throw new Error('could not read home');
    const spa = (homePage.text || '').length < 200;
    send('page', { path: homePage.path, title: homePage.title });

    // Links gathered while reading the home (same fetch).
    const links = (homePage.links || []).filter((l) => {
      try { return new URL(l).pathname !== home.pathname; } catch { return false; }
    });
    const toVisit = [...new Set(links)].slice(0, 9); // + home = 10 max

    const rest = await pool(toVisit, 5, async (link) => {
      const p = await extractPage(link);
      if (p) send('page', { path: p.path, title: p.title });
      return p;
    });

    const pages = [homePage, ...rest];

    // One call to Claude for the map, forced tool.
    const compact = pages.map((p) => ({
      path: p.path, title: p.title, description: p.description,
      headings: p.headings, menu: p.menu, buttons: p.buttons, form: p.form,
      text: p.text.slice(0, 800),
    }));

    send('status', { msg: 'Pensando el mapa…' });
    const msg = await anthropic.messages.create({
      model: MAP_MODEL,
      max_tokens: 2000,
      tools: [{ name: 'submit_site_map', description: 'Entrega el mapa estructurado de la web.', input_schema: SITE_MAP_SCHEMA }],
      tool_choice: { type: 'tool', name: 'submit_site_map' },
      messages: [{
        role: 'user',
        content:
          `Eres un analista de producto. Aquí tienes ${pages.length} páginas de la web ${home.href}. ` +
          `Haz un mapa claro para orientar a un visitante nuevo. Usa SIEMPRE los textos EXACTOS que ves en buttons/menu/headings para key_elements (se usarán para resaltar en pantalla). ` +
          `how_to_get_here descrito como se habla. suggested_tour: orden ideal para una demo, empezando por lo más impresionante.\n\n` +
          JSON.stringify(compact),
      }],
    });

    const toolUse = msg.content.find((c) => c.type === 'tool_use');
    const map = toolUse ? toolUse.input : { product: { name: domain, one_liner: '', audience: '' }, pages: [], main_nav: [], suggested_tour: [] };
    if (spa) map.spa = true;

    const raw = {};
    for (const p of pages) raw[p.path] = p;

    const payload = { map, raw, domain, origin: home.origin };
    fs.writeFileSync(cacheFile, JSON.stringify(payload));
    send('done', { ...payload, ms: Date.now() - start });
    res.end();
  } catch (e) {
    send('error', { message: String(e.message || e) });
    res.end();
  }
});

// ------------------------------------------------------------------ /proxy

function bridgeScript(originalUrl, proxyOrigin) {
  return `
(function(){
  var ORIGINAL_URL = ${JSON.stringify(originalUrl)};
  var PROXY_ORIGIN = ${JSON.stringify(proxyOrigin)};
  function proxied(href){
    try { var abs = new URL(href, ORIGINAL_URL).href; }
    catch(e){ return null; }
    return PROXY_ORIGIN + '/proxy?url=' + encodeURIComponent(abs);
  }
  function post(m){ try { parent.postMessage(m, '*'); } catch(e){} }

  window.addEventListener('load', function(){
    post({type:'page', url: ORIGINAL_URL, title: document.title});
  });

  document.addEventListener('click', function(e){
    var a = e.target.closest ? e.target.closest('a[href]') : null;
    if (a) {
      var href = a.getAttribute('href');
      if (href && !/^(mailto:|tel:|javascript:|#)/i.test(href)) {
        var p = proxied(href);
        if (p) { e.preventDefault(); e.stopPropagation();
          post({type:'click', text:(a.innerText||a.textContent||'').trim().slice(0,80)});
          location.href = p; return; }
      }
    }
    var t = e.target;
    var label = (t.innerText||t.textContent||t.value||'').trim().slice(0,80);
    post({type:'click', text: label});
  }, true);

  var lastScroll = 0;
  window.addEventListener('scroll', function(){
    var now = Date.now();
    if (now - lastScroll < 1000) return;
    lastScroll = now;
    var hs = document.querySelectorAll('h2'); var best = '';
    for (var i=0;i<hs.length;i++){ var r = hs[i].getBoundingClientRect();
      if (r.top >= -40 && r.top < window.innerHeight*0.6){ best = hs[i].innerText.trim(); break; } }
    if (best) post({type:'section', heading: best});
  }, {passive:true});

  function norm(s){ return (s||'').toLowerCase().replace(/\\s+/g,' ').trim(); }
  function highlight(text){
    var want = norm(text);
    var sel = 'a,button,[role=button],h1,h2,h3,label,li';
    var els = document.querySelectorAll(sel);
    var best = null, bestScore = 0;
    for (var i=0;i<els.length;i++){
      var el = els[i];
      var r = el.getBoundingClientRect();
      if (r.width===0 || r.height===0) continue;
      var txt = norm(el.innerText||el.textContent);
      if (!txt || txt.length>120) continue;
      var score = 0;
      if (txt === want) score = 100;
      else if (txt.indexOf(want)>=0) score = 70 - Math.abs(txt.length-want.length)*0.1;
      else if (want.indexOf(txt)>=0 && txt.length>3) score = 50;
      else { var w = want.split(' '); var hit=0; for (var k=0;k<w.length;k++) if (w[k].length>2 && txt.indexOf(w[k])>=0) hit++; score = hit*12; }
      if (score > bestScore){ bestScore = score; best = el; }
    }
    if (!best || bestScore < 12) { post({type:'highlight_result', ok:false}); return; }
    best.scrollIntoView({behavior:'smooth', block:'center'});
    var ring = document.createElement('div');
    var r = best.getBoundingClientRect();
    ring.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;border:3px solid #a855f7;border-radius:12px;box-shadow:0 0 0 4px rgba(168,85,247,.35),0 0 24px 8px rgba(168,85,247,.6);animation:lzpulse 1s infinite;';
    function place(){ var rr = best.getBoundingClientRect(); ring.style.left=(rr.left-6)+'px'; ring.style.top=(rr.top-6)+'px'; ring.style.width=(rr.width+12)+'px'; ring.style.height=(rr.height+12)+'px'; }
    place();
    var chip = document.createElement('div');
    chip.textContent = 'aquí';
    chip.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;background:#a855f7;color:#fff;font:600 13px system-ui;padding:3px 10px;border-radius:999px;transform:translateY(-120%);box-shadow:0 4px 12px rgba(0,0,0,.3);';
    function placeChip(){ var rr = best.getBoundingClientRect(); chip.style.left=(rr.left)+'px'; chip.style.top=(rr.top-4)+'px'; }
    placeChip();
    if (!document.getElementById('lzstyle')){ var st=document.createElement('style'); st.id='lzstyle'; st.textContent='@keyframes lzpulse{0%,100%{opacity:1}50%{opacity:.45}}'; document.head.appendChild(st); }
    document.body.appendChild(ring); document.body.appendChild(chip);
    var iv = setInterval(function(){ place(); placeChip(); }, 200);
    setTimeout(function(){ clearInterval(iv); ring.remove(); chip.remove(); }, 4000);
    post({type:'highlight_result', ok:true});
  }

  window.addEventListener('message', function(e){
    var d = e.data || {};
    if (d.type === 'highlight') highlight(d.text);
    else if (d.type === 'go' && d.url) { var p = proxied(d.url); if (p) location.href = p; }
  });
})();`;
}

app.get('/proxy', async (req, res) => {
  const target = req.query.url;
  const stripJs = req.query.js === '0';
  if (!target) return res.status(400).send('missing url');
  let res2;
  try { res2 = await fetchWithTimeout(target, {}, 10000); }
  catch (e) { return res.status(502).send('proxy fetch failed: ' + e.message); }

  const ct = res2.headers.get('content-type') || '';
  if (!ct.includes('html')) {
    return res.redirect(302, res2.url || target);
  }

  let html = await res2.text();
  const $ = cheerio.load(html);
  // Strip frame-busting meta http-equiv.
  $('meta[http-equiv]').each((_, el) => {
    const v = ($(el).attr('http-equiv') || '').toLowerCase();
    if (v.includes('content-security-policy') || v.includes('x-frame-options')) $(el).remove();
  });
  if (stripJs) $('script').remove();

  const proxyOrigin = `${req.protocol}://${req.get('host')}`;
  const base = `<base href="${res2.url || target}">`;
  const inject = `<script>${bridgeScript(res2.url || target, proxyOrigin)}</script>`;

  if ($('head').length) $('head').prepend(base);
  else $.root().prepend(`<head>${base}</head>`);
  $('body').append(inject);
  if (!$('body').length) $.root().append(inject);

  res.set('Content-Type', 'text/html; charset=utf-8');
  res.removeHeader?.('X-Frame-Options');
  res.removeHeader?.('Content-Security-Policy');
  res.send($.html());
});

// ------------------------------------------------------------------ /api/turn

function relatedPages(raw, userText) {
  const words = (userText || '').toLowerCase().split(/\W+/).filter((w) => w.length > 3);
  const scored = Object.values(raw).map((p) => {
    const hay = (p.title + ' ' + p.description + ' ' + (p.headings || []).join(' ') + ' ' + p.text).toLowerCase();
    let score = 0;
    for (const w of words) if (hay.includes(w)) score++;
    return { p, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 2).map((s) => s.p);
}

app.post('/api/turn', async (req, res) => {
  const { history = [], userText = '', currentPath = '/', events = [], lang = 'es-ES', map = {}, raw = {} } = req.body || {};
  res.set({ 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' });

  const current = raw[currentPath] || raw[Object.keys(raw).find((k) => currentPath.startsWith(k)) || '/'] || {};
  const related = relatedPages(raw, userText);

  const mapSummary = (map.pages || [])
    .map((p) => `- ${p.path} — ${p.title}: ${p.purpose} | cómo llegar: ${p.how_to_get_here} | wow: ${p.wow} | elementos: ${(p.key_elements || []).join(', ')}`)
    .join('\n');

  const stableSystem =
    `${KNOWLEDGE}\n\n` +
    `## Etiquetas de control (NUNCA se leen en voz alta)\n` +
    `[[go:/ruta]] lleva el iframe a una página del mapa. Solo paths que existen en el mapa.\n` +
    `[[highlight:texto exacto]] resalta un elemento visible. Usa textos EXACTOS de key_elements.\n` +
    `Pega la etiqueta justo después de la frase que la describe.\n\n` +
    `## Producto\n${map.product ? `${map.product.name}: ${map.product.one_liner} (para ${map.product.audience})` : ''}\n\n` +
    `## Mapa de la web\n${mapSummary}\n\n` +
    `## Tour sugerido\n${(map.suggested_tour || []).join(' → ')}`;

  const dynamicSystem =
    `## Página actual: ${currentPath} — ${current.title || ''}\n` +
    `Elementos EXACTOS aquí (para highlight): ${(current.buttons || []).concat(current.menu || []).slice(0, 25).join(', ')}\n` +
    `Encabezados: ${(current.headings || []).join(' | ')}\n\n` +
    `## Páginas relacionadas con lo que pide\n` +
    related.map((p) => `### ${p.path} — ${p.title}\n${p.description}\n${(p.headings || []).slice(0, 6).join(' | ')}`).join('\n\n') +
    `\n\n## Eventos recientes\n${events.map((e) => '- ' + e).join('\n')}\n\n` +
    `Responde en ${lang === 'en-US' ? 'inglés' : 'español'}. Turno corto, una idea, termina devolviendo la palabra.`;

  const messages = history.slice(-12).map((h) => ({ role: h.role, content: h.content }));
  messages.push({ role: 'user', content: userText || '[inicio]' });

  try {
    const stream = anthropic.messages.stream({
      model: TURN_MODEL,
      max_tokens: 300,
      temperature: 0.7,
      system: [
        { type: 'text', text: stableSystem, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: dynamicSystem },
      ],
      messages,
    });
    stream.on('text', (t) => res.write(t));
    stream.on('end', () => res.end());
    stream.on('error', (e) => { try { res.write('\n'); } catch {} res.end(); });
    req.on('close', () => { try { stream.abort(); } catch {} });
  } catch (e) {
    res.status(500).end('error');
  }
});

// ------------------------------------------------------------------ /api/tts

app.get('/api/tts', async (req, res) => {
  const text = req.query.text || '';
  const prev = req.query.prev || '';
  const key = process.env.ELEVENLABS_API_KEY;
  const voice = process.env.ELEVENLABS_VOICE_ID;
  if (!key || !voice) return res.status(204).end();

  try {
    const r = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voice}/stream?output_format=mp3_44100_128`,
      {
        method: 'POST',
        headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          model_id: 'eleven_flash_v2_5',
          previous_text: prev,
          voice_settings: { stability: 0.4, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true, speed: 1.05 },
        }),
      }
    );
    if (!r.ok || !r.body) { return res.status(204).end(); }
    res.set('Content-Type', 'audio/mpeg');
    // Stream the audio straight through.
    const reader = r.body.getReader();
    const pump = async () => {
      const { done, value } = await reader.read();
      if (done) return res.end();
      res.write(Buffer.from(value));
      return pump();
    };
    await pump();
  } catch (e) {
    try { res.status(204).end(); } catch {}
  }
});

app.listen(PORT, () => {
  console.log(`\n  Lazarillo en http://localhost:${PORT}  (Chrome)\n`);
  if (!process.env.ANTHROPIC_API_KEY) console.log('  ⚠  Falta ANTHROPIC_API_KEY en .env — el mapa y los turnos fallarán.');
  if (!process.env.ELEVENLABS_API_KEY) console.log('  ℹ  Sin ELEVENLABS_API_KEY — se usará la voz del navegador.');
});
