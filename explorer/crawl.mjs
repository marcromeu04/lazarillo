// Agente de mapeo (librería), primera fase: el MAPA MENTAL de la web, lo más rápido posible.
//
//   const map = await crawl(url, { max: 40, onNode, onEdge, onLog });
//
// Solo saca la estructura: cada página (nodo) con título, resumen de una frase y sus enlaces
// (aristas). Nada de Chrome ni capturas: descarga el HTML de 8 páginas a la vez y, si la web
// tiene sitemap.xml, lo usa para ver de golpe todas sus secciones. El detalle de cada página
// llega después, en la segunda fase (deep.mjs), según la probabilidad de que la IA vaya a ella.
//
// Chrome solo entra como respaldo si la web se pinta con JavaScript y su HTML llega sin enlaces.
// No envía formularios, no pulsa nada destructivo, no sale del dominio y solo va a webs públicas.
import * as cheerio from 'cheerio';
import { chromium } from 'playwright-core';
import { isPublicUrl, safeFetch, pinnedChromeArgs, hardenedContext } from './netguard.mjs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const SKIP = /\/meet\/|logout|log-out|signout|sign-out|delete|borrar|eliminar|salir|unsubscribe|cart\/add|checkout|\/wp-admin|\/cdn-cgi\//i;
const FILES = /\.(pdf|jpe?g|png|gif|svg|zip|rar|mp4|mp3|webp|avif|ico|xml|json|csv|txt|docx?|xlsx?|pptx?|css|js)(\?|$)/i;

export const hostOf = (u) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

export function normUrl(u) {
  const x = new URL(u);
  x.hash = '';
  for (const k of [...x.searchParams.keys()]) if (/^(utm_|fbclid|gclid|ref$)/i.test(k)) x.searchParams.delete(k);
  return x.href.replace(/\/index\.html?$/, '/').replace(/(?<!:\/)\/$/, '');
}

