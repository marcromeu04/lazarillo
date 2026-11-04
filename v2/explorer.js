// Lazarillo v2 — Explorador profundo (P2)
//
// Pipeline en segundo plano que construye un MAPA MENTAL rico (brain.md + brain.json)
// de cualquier web ANTES de que empiece la conversación de voz.
//
//   1. Crawl ≤10 páginas internas (cheerio, Chrome UA, 6s timeout, 5 concurrentes).
//   2. Una llamada a Claude POR pantalla: entiende a fondo qué PUEDE HACER el usuario ahí
//      (propósito + funcionalidades + key_elements exactos + wow + cómo llegar). Pool de ~5.
//   3. Una llamada final que ensambla product, edges, suggested_tour, main_nav.
//   4. Emite brain.json EXACTO (shape de CONTRACTS.md) y brain.md en prosa limpia.
//
// Degrada con elegancia: sin ANTHROPIC_API_KEY o sin red, produce igualmente un brain.json
// a partir de la extracción cheerio (funcionalidades heurísticas) y marca "degraded": true.
//
// Uso como módulo:  const { brainJson, brainMd } = await buildBrain(url, { fresh, onProgress });
// Uso como CLI:     node v2/explorer.js <url>   → escribe cache/<dominio>.brain.json y .brain.md

import * as cheerio from 'cheerio';
import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAP_MODEL = process.env.MAP_MODEL || 'claude-sonnet-5-5';
const CACHE_DIR = path.join(__dirname, 'cache');

const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

// ------------------------------------------------------------------ crawler (copiado de v1 server.js)

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
const BAD_PATH =
  /(mailto:|tel:|javascript:|login|signin|sign-in|logout|aviso-legal|legal|privacy|privacidad|cookie|terms|terminos)/i;

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
    title: ($('title').first().text() || $('h1').first().text() || u.pathname)
      .trim().replace(/\s+/g, ' ').slice(0, 120),
    description: ($('meta[name=description]').attr('content') ||
      $('meta[property="og:description"]').attr('content') || '').trim().slice(0, 300),
    headings: headings.slice(0, 15),
    menu,
    buttons: [...new Set([...buttons, ...shortLinks])].slice(0, 30),
    form: [...new Set(formBits)].slice(0, 15),
    text: bodyText,
  };
}

// Concurrency-limited map. Preserves index order, drops nulls.
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
  await Promise.all(Array.from({ length: Math.min(size, items.length) || 1 }, run));
  return results.filter((r) => r !== null && r !== undefined);
}

// ------------------------------------------------------------------ slugs & heuristics

function slugFromPath(p) {
  const clean = (p || '/').split('?')[0].replace(/\/+$/, '');
  if (clean === '' || clean === '/') return 'home';
  const parts = clean.split('/').filter(Boolean);
  const slug = parts.join('-')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip accents
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || 'page';
}

// Ensure every screen gets a unique, stable id.
function assignIds(pages) {
  const used = new Set();
  return pages.map((p) => {
    let base = slugFromPath(p.path);
    let id = base;
    let n = 2;
    while (used.has(id)) id = `${base}-${n++}`;
    used.add(id);
    return { ...p, id };
  });
}

// Heuristic functionalities, used when there is no model (degraded mode) and as a
// fallback floor for the deep-understanding prompt.
function heuristicFunctionalities(p) {
  const fns = [];
  const btns = (p.buttons || []).map((b) => b.toLowerCase());
  const has = (re) => btns.some((b) => re.test(b)) ||
    re.test((p.text || '').toLowerCase()) ||
    (p.form || []).some((f) => re.test(f.toLowerCase()));

  if ((p.form || []).length) fns.push('Rellenar y enviar un formulario');
  if (has(/(sign up|registr|crear cuenta|get started|empezar|prueba|trial|free)/))
    fns.push('Crear una cuenta o empezar una prueba');
  if (has(/(login|iniciar sesión|entrar|sign in|acceder)/))
    fns.push('Iniciar sesión');
  if (has(/(price|precio|plan|pricing|tarifa)/))
    fns.push('Ver precios y planes');
  if (has(/(contact|contacto|demo|hablar|book|reserva|agenda)/))
    fns.push('Contactar o reservar una demo');
  if (has(/(download|descargar|install|instalar)/))
    fns.push('Descargar o instalar');
  if (has(/(search|buscar)/))
    fns.push('Buscar contenido');
  if (has(/(blog|article|artículo|post|noticia|news)/))
    fns.push('Leer artículos o noticias');
  if (!fns.length) fns.push('Leer información sobre el producto');
  return [...new Set(fns)].slice(0, 6);
}

