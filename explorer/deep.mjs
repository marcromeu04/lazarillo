// Agente de mapeo, segunda pasada: el detalle de una página (titulares, texto
// principal, listas, botones, formularios y cifras) para ampliar el contexto del
// agente de la demo. Rápido con fetch; si la página se pinta con JavaScript y llega
// casi vacía, la abre con Chrome. Cada página se investiga una sola vez.
import * as cheerio from 'cheerio';
import { chromium } from 'playwright-core';
import { isPublicUrl, safeFetch, pinnedChrome, hardenedContext } from './netguard.mjs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const clean = (t, n) => String(t ?? '').replace(/[\r\n\t]+/g, ' ').replace(/[`*_#>\[\]{}<|«»]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
const uniq = (arr) => [...new Set(arr.filter(Boolean))];

function extract(html) {
  const $ = cheerio.load(html || '');
  $('script,style,noscript,svg,iframe,template').remove();
  const root = $('main').length ? $('main') : $('body');
  const heads = uniq(root.find('h1,h2,h3').map((_, el) => clean($(el).text(), 90)).get()).slice(0, 12);
  const paras = uniq(root.find('p').map((_, el) => clean($(el).text(), 400)).get().filter((t) => t.length > 40));
  let text = '';
  for (const p of paras) {
    if (text.length + p.length > 1600) break;
    text += (text ? ' ' : '') + p;
  }
  const items = uniq(root.find('li').map((_, el) => clean($(el).text(), 90)).get().filter((t) => t.length > 8 && t.length < 90)).slice(0, 15);
  const buttons = uniq($('a,button,[role=button]').map((_, el) => clean($(el).text() || $(el).attr('aria-label'), 40)).get()).slice(0, 30);
  const forms = uniq($('input:not([type=hidden]),textarea,select').map((_, el) => clean($(el).attr('aria-label') || $(el).attr('placeholder') || $(el).attr('name'), 40)).get()).slice(0, 10);
  const figures = uniq((root.text().match(/(?:\d[\d.,]*\s?(?:%|€|\$|x|k|M)\b|(?:€|\$)\s?\d[\d.,]*)/g) || []).map((x) => x.trim())).slice(0, 10);
  return { heads, text, items, buttons, forms, figures };
}

async function renderWithChrome(url) {
  // Un Chrome por página (es el caso raro): con su dominio fijado a la IP ya validada.
  const pin = await pinnedChrome(url);
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: pin.args });
  let ctx;
  try {
    ctx = await hardenedContext(browser, { locale: 'es-ES' }, pin.hosts);
  } catch (e) {
    await browser.close().catch(() => {});
    throw e;
  }
  const page = await ctx.newPage();
  // Solo webs públicas en cada petición, y sin imágenes, vídeos ni fuentes.
  await page.route('**/*', async (route) => {
    const rq = route.request();
    if (['image', 'media', 'font'].includes(rq.resourceType())) return route.abort();
    if (!(await isPublicUrl(rq.url()))) return route.abort('blockedbyclient');
    return route.continue();
  });
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(1200);
    return await page.content();
  } finally {
    await browser.close().catch(() => {});
  }
}

const htmlCache = new Map(); // url → {html, url final, at}: el proxy lo reutiliza al navegar
export function cachedHtml(url) {
  const c = htmlCache.get(url);
  return c && Date.now() - c.at < 5 * 60 * 1000 ? c : null;
}

// ---------- lo que se ve en la pantalla de la demo ----------
// El puente lee la página ya pintada en el iframe (también si se pinta con JavaScript) y la manda aquí.
// Es gratis: la página ya está cargada para el visitante y no hace falta abrir otro Chrome.
const rendered = new Map(); // url → detalle leído de la pantalla
const done = new Map(); // url → detalle ya terminado de la investigación por HTML/Chrome
const waiting = new Map(); // url → [resolve] de quien espera la pantalla antes de abrir Chrome
const richness = (d) => (d ? (d.text || '').length + 60 * (d.heads || []).length + 10 * (d.items || []).length : 0);
// El HTML manda cuando trae contenido (es más limpio: sin textos animados ni menús abiertos); la pantalla
// cubre lo que el HTML no trae (webs pintadas con JavaScript).
const thin = (d) => !d || ((d.text || '').length < 200 && (d.heads || []).length < 2);

