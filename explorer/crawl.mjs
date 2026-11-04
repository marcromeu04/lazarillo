// Agente de mapeo (librería). Recorre una web que no conoce y devuelve su grafo:
// cada página (nodo) con un resumen corto y sus enlaces (aristas). Avisa de cada
// nodo y arista según los descubre, para que el panel pinte el grafo en vivo.
//
//   const map = await crawl(url, { max: 30, onNode, onEdge, onLog });
//
// No envía formularios, no pulsa nada destructivo y no sale del dominio.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const SKIP = /\/meet\/|logout|log-out|signout|sign-out|delete|borrar|eliminar|salir|unsubscribe|cart\/add|checkout/i;
const FILES = /\.(pdf|jpe?g|png|gif|svg|zip|rar|mp4|mp3|webp|ico|xml|json|csv|docx?|xlsx?)(\?|$)/i;

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

export async function crawl(startUrl, opts = {}) {
  const { max = 30, maxDepth = 3, locale = 'es-ES', shotsDir = null, onNode = () => {}, onEdge = () => {}, onLog = () => {} } = opts;
  if (!/^https?:\/\//i.test(startUrl)) throw new Error('La URL tiene que empezar por http:// o https://');
  const host = hostOf(startUrl);
  const sameSite = (u) => hostOf(u) === host;
  if (shotsDir) mkdirSync(shotsDir, { recursive: true });

  const t0 = Date.now();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale, extraHTTPHeaders: { 'Accept-Language': `${locale},es;q=0.9,en;q=0.8` } });
  const page = await ctx.newPage();

  const queue = [{ url: normUrl(startUrl), depth: 0, from: null, via: null }];
  const seen = new Set([normUrl(startUrl)]);
  const screens = [];
  const byUrl = new Map();
  const edges = [];
  const pending = []; // aristas a nodos aún no visitados: se resuelven al final

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
        await page.waitForTimeout(400);
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

      const info = await page.evaluate(() => {
        const vis = (el) => {
          const r = el.getBoundingClientRect();
          const st = getComputedStyle(el);
          return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
        };
        const txt = (t) => (t || '').replace(/\s+/g, ' ').trim();
        const links = [];
        const seenL = new Set();
        for (const a of document.querySelectorAll('a[href]')) {
          if (!vis(a)) continue;
          const label = txt(a.innerText || a.getAttribute('aria-label') || a.title).slice(0, 40);
          if (!label || seenL.has(label + '|' + a.href)) continue;
          seenL.add(label + '|' + a.href);
          links.push({ label, href: a.href });
          if (links.length >= 40) break;
        }
        const buttons = [...document.querySelectorAll('button, [role=button], input[type=submit]')]
          .filter(vis)
          .map((b) => txt(b.innerText || b.value || b.getAttribute('aria-label')).slice(0, 40))
          .filter((v, i, arr) => v && arr.indexOf(v) === i)
          .slice(0, 15);
        return {
          title: txt(document.querySelector('h1')?.innerText || document.title).slice(0, 70),
          docTitle: txt(document.title).slice(0, 90),
          meta: txt(document.querySelector('meta[name="description"]')?.content || document.querySelector('meta[property="og:description"]')?.content),
          firstP: [...document.querySelectorAll('main p, article p, p')].map((p) => txt(p.innerText)).find((t) => t.length > 50) || '',
          headings: [...document.querySelectorAll('h1, h2')].filter(vis).map((h) => txt(h.innerText).slice(0, 70)).filter(Boolean).slice(0, 6),
          links,
          buttons,
        };
      });

      const id = 's' + String(screens.length + 1).padStart(2, '0');
      let screenshot = null;
      if (shotsDir) {
        screenshot = `${shotsDir}/${id}.png`;
        await page.screenshot({ path: screenshot }).catch(() => (screenshot = null));
      }
      const node = {
        id,
        url: finalUrl,
        path: new URL(finalUrl).pathname || '/',
        title: clean(info.title || info.docTitle || id, 70),
        summary: summarize(info),
        purpose: clean(info.meta || info.firstP, 160),
        headings: info.headings.map((h) => clean(h, 70)),
        actions: [
          ...info.links.map((l) => ({ label: clean(l.label, 40), kind: 'link', href: l.href, to: null })),
          ...info.buttons.map((b) => ({ label: clean(b, 40), kind: 'button', to: null })),
        ],
        depth: item.depth,
        screenshot,
      };
      screens.push(node);
      byUrl.set(finalUrl, id);
      onNode(node);
      addEdge(item.from, id, item.via);
      onLog(`${id} ${node.path} · ${node.title}`);

      for (const l of info.links) {
        let href;
        try {
          href = normUrl(l.href);
        } catch {
          continue;
        }
        if (!sameSite(href) || FILES.test(href) || SKIP.test(href) || SKIP.test(l.label) || /^(mailto|tel|javascript):/i.test(l.href)) continue;
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

  // Aristas hacia páginas que se visitaron más tarde.
  for (const p of pending) addEdge(p.from, byUrl.get(p.href), p.via);
  // Destino de cada acción, para que el agente sepa a dónde lleva cada enlace.
  for (const s of screens) for (const a of s.actions) if (a.href) {
    try {
      a.to = byUrl.get(normUrl(a.href)) || null;
    } catch {}
  }

  return {
    app: { name: screens[0]?.title || host, host, startUrl: normUrl(startUrl), exploredAt: new Date().toISOString(), pages: screens.length, seconds: Math.round((Date.now() - t0) / 1000) },
    screens,
    edges,
  };
}