function heuristicWow(p) {
  if ((p.headings || []).length) return p.headings[0];
  if (p.description) return p.description.slice(0, 120);
  return p.title;
}

// Say the path in a human way, for degraded how_to_get_here.
function spokenLocation(p, isHome) {
  if (isHome) return 'es la página de inicio, lo primero que ves al entrar';
  const label = (p.menu || []).find((m) => m) || p.title;
  return `arriba en el menú, en "${label}"`;
}

// ------------------------------------------------------------------ Claude: per-screen deep understanding

const SCREEN_SCHEMA = {
  type: 'object',
  properties: {
    purpose: { type: 'string', description: 'Una sola frase: para qué sirve esta pantalla.' },
    functionalities: {
      type: 'array',
      items: { type: 'string' },
      description: 'Qué PUEDE HACER el usuario aquí, en lenguaje natural. Acciones y flujos concretos, no descripciones de texto.',
    },
    key_elements: {
      type: 'array',
      items: { type: 'string' },
      description: 'Textos EXACTOS de botones/enlaces/títulos tal y como aparecen (para resaltar en pantalla).',
    },
    wow: { type: 'string', description: 'Lo más potente o impresionante de esta pantalla, una frase.' },
    how_to_get_here: { type: 'string', description: 'Cómo se llega, dicho como se habla (p.ej. "arriba a la derecha, en Precios").' },
  },
  required: ['purpose', 'functionalities', 'key_elements', 'wow', 'how_to_get_here'],
};

async function deepUnderstandScreen(anthropic, page, ctx) {
  const compact = {
    path: page.path,
    title: page.title,
    description: page.description,
    headings: page.headings,
    menu: page.menu,
    buttons: page.buttons,
    form: page.form,
    text: (page.text || '').slice(0, 900),
  };
  const msg = await anthropic.messages.create({
    model: MAP_MODEL,
    max_tokens: 1000,
    tools: [{
      name: 'describe_screen',
      description: 'Entrega el entendimiento profundo de una pantalla.',
      input_schema: SCREEN_SCHEMA,
    }],
    tool_choice: { type: 'tool', name: 'describe_screen' },
    messages: [{
      role: 'user',
      content:
        `Eres un analista de producto experto que prepara a un guía de voz. ` +
        `Analiza A FONDO esta ÚNICA pantalla de la web "${ctx.siteUrl}" (producto: ${ctx.productName}). ` +
        `No describas el texto: deduce qué ACCIONES y FLUJOS puede realizar el usuario aquí ` +
        `(p.ej. "filtrar resultados por precio", "crear una cuenta en 2 pasos", "comparar planes"). ` +
        `En key_elements usa SIEMPRE los textos EXACTOS que ves en buttons/menu/headings (se usarán para ` +
        `resaltar en la pantalla real, así que no los parafrasees). how_to_get_here descrito como se habla.\n\n` +
        `Menú global del sitio: ${(ctx.mainNav || []).join(', ') || '(desconocido)'}\n\n` +
        `Datos de la pantalla:\n${JSON.stringify(compact)}`,
    }],
  });
  const tool = msg.content.find((c) => c.type === 'tool_use');
  return tool ? tool.input : null;
}

// ------------------------------------------------------------------ Claude: final assembly

