// server/watcher.mjs — P3 (observador)
// Abre el Chrome del visitante, sabe en qué pantalla está y resalta un botón.
// Firmas exactas (contracts/api.md):
//   export async function open(url)       // → { ok: true }
//   export async function current()       // → Current, ≤ 1 KB
//   export async function highlight(text) // → { ok, found }
//
// Usa playwright-core con el Chrome instalado del usuario:
//   chromium.launch({ channel: 'chrome', headless: false })
// Si Chrome no arranca (sin display / sandbox), degradamos: guardamos la url
// en memoria y current() sigue respondiendo un objeto válido desde el fixture.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// ─── Estado singleton ────────────────────────────────────────────────────────
let browser = null;      // Browser de Playwright (o null si degradado)
let context = null;      // BrowserContext activo
let page = null;         // Page que estamos observando ahora
let currentUrl = '';     // última URL conocida (se mantiene también en modo degradado)
let launching = null;    // promesa de arranque en curso (evita dobles lanzamientos)

// ─── Mapa de la app (PLAN B / routes.mjs) ────────────────────────────────────
let routes = null;       // módulo explorer/routes.mjs si existe
let routesTried = false; // ya intentamos importarlo
let fixtureMap = null;    // app-map.example.json cacheado (PLAN B)

async function getRoutes() {
  if (routesTried) return routes;
  routesTried = true;
  try {
    routes = await import('../explorer/routes.mjs');
    if (!routes || typeof routes.loadMap !== 'function') routes = null;
  } catch {
    routes = null; // PLAN B: no existe todavía → usamos el fixture local
  }
  return routes;
}

async function getFixtureMap() {
  if (fixtureMap) return fixtureMap;
  const fs = await import('node:fs/promises');
  const raw = await fs.readFile(path.join(ROOT, 'contracts', 'app-map.example.json'), 'utf8');
  fixtureMap = JSON.parse(raw);
  return fixtureMap;
}

// ─── Lanzamiento de Chrome (singleton, degradable) ────────────────────────────
async function ensureBrowser() {
  if (browser) return browser;
  if (launching) return launching;
  launching = (async () => {
    try {
      browser = await chromium.launch({ channel: 'chrome', headless: false });
      context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      // TODO(live): si se abre una pestaña nueva, pasamos a observarla.
      context.on('page', (p) => { watchPage(p); });
      return browser;
    } catch (e) {
      // Degradado: sin display / sandbox. No es fatal — seguimos en memoria.
      browser = null; context = null; page = null;
      console.warn('[watcher] Chrome no pudo arrancar, modo degradado:', String(e.message || e));
      return null;
    } finally {
      launching = null;
    }
  })();
  return launching;
}

// TODO(live): engancha framenavigated del frame principal para seguir la URL.
function watchPage(p) {
  page = p;
  try {
    p.on('framenavigated', (frame) => {
      if (frame === p.mainFrame()) currentUrl = frame.url();
    });
  } catch {}
  try { currentUrl = p.url() || currentUrl; } catch {}
}

// ─── API ──────────────────────────────────────────────────────────────────────
export async function open(url) {
  currentUrl = url || currentUrl; // en modo degradado esto es todo lo que tenemos
  const b = await ensureBrowser();
  if (b && context) {
    // TODO(live): reutiliza la página si ya hay una; si no, crea una.
    try {
      const existing = context.pages();
      const p = existing.length ? existing[0] : await context.newPage();
      watchPage(p);
      await p.goto(url, { waitUntil: 'domcontentloaded' });
      currentUrl = p.url();
    } catch (e) {
      console.warn('[watcher] open() falló al navegar:', String(e.message || e));
    }
  }
  return { ok: true };
}

export async function current() {
  // 1) URL actual: del DOM si hay página viva, si no la que guardamos en memoria.
  let url = currentUrl;
  if (page) { try { url = page.url() || url; } catch {} }

  // 2) Pantalla + rutas desde el mapa (routes.mjs o, PLAN B, el fixture).
  let map = null, screen = null, rutas = [];
  const r = await getRoutes();
  try {
    if (r) {
      map = r.loadMap();
      screen = r.matchScreen ? r.matchScreen(map, url) : null;
      if (screen && r.routesFrom) rutas = normalizeRoutes(r.routesFrom(map, screen.id));
    } else {
      map = await getFixtureMap();
      screen = matchScreenFixture(map, url);
      if (screen) rutas = routesFromFixture(map, screen.id);
    }
  } catch (e) {
    console.warn('[watcher] current(): fallo leyendo el mapa:', String(e.message || e));
  }

  // 3) pantalla + acciones
  let pantalla = null;
  let acciones = [];
  if (screen) {
    pantalla = {
      id: screen.id,
      title: screen.title || '',
      purpose: screen.purpose || '',
    };
    acciones = (screen.actions || [])
      .map((a) => (typeof a === 'string' ? a : a.label))
      .filter(Boolean);
  } else {
    // URL no está en el mapa → pantalla:null y leemos acciones del DOM en vivo.
    pantalla = null;
    acciones = await liveActions();
  }

  // 4) recortes de contrato: ≤12 acciones, ≤6 rutas, ≤1 KB.
  acciones = dedupe(acciones).slice(0, 12);
  rutas = rutas.slice(0, 6);

  let out = { url, pantalla, acciones, rutas };
  out = shrinkToBudget(out);
  return out;
}