const clean = (t, n) => String(t ?? '').replace(/[\r\n\t]+/g, ' ').replace(/[`*_#>\[\]{}<|«»]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);

/** Resumen corto de la página (una frase): meta description o primer párrafo con sustancia. */
function summarize(info) {
  const s = info.meta || info.firstP || info.headings.slice(0, 2).join('. ');
  const one = s.split(/(?<=[.!?])\s/)[0] || s;
  return clean(one.length > 25 ? one : s, 140);
}

// ---------------------------------------------------------------------------------------------
// Vía rápida: HTML en paralelo
// ---------------------------------------------------------------------------------------------
function parsePage(html, baseUrl) {
  const $ = cheerio.load(html);
  const txt = (t) => (t || '').replace(/\s+/g, ' ').trim();
  const links = [];
  const seen = new Set();
  $('a[href]').each((_, a) => {
    if (links.length >= 60) return;
    const raw = $(a).attr('href');
    if (!raw || /^(#|mailto:|tel:|javascript:)/i.test(raw)) return;
    let href;
    try {
      href = new URL(raw, baseUrl).href;
    } catch {
      return;
    }
    const label = txt($(a).text() || $(a).attr('aria-label') || $(a).attr('title') || $(a).find('img').attr('alt')).slice(0, 40);
    if (!label || seen.has(label + '|' + href)) return;
    seen.add(label + '|' + href);
    links.push({ label, href });
  });
  const buttons = [];
  $('button, [role=button], input[type=submit]').each((_, b) => {
    const t = txt($(b).text() || $(b).attr('value') || $(b).attr('aria-label')).slice(0, 40);
    if (t && !buttons.includes(t) && buttons.length < 12) buttons.push(t);
  });
  $('script,style,noscript,svg,template').remove();
  return {
    // Título: el que la web escribe para resumir la página (og:title / <title>, sin el «| Marca»
    // del final). El <h1> a veces trae palabras ocultas de animaciones pegadas al texto.
    title: (() => {
      const t = txt($('meta[property="og:title"]').attr('content') || $('title').text());
      const cut = t.split(/\s+[|·—–-]\s+/)[0];
      const h1 = txt($('h1').first().text());
      return (cut.length >= 8 ? cut : t || h1).slice(0, 70);
    })(),
    docTitle: txt($('title').text()).slice(0, 90),
    meta: txt($('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content')),
    firstP: $('main p, article p, p').map((_, p) => txt($(p).text())).get().find((t) => t.length > 50) || '',
    headings: $('h1, h2').map((_, h) => txt($(h).text()).slice(0, 70)).get().filter(Boolean).slice(0, 6),
    links,
    buttons,
  };
}

async function fetchHtml(url, locale) {
  const { res, url: finalUrl } = await safeFetch(url, { timeoutMs: 8000, headers: { 'User-Agent': UA, 'Accept-Language': `${locale},es;q=0.9,en;q=0.8`, Accept: 'text/html,application/xhtml+xml' } });
  if (!(res.headers.get('content-type') || '').includes('html')) {
    try {
      await res.body?.cancel();
    } catch {}
    return null;
  }
  return { html: await res.text(), finalUrl };
}

async function sitemapUrls(startUrl, sameSite, limit) {
  const origin = new URL(startUrl).origin;
  const out = new Set();
  const read = async (u) => {
    try {
      const { res } = await safeFetch(u, { timeoutMs: 4000, headers: { 'User-Agent': UA } });
      if (!res.ok) return '';
      return await res.text();
    } catch {
      return '';
    }
  };
  const robots = await read(origin + '/robots.txt');
  const maps = [...robots.matchAll(/^sitemap:\s*(\S+)/gim)].map((m) => m[1]);
  if (!maps.length) maps.push(origin + '/sitemap.xml');
  for (const m of maps.slice(0, 2)) {
    const xml = await read(m);
    const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((x) => x[1]);
    if (/<sitemapindex/i.test(xml)) {
      for (const sub of locs.slice(0, 2)) for (const x of (await read(sub)).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) out.add(x[1]);
    } else locs.forEach((l) => out.add(l));
    if (out.size >= limit * 3) break;
  }
  return [...out].filter((u) => sameSite(u) && !FILES.test(u) && !SKIP.test(u));
}

async function crawlFast(startUrl, opts) {
  const { max, maxDepth, locale, concurrency = 8, onNode, onEdge, onLog } = opts;
  const host = hostOf(startUrl);
  const sameSite = (u) => hostOf(u) === host;
  const t0 = Date.now();
  const screens = [];
  const byUrl = new Map();
  const edges = [];
  const pending = [];
  const queued = new Set();
  const queue = [];
  const addEdge = (from, to, via) => {
    if (!from || !to || from === to || edges.some((e) => e.from === from && e.to === to)) return;
    const e = { from, to, via: clean(via, 40) };
    edges.push(e);
    onEdge(e);
  };
  const enqueue = (url, depth, from, via, front = false) => {
    let u;
    try {
      u = normUrl(url);
    } catch {
      return;
    }
    if (!sameSite(u) || FILES.test(u) || SKIP.test(u) || SKIP.test(via || '') || queued.has(u) || depth > maxDepth) return;
    queued.add(u);
    (front ? queue.unshift.bind(queue) : queue.push.bind(queue))({ url: u, depth, from, via });
  };

  async function visit(item) {
    let got;
    try {
      got = await fetchHtml(item.url, locale);
    } catch (e) {
      if (e?.code === 'EBLOCKED' && item.depth === 0) throw e; // la portada apunta a tu red: se aborta, sin Chrome
      onLog(`no carga: ${item.url}`);
      return;
    }
    if (!got) return;
    let finalUrl;
    try {
      finalUrl = normUrl(got.finalUrl);
    } catch {
      return;
    }
    if (!sameSite(finalUrl)) return;
    if (byUrl.has(finalUrl)) return addEdge(item.from, byUrl.get(finalUrl), item.via);
    if (screens.length >= max) return;
    const info = parsePage(got.html, got.finalUrl);
    const id = 's' + String(screens.length + 1).padStart(2, '0');
    const node = {
      id,
      url: finalUrl,
      path: new URL(finalUrl).pathname || '/',
      title: clean(info.title || info.docTitle || id, 70),
      summary: summarize(info),
      purpose: clean(info.meta || info.firstP, 160),
      headings: info.headings.map((h) => clean(h, 70)),
      actions: [...info.links.map((l) => ({ label: clean(l.label, 40), kind: 'link', href: l.href, to: null })), ...info.buttons.map((b) => ({ label: clean(b, 40), kind: 'button', to: null }))],
      depth: item.depth,
      screenshot: null,
    };
    screens.push(node);
    byUrl.set(finalUrl, id);
    onNode(node);
    addEdge(item.from, id, item.via);
    for (const l of info.links) {
      let href;
      try {
        href = normUrl(l.href);
      } catch {
        continue;
      }
      if (!sameSite(href)) continue;
      if (byUrl.has(href)) addEdge(id, byUrl.get(href), l.label);
      else pending.push({ from: id, href, via: l.label });
      enqueue(href, item.depth + 1, id, l.label);
    }
    return info;
  }

  // La portada primero (marca la raíz del árbol), el sitemap en paralelo.
  queued.add(normUrl(startUrl));
  const [rootInfo, fromSitemap] = await Promise.all([visit({ url: normUrl(startUrl), depth: 0, from: null, via: null }), sitemapUrls(startUrl, sameSite, max).catch(() => [])]);
  const sameSiteLinks = (rootInfo?.links || []).filter((l) => sameSite(l.href)).length;
  if (!rootInfo || sameSiteLinks < 3) return null; // web pintada con JavaScript: mejor Chrome
  for (const u of fromSitemap) enqueue(u, 1, null, null); // secciones que no enlaza la portada, al final de la cola
  if (fromSitemap.length) onLog(`sitemap: ${fromSitemap.length} direcciones`);

  // El resto, 8 a la vez, por niveles.
  const workers = Array.from({ length: concurrency }, async () => {
    while (screens.length < max && queue.length) {
      const item = queue.shift();
      await visit(item);
    }
  });
  await Promise.all(workers);

  for (const p of pending) addEdge(p.from, byUrl.get(p.href), p.via);
  for (const s of screens) for (const a of s.actions) if (a.href) {
    try {
      a.to = byUrl.get(normUrl(a.href)) || null;
    } catch {}
  }
  return {
    app: { name: screens[0]?.title || host, host, startUrl: normUrl(startUrl), exploredAt: new Date().toISOString(), pages: screens.length, seconds: Math.round((Date.now() - t0) / 100) / 10, via: 'html' },
    screens,
    edges,
  };
}

// ---------------------------------------------------------------------------------------------
// Respaldo: Chrome, para webs que se pintan con JavaScript
// ---------------------------------------------------------------------------------------------
async function crawlChrome(startUrl, opts) {
  const { max, maxDepth, locale, onNode, onEdge, onLog } = opts;
  const host = hostOf(startUrl);
  const sameSite = (u) => hostOf(u) === host;
  const t0 = Date.now();
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: await pinnedChromeArgs(startUrl) });
  // Sin service workers ni WebSockets, cada petición filtrada y sin imágenes, vídeos ni fuentes.
  const ctx = await hardenedContext(browser, { viewport: { width: 1280, height: 800 }, locale, extraHTTPHeaders: { 'Accept-Language': `${locale},es;q=0.9,en;q=0.8` } });
  const page = await ctx.newPage();

  const queue = [{ url: normUrl(startUrl), depth: 0, from: null, via: null }];
  const seen = new Set([normUrl(startUrl)]);
  const screens = [];
  const byUrl = new Map();
  const edges = [];
  const pending = [];
  const addEdge = (from, to, via) => {
    if (!from || !to || from === to || edges.some((e) => e.from === from && e.to === to)) return;
    const e = { from, to, via: clean(via, 40) };
    edges.push(e);
    onEdge(e);
  };
  try {
    while (queue.length && screens.length < max) {
      const item = queue.shift();
      try {
        await page.goto(item.url, { waitUntil: 'domcontentloaded', timeout: 12000 });
        await page.waitForTimeout(300);
      } catch {
        onLog(`no carga: ${item.url}`);
        continue;
      }
      let finalUrl;
      try {
        finalUrl = normUrl(page.url());
      } catch {
        continue;
      }
      if (!sameSite(finalUrl)) continue;
      if (byUrl.has(finalUrl)) {
        addEdge(item.from, byUrl.get(finalUrl), item.via);
        continue;
      }
      const info = parsePage(await page.content(), finalUrl);
      const id = 's' + String(screens.length + 1).padStart(2, '0');
      const node = {
        id,
        url: finalUrl,
        path: new URL(finalUrl).pathname || '/',
        title: clean(info.title || info.docTitle || id, 70),
        summary: summarize(info),
        purpose: clean(info.meta || info.firstP, 160),
        headings: info.headings.map((h) => clean(h, 70)),
        actions: [...info.links.map((l) => ({ label: clean(l.label, 40), kind: 'link', href: l.href, to: null })), ...info.buttons.map((b) => ({ label: clean(b, 40), kind: 'button', to: null }))],
        depth: item.depth,
        screenshot: null,
      };
      screens.push(node);
      byUrl.set(finalUrl, id);
      onNode(node);
      addEdge(item.from, id, item.via);
      for (const l of info.links) {
        let href;
        try {
          href = normUrl(l.href);
        } catch {
          continue;
        }
        if (!sameSite(href) || FILES.test(href) || SKIP.test(href) || SKIP.test(l.label)) continue;
        if (byUrl.has(href)) {
          addEdge(id, byUrl.get(href), l.label);
          continue;
        }
        pending.push({ from: id, href, via: l.label });
        if (seen.has(href) || item.depth >= maxDepth) continue;
        seen.add(href);
        queue.push({ url: href, depth: item.depth + 1, from: id, via: l.label });
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }
  for (const p of pending) addEdge(p.from, byUrl.get(p.href), p.via);
  for (const s of screens) for (const a of s.actions) if (a.href) {
    try {
      a.to = byUrl.get(normUrl(a.href)) || null;
    } catch {}
  }
  return {
    app: { name: screens[0]?.title || host, host, startUrl: normUrl(startUrl), exploredAt: new Date().toISOString(), pages: screens.length, seconds: Math.round((Date.now() - t0) / 100) / 10, via: 'chrome' },
    screens,
    edges,
  };
}

export async function crawl(startUrl, opts = {}) {
  const o = { max: 40, maxDepth: 3, locale: 'es-ES', onNode: () => {}, onEdge: () => {}, onLog: () => {}, ...opts };
  if (!/^https?:\/\//i.test(startUrl)) throw new Error('La URL tiene que empezar por http:// o https://');
  if (!(await isPublicUrl(startUrl))) throw new Error('Solo se pueden explorar webs públicas');
  const fast = await crawlFast(startUrl, o);
  if (fast) return fast;
  o.onLog('la web se pinta con JavaScript: paso a Chrome');
  o.onReset?.();
  return crawlChrome(startUrl, o);
}