const ASSEMBLY_SCHEMA = {
  type: 'object',
  properties: {
    product: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        one_liner: { type: 'string', description: 'Una frase que explica el producto.' },
        audience: { type: 'string', description: 'Para quién es.' },
      },
      required: ['name', 'one_liner', 'audience'],
    },
    edges: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'id de la pantalla origen' },
          to: { type: 'string', description: 'id de la pantalla destino' },
          via: { type: 'string', description: 'texto EXACTO del enlace/botón que lleva de una a otra' },
        },
        required: ['from', 'to', 'via'],
      },
    },
    suggested_tour: {
      type: 'array',
      items: { type: 'string' },
      description: 'ids de pantalla en el orden ideal para una demo, empezando por lo más impresionante.',
    },
    main_nav: { type: 'array', items: { type: 'string' }, description: 'etiquetas del menú principal' },
  },
  required: ['product', 'edges', 'suggested_tour', 'main_nav'],
};

async function assembleGraph(anthropic, siteUrl, domain, screens, candidateNav) {
  const compact = screens.map((s) => ({
    id: s.id,
    path: s.path,
    title: s.title,
    purpose: s.purpose,
    functionalities: s.functionalities,
    key_elements: (s.key_elements || []).slice(0, 12),
    wow: s.wow,
  }));
  const msg = await anthropic.messages.create({
    model: MAP_MODEL,
    max_tokens: 1500,
    tools: [{
      name: 'submit_graph',
      description: 'Entrega el producto, el grafo de navegación y el tour.',
      input_schema: ASSEMBLY_SCHEMA,
    }],
    tool_choice: { type: 'tool', name: 'submit_graph' },
    messages: [{
      role: 'user',
      content:
        `Tienes el análisis profundo de ${screens.length} pantallas de la web "${siteUrl}". ` +
        `Ensambla el mapa mental global:\n` +
        `- product: nombre real, one_liner y audiencia, deducidos de las pantallas.\n` +
        `- edges: conexiones from→to entre ids EXISTENTES; "via" es el texto exacto del enlace/botón que lleva de una a otra. ` +
        `Infiere desde los key_elements y el menú.\n` +
        `- suggested_tour: ids en el orden ideal para impresionar a un visitante nuevo (lo wow primero, luego el flujo lógico).\n` +
        `- main_nav: etiquetas del menú principal.\n` +
        `Usa SOLO estos ids: ${screens.map((s) => s.id).join(', ')}.\n` +
        `Candidatos a menú principal observados: ${(candidateNav || []).join(', ')}\n\n` +
        JSON.stringify(compact),
    }],
  });
  const tool = msg.content.find((c) => c.type === 'tool_use');
  return tool ? tool.input : null;
}

// ------------------------------------------------------------------ graph derivation (degraded)

function deriveGraphHeuristically(screens, domain, candidateNav) {
  const home = screens[0];
  const ids = new Set(screens.map((s) => s.id));
  const edges = [];
  // From home, link to every other screen via its menu/title label.
  for (const s of screens) {
    if (s.id === home.id) continue;
    const via = (home.menu || []).find((m) =>
      s.title.toLowerCase().includes(m.toLowerCase()) ||
      m.toLowerCase().includes((s.title.split(/[\s|–-]/)[0] || '').toLowerCase())
    ) || s.title;
    edges.push({ from: home.id, to: s.id, via });
  }
  return {
    product: {
      name: (home.title || domain).split(/[\s|–-]/)[0] || domain,
      one_liner: home.description || home.purpose || '',
      audience: '', // TODO(live): sin modelo no se puede inferir audiencia con fiabilidad
    },
    edges,
    suggested_tour: screens.map((s) => s.id),
    main_nav: (candidateNav || []).slice(0, 8),
  };
}

// ------------------------------------------------------------------ render brain.md

