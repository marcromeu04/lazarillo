// Agente explorador: recorre una web que no conoce y deja su mapa en brain/app-map.json.
// Uso: node explorer/explore.mjs <url> [--max 25]
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";

const args = process.argv.slice(2);
const startUrl = args.find((a) => /^https?:\/\//.test(a)) || process.env.TARGET_URL;
const max = Number(args[args.indexOf("--max") + 1]) || 25;
const MAX_DEPTH = 3;
if (!startUrl) throw new Error("Uso: node explorer/explore.mjs <url> [--max 25]");

const SKIP = /logout|log-out|signout|sign-out|delete|borrar|eliminar|salir|unsubscribe/i;
const FILES = /\.(pdf|jpe?g|png|gif|svg|zip|rar|mp4|mp3|webp|ico|xml|json|csv|docx?|xlsx?)(\?|$)/i;

const origin = new URL(startUrl).origin;
const sameOrigin = (u) => {
  try {
    return new URL(u).origin === origin;
  } catch {
    return false;
  }
};
const norm = (u) => {
  const x = new URL(u);
  x.hash = "";
  return x.href.replace(/\/index\.html?$/, "/");
};

mkdirSync("brain/shots", { recursive: true });
rmSync("brain/shots", { recursive: true, force: true });
mkdirSync("brain/shots", { recursive: true });

const t0 = Date.now();
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const queue = [{ url: norm(startUrl), depth: 0 }];
const seen = new Set([norm(startUrl)]);
const screens = [];

while (queue.length && screens.length < max) {
  const { url, depth } = queue.shift();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 10000 });
    await page.waitForTimeout(300);
  } catch {
    continue;
  }
  const finalUrl = norm(page.url());
  if (!sameOrigin(finalUrl)) continue;
  if (screens.some((s) => s.url === finalUrl)) continue;

  const info = await page.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none";
    };
    const clean = (t) => (t || "").replace(/\s+/g, " ").trim().slice(0, 40);
    const meta = document.querySelector('meta[name="description"]')?.content || "";
    const firstP = [...document.querySelectorAll("main p, article p, p")].map((p) => p.innerText.trim()).find((t) => t.length > 40) || "";
    const headings = [...document.querySelectorAll("h1, h2")].filter(vis).map((h) => clean(h.innerText)).filter(Boolean).slice(0, 5);
    const links = [];
    const seenL = new Set();
    for (const a of document.querySelectorAll("a[href]")) {
      if (!vis(a)) continue;
      const label = clean(a.innerText || a.getAttribute("aria-label") || a.title);
      if (!label) continue;
      const key = label + "|" + a.href;
      if (seenL.has(key)) continue;
      seenL.add(key);
      links.push({ label, href: a.href });
      if (links.length >= 30) break;
    }
    const buttons = [...document.querySelectorAll("button, [role=button], input[type=submit]")]
      .filter(vis)
      .map((b) => clean(b.innerText || b.value || b.getAttribute("aria-label")))
      .filter(Boolean)
      .filter((v, i, arr) => arr.indexOf(v) === i)
      .slice(0, 15);
    const inputs = [...document.querySelectorAll("input:not([type=hidden]):not([type=submit]), textarea, select")]
      .filter(vis)
      .map((i) => clean(i.getAttribute("aria-label") || i.placeholder || i.name || i.id))
      .filter(Boolean)
      .slice(0, 10);
    return {
      title: (document.querySelector("h1")?.innerText || document.title || "").replace(/\s+/g, " ").trim().slice(0, 60),
      purpose: (meta || firstP).replace(/\s+/g, " ").trim().slice(0, 160),
      headings,
      links,
      buttons,
      inputs,
    };
  });

  const id = "s" + String(screens.length + 1).padStart(2, "0");
  const shot = `brain/shots/${id}.png`;
  await page.screenshot({ path: shot }).catch(() => {});
  screens.push({ id, url: finalUrl, depth, ...info, screenshot: shot });
  process.stdout.write(`${id} ${finalUrl}\n`);

  if (depth < MAX_DEPTH) {
    for (const l of info.links) {
      let href;
      try {
        href = norm(l.href);
      } catch {
        continue;
      }
      if (!sameOrigin(href) || FILES.test(href) || SKIP.test(href) || SKIP.test(l.label)) continue;
      if (/^(mailto|tel|javascript):/i.test(l.href)) continue;
      if (seen.has(href)) continue;
      seen.add(href);
      queue.push({ url: href, depth: depth + 1 });
    }
  }
}
await browser.close();

// Grafo: acciones con destino y aristas.
const byUrl = new Map(screens.map((s) => [s.url, s.id]));
const edges = [];
const out = screens.map((s) => {
  const actions = [];
  for (const l of s.links) {
    let to = null;
    try {
      to = byUrl.get(norm(l.href)) || null;
    } catch {}
    if (to === s.id) continue;
    actions.push({ label: l.label, kind: "link", to });
    if (to && !edges.some((e) => e.from === s.id && e.to === to)) edges.push({ from: s.id, to, via: l.label });
  }
  for (const b of s.buttons) actions.push({ label: b, kind: "button", to: null });
  for (const i of s.inputs) actions.push({ label: i, kind: "input", to: null });
  return { id: s.id, url: s.url, title: s.title || s.headings[0] || s.id, purpose: s.purpose, headings: s.headings, actions, screenshot: s.screenshot };
});

const map = {
  app: { name: out[0]?.title || origin, startUrl: norm(startUrl), exploredAt: new Date().toISOString(), pages: out.length, seconds: Math.round((Date.now() - t0) / 1000) },
  screens: out,
  edges,
};
writeFileSync("brain/app-map.json", JSON.stringify(map, null, 2));
console.log(`\nMapa: ${out.length} pantallas, ${edges.length} transiciones, ${map.app.seconds} s → brain/app-map.json`);