export async function highlight(text) {
  const needle = String(text || '').trim();
  if (!needle) return { ok: true, found: false };
  if (!page) return { ok: true, found: false }; // modo degradado: nada que resaltar

  try {
    const found = await page.evaluate((q) => {
      const low = q.toLowerCase();
      const nodes = Array.from(document.querySelectorAll('a, button, input, [role=button]'));
      const matches = (el) => {
        const t = (el.textContent || '').trim();
        const aria = el.getAttribute && (el.getAttribute('aria-label') || '');
        const ph = el.getAttribute && (el.getAttribute('placeholder') || '');
        const val = 'value' in el ? (el.value || '') : '';
        return [t, aria, ph, val].some((s) => s && s.toLowerCase().includes(low));
      };
      const el = nodes.find(matches);
      if (!el) return false;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const prevOutline = el.style.outline;
      const prevOffset = el.style.outlineOffset;
      const prevTransition = el.style.transition;
      el.style.transition = 'outline-color .4s ease-in-out';
      el.style.outline = '4px solid #ff3b30';
      el.style.outlineOffset = '2px';
      // pulso
      let on = true;
      const pulse = setInterval(() => {
        on = !on;
        el.style.outlineColor = on ? '#ff3b30' : 'rgba(255,59,48,0.2)';
      }, 450);
      setTimeout(() => {
        clearInterval(pulse);
        el.style.outline = prevOutline;
        el.style.outlineOffset = prevOffset;
        el.style.transition = prevTransition;
      }, 4000);
      return true;
    }, needle);
    return { ok: true, found: !!found };
  } catch (e) {
    console.warn('[watcher] highlight() falló:', String(e.message || e));
    return { ok: true, found: false };
  }
}

// ─── Helpers de mapa (PLAN B, sin routes.mjs) ─────────────────────────────────
function matchScreenFixture(map, url) {
  const screens = (map && map.screens) || [];
  return screens.find((s) => s.url === url) || null;
}

function routesFromFixture(map, screenId) {
  const screens = (map && map.screens) || [];
  const byId = Object.fromEntries(screens.map((s) => [s.id, s]));
  const out = [];
  for (const a of (byId[screenId]?.actions || [])) {
    if (!a.to) continue;
    const dest = byId[a.to];
    if (!dest) continue;
    out.push({ a: dest.title || a.to, pasos: [`pulsa «${a.label}»`] });
  }
  return out;
}

// routes.mjs devuelve [{ to, name, steps }] (api.md). Current quiere [{ a, pasos }].
// Aceptamos ambas formas por si cambia.
function normalizeRoutes(list) {
  if (!Array.isArray(list)) return [];
  return list.map((rt) => ({
    a: rt.a ?? rt.name ?? rt.to ?? '',
    pasos: rt.pasos ?? rt.steps ?? [],
  })).filter((rt) => rt.a);
}

// ─── Acciones en vivo desde el DOM (cuando la URL no está en el mapa) ──────────
async function liveActions() {
  if (!page) return [];
  try {
    return await page.evaluate(() => {
      const seen = new Set();
      const out = [];
      const vis = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      for (const el of document.querySelectorAll('a, button, input, [role=button]')) {
        if (!vis(el)) continue;
        let label = (el.textContent || '').trim();
        if (!label) label = (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.value || '').trim();
        label = label.replace(/\s+/g, ' ');
        if (!label || label.length > 40) continue;
        if (seen.has(label.toLowerCase())) continue;
        seen.add(label.toLowerCase());
        out.push(label);
        if (out.length >= 24) break;
      }
      return out;
    });
  } catch {
    return [];
  }
}

// ─── Utilidades de presupuesto ────────────────────────────────────────────────
function dedupe(arr) {
  const seen = new Set();
  const out = [];
  for (const x of arr) {
    const k = String(x).toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
}

// Mantiene el Current por debajo de ~1 KB recortando acciones/rutas si hace falta.
function shrinkToBudget(obj) {
  const size = (o) => Buffer.byteLength(JSON.stringify(o), 'utf8');
  while (size(obj) > 1024 && obj.acciones.length > 1) obj.acciones.pop();
  while (size(obj) > 1024 && obj.rutas.length > 0) obj.rutas.pop();
  return obj;
}

// Cierre limpio opcional (tests / shutdown).
export async function close() {
  try { if (browser) await browser.close(); } catch {}
  browser = null; context = null; page = null; launching = null;
}