function renderBrainMd(brain) {
  const L = [];
  const prod = brain.product || {};
  L.push(`# ${prod.name || 'Producto'}`);
  L.push('');
  if (prod.one_liner) L.push(prod.one_liner);
  if (prod.audience) L.push(`Para: ${prod.audience}`);
  if (brain.degraded) L.push('');
  if (brain.degraded) L.push('_(mapa en modo degradado: construido sin modelo de lenguaje)_');
  L.push('');

  if ((brain.main_nav || []).length) {
    L.push(`Menú principal: ${brain.main_nav.join(' · ')}`);
    L.push('');
  }

  L.push('## Pantallas');
  L.push('');
  for (const s of brain.screens || []) {
    L.push(`### ${s.title}  (${s.path})`);
    if (s.purpose) L.push(s.purpose);
    L.push('');
    if ((s.functionalities || []).length) {
      L.push('Aquí el usuario puede:');
      for (const f of s.functionalities) L.push(`- ${f}`);
      L.push('');
    }
    if (s.how_to_get_here) { L.push(`Cómo llegar: ${s.how_to_get_here}`); L.push(''); }
    if ((s.key_elements || []).length) {
      L.push(`Elementos exactos (para resaltar): ${s.key_elements.map((e) => `"${e}"`).join(', ')}`);
      L.push('');
    }
    if (s.wow) { L.push(`Lo más potente: ${s.wow}`); L.push(''); }
  }

  if ((brain.suggested_tour || []).length) {
    const titleById = Object.fromEntries((brain.screens || []).map((s) => [s.id, s.title]));
    L.push('## Tour sugerido');
    L.push(brain.suggested_tour.map((id) => titleById[id] || id).join(' → '));
    L.push('');
  }
  return L.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

// ------------------------------------------------------------------ reachable_from from edges

function computeReachable(screens, edges) {
  const inbound = {};
  for (const e of edges || []) {
    if (!inbound[e.to]) inbound[e.to] = new Set();
    inbound[e.to].add(e.from);
  }
  for (const s of screens) {
    s.reachable_from = inbound[s.id] ? [...inbound[s.id]] : [];
  }
}

// ------------------------------------------------------------------ main pipeline

export async function buildBrain(url, { fresh = false, onProgress } = {}) {
  const emit = (evt) => { try { onProgress && onProgress(evt); } catch { /* never let UI break the build */ } };

  const home = new URL(url);
  const domain = home.hostname.replace(/^www\./, '');
  const jsonFile = path.join(CACHE_DIR, domain + '.brain.json');
  const mdFile = path.join(CACHE_DIR, domain + '.brain.md');

  if (!fresh && fs.existsSync(jsonFile) && fs.existsSync(mdFile)) {
    const brainJson = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
    const brainMd = fs.readFileSync(mdFile, 'utf8');
    emit({ type: 'cached', domain });
    return { brainJson, brainMd };
  }

  // ---- 1. Crawl -------------------------------------------------------------
  const homePage = await extractPage(home.href);
  if (!homePage) throw new Error('could not read home page: ' + home.href);
  emit({ type: 'screen', id: 'home', title: homePage.title });

  const links = (homePage.links || []).filter((l) => {
    try { return new URL(l).pathname !== home.pathname; } catch { return false; }
  });
  const toVisit = [...new Set(links)].slice(0, 9); // + home = 10 max

  const rest = await pool(toVisit, 5, async (link) => {
    const p = await extractPage(link);
    if (p) emit({ type: 'screen', id: slugFromPath(p.path), title: p.title });
    return p;
  });

  let pages = assignIds([homePage, ...rest]);
  // dedupe by id already handled; also dedupe identical paths kept by crawler order
  const candidateNav = homePage.menu || [];

  // ---- decide live vs degraded ---------------------------------------------
  const haveKey = !!process.env.ANTHROPIC_API_KEY;
  let degraded = !haveKey;
  let anthropic = null;
  if (haveKey) anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // ---- 2. Per-screen deep understanding ------------------------------------
  const productGuess = (homePage.title || domain).split(/[\s|–-]/)[0] || domain;
  const screens = pages.map((p) => ({ ...p })); // working copy

  if (anthropic) {
    const deep = await pool(screens, 5, async (page) => {
      // TODO(live): si una llamada falla por red/rate-limit, caemos a heurística para ESA pantalla.
      try {
        const out = await deepUnderstandScreen(anthropic, page, {
          siteUrl: home.href, productName: productGuess, mainNav: candidateNav,
        });
        emit({ type: 'deep', id: page.id });
        return { id: page.id, out };
      } catch (e) {
        emit({ type: 'deep', id: page.id });
        return { id: page.id, out: null };
      }
    });
    const byId = Object.fromEntries(deep.map((d) => [d.id, d.out]));
    for (const s of screens) {
      const u = byId[s.id];
      if (u) {
        s.purpose = u.purpose;
        s.functionalities = u.functionalities;
        s.key_elements = u.key_elements;
        s.wow = u.wow;
        s.how_to_get_here = u.how_to_get_here;
      } else {
        degraded = true; // at least one screen fell back
        fillHeuristic(s, s === screens[0]);
      }
    }
  } else {
    for (const s of screens) fillHeuristic(s, s === screens[0]);
  }

  // ---- 3. Final assembly ----------------------------------------------------
  let graph = null;
  if (anthropic) {
    try {
      graph = await assembleGraph(anthropic, home.href, domain, screens, candidateNav);
    } catch (e) {
      degraded = true;
      graph = null;
    }
  }
  if (!graph) graph = deriveGraphHeuristically(screens, domain, candidateNav);

  // ---- 4. Build brain.json (EXACT CONTRACTS shape) -------------------------
  const outScreens = screens.map((s) => ({
    id: s.id,
    path: s.path,
    title: s.title,
    purpose: s.purpose || '',
    functionalities: s.functionalities || [],
    key_elements: s.key_elements || [],
    wow: s.wow || '',
    how_to_get_here: s.how_to_get_here || '',
    reachable_from: [],
  }));

  // Keep only edges that reference existing ids.
  const idSet = new Set(outScreens.map((s) => s.id));
  const edges = (graph.edges || []).filter((e) => idSet.has(e.from) && idSet.has(e.to) && e.from !== e.to);
  computeReachable(outScreens, edges);

  // suggested_tour / main_nav sanity
  const tour = (graph.suggested_tour || []).filter((id) => idSet.has(id));
  for (const s of outScreens) if (!tour.includes(s.id)) tour.push(s.id); // ensure completeness

  const brainJson = {
    product: {
      name: (graph.product && graph.product.name) || productGuess,
      one_liner: (graph.product && graph.product.one_liner) || homePage.description || '',
      audience: (graph.product && graph.product.audience) || '',
    },
    screens: outScreens,
    edges,
    suggested_tour: tour,
    main_nav: (graph.main_nav && graph.main_nav.length ? graph.main_nav : candidateNav).slice(0, 10),
    degraded,
  };

  const brainMd = renderBrainMd(brainJson);

  // ---- persist --------------------------------------------------------------
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(jsonFile, JSON.stringify(brainJson, null, 2));
  fs.writeFileSync(mdFile, brainMd);
  emit({ type: 'done', domain, degraded });

  return { brainJson, brainMd };
}

function fillHeuristic(s, isHome) {
  s.purpose = s.purpose || s.description || `Pantalla "${s.title}" del sitio.`;
  s.functionalities = s.functionalities || heuristicFunctionalities(s);
  s.key_elements = s.key_elements || [...(s.headings || []).slice(0, 4), ...(s.buttons || []).slice(0, 8)];
  s.wow = s.wow || heuristicWow(s);
  s.how_to_get_here = s.how_to_get_here || spokenLocation(s, isHome);
}

// ------------------------------------------------------------------ CLI

const isMain = (() => {
  try { return process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1]); }
  catch { return false; }
})();

if (isMain) {
  const url = process.argv[2];
  if (!url) {
    console.error('Uso: node v2/explorer.js <url>');
    process.exit(1);
  }
  buildBrain(url, {
    fresh: process.argv.includes('--fresh'),
    onProgress: (evt) => {
      if (evt.type === 'screen') console.error(`  · pantalla: ${evt.title} (${evt.id})`);
      else if (evt.type === 'deep') console.error(`  ✓ entendida: ${evt.id}`);
      else if (evt.type === 'cached') console.error(`  (desde caché: ${evt.domain})`);
      else if (evt.type === 'done') console.error(`  listo${evt.degraded ? ' (degradado)' : ''}: ${evt.domain}`);
    },
  })
    .then(({ brainJson }) => {
      const domain = new URL(url).hostname.replace(/^www\./, '');
      console.error(`\nEscrito cache/${domain}.brain.json y cache/${domain}.brain.md`);
      console.error(`Pantallas: ${brainJson.screens.length} · edges: ${brainJson.edges.length} · degraded: ${brainJson.degraded}`);
    })
    .catch((e) => {
      console.error('ERROR:', e.message);
      process.exit(1);
    });
}