/** Detalle leído de la pantalla. Devuelve true si es el que se va a usar para esa página. */
export function setRenderedDetail(url, d) {
  const prev = rendered.get(url);
  if (prev && richness(prev) >= richness(d)) return false;
  const v = { url, via: 'pantalla', at: new Date().toISOString(), ...d };
  rendered.set(url, v);
  for (const r of waiting.get(url) || []) r(v);
  waiting.delete(url);
  const h = done.get(url);
  return !h || h.via === 'pantalla' || thin(h);
}
function waitRendered(url, ms) {
  if (rendered.has(url)) return Promise.resolve(rendered.get(url));
  return new Promise((resolve) => {
    waiting.set(url, [...(waiting.get(url) || []), resolve]);
    setTimeout(() => resolve(null), ms);
  });
}

async function investigate(url, onScreen = false, noChrome = false) {
  let html = '';
  const blockedResult = { url, via: 'bloqueada', at: new Date().toISOString(), heads: [], text: '', items: [], buttons: [], forms: [], figures: [] };
  if (!(await isPublicUrl(url))) return blockedResult;
  try {
    const { res: r, url: finalUrl } = await safeFetch(url, { timeoutMs: 10000, headers: { 'User-Agent': UA, 'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8' } });
    html = await r.text();
    if ((r.headers.get('content-type') || '').includes('html')) {
      const hit = { html, url: finalUrl, at: Date.now() };
      htmlCache.set(url, hit);
      if (finalUrl !== url) htmlCache.set(finalUrl, hit);
    }
  } catch (e) {
    if (e?.code === 'EBLOCKED' || e?.cause?.code === 'EBLOCKED') return blockedResult; // apunta a tu red: ni con Chrome
    return { ...blockedResult, via: 'no-carga' }; // error de red: no se reintenta con Chrome
  }
  let d = extract(html);
  let via = 'fetch';
  if (d.text.length < 200 && d.heads.length < 2) { // descarga buena pero casi vacía: web pintada con JavaScript
    // Si es la página que se está viendo, el puente la manda pintada en un momento: sin Chrome aparte.
    if (onScreen || rendered.has(url)) {
      const r = await waitRendered(url, 2500);
      if (r) return r;
    }
    if (noChrome) return { url, via, at: new Date().toISOString(), ...d }; // en segundo plano no se abre Chrome
    try {
      d = extract(await renderWithChrome(url));
      via = 'chrome';
    } catch {}
  }
  return { url, via, at: new Date().toISOString(), ...d };
}

const cache = new Map(); // url → Promise<detalle>

/**
 * Detalle de una página: el del HTML si trae contenido; si no, lo que se ha visto en pantalla. La primera
 * vez la investiga; después sale de la caché. onScreen: es la que se está viendo (puede llegar pintada).
 */
export function deepPage(url, { onScreen = false, background = false } = {}) {
  if (!cache.has(url)) cache.set(url, investigate(url, onScreen, background).then((d) => { done.set(url, d); return d; }));
  const r = rendered.get(url);
  if (!r) return cache.get(url);
  const h = done.get(url);
  if (h) return Promise.resolve(thin(h) ? r : h);
  // El HTML aún no ha llegado: se espera un poco y, si tarda o llega vacío, vale lo de la pantalla.
  return Promise.race([cache.get(url).then((x) => (thin(x) ? r : x), () => r), new Promise((res) => setTimeout(() => res(r), 1200))]);
}

/** Detalle ya disponible de una página (sin esperar ni descargar): el del HTML o, si llegó vacío, el de pantalla. */
export function knownDetail(url) {
  const h = done.get(url);
  const r = rendered.get(url);
  if (h && !thin(h)) return h;
  return r || h || null;
}

export function deepState(url) {
  return cache.has(url) ? 'listo-o-en-curso' : 'pendiente';
}

export function resetDeep() {
  cache.clear();
  rendered.clear();
  done.clear();
  waiting.clear();
}
