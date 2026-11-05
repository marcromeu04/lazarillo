// Capa de conceptos del grafo (la idea de Graphify, llevada a las demos de producto).
//
// Las páginas siguen siendo la base (dónde se puede ir y qué se pulsa). Encima, una segunda capa con
// de qué habla la web: funciones, problemas que resuelve, para quién es, integraciones, clientes y
// precios. Cada concepto se une a las páginas donde aparece, y cada conexión lleva su tipo y si se ha
// leído en la página («extraída») o se ha deducido («inferida»).
//
// Además: grupos de páginas por tema (para colorear el grafo), páginas centrales y un informe de la web
// (qué vende, el mayor problema que resuelve, para quién, recorridos de demo y preguntas sugeridas).
// Todo sin modelo: títulos, titulares, rutas y enlaces que ya trae el mapa.

const deacc = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const clip = (t, n) => {
  const s = String(t ?? '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s;
};
const pretty = (slug) => String(slug || '').replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export const TYPES = {
  problema: 'Problema que resuelve',
  funcion: 'Función',
  equipo: 'Para quién',
  integracion: 'Integración',
  cliente: 'Cliente',
  precio: 'Precios',
};
const TYPE_ORDER = Object.keys(TYPES);

// ---------- grupos de páginas por tema (segmento de la ruta tras el idioma) ----------
const LANGS = new Set('es en pt de fr it nl ca eu gl pl ja zh ko ru sv da no fi tr ar he cs ro hu el uk'.split(' '));
const isLang = (s) => !!s && (LANGS.has(s.toLowerCase()) || /^[a-z]{2}-[a-z]{2}$/i.test(s));
const GROUPS = [
  ['Producto', /^(products?|productos?|features?|funcionalidades|funciones|platform|plataforma|herramientas|tools|modulos?|modules?|software)$/],
  ['Soluciones', /^(solutions?|soluciones|sales|ventas|marketing|onboarding|enablement|internal-enablement|support|soporte|enterprise|empresas|pymes|autonomos|freelancers?|asesorias|gestorias|agencias|startups|use-cases|casos-de-uso|industries|industrias|sectores|website-demo|equipos|teams|para)$/],
  ['Casos de éxito', /^(customers?|clientes|casos|case-studies|casos-de-exito|testimonials|testimonios|success-stories|historias)$/],
  ['Demos', /^(demos?|tours?|ejemplos)$/],
  ['Precios', /^(pricing|precios|planes|plans|tarifas)$/],
  ['Integraciones', /^(integrations?|integraciones|conectores|connectors|marketplace|apps)$/],
  ['Recursos', /^(blog|recursos|resources|guides?|guias|docs?|documentacion|help|ayuda|academy|academia|webinars?|ebooks?|research|news|noticias|prensa|press|media-kit|plantillas|templates|glosario|glossary|changelog|podcast)$/],
  ['Empresa', /^(about|about-us|sobre|sobre-nosotros|nosotros|quienes-somos|empresa|company|careers|empleo|trabaja-con-nosotros|jobs|team|contact|contacto|contact-demo|contact-sales|legal|privacy|privacidad|terms|terminos|cookies|migrate|partners|socios|security|seguridad)$/],
];
const segs = (p) => String(p || '/').split(/[/?#]/).filter(Boolean);
function startLocale(map) {
  try {
    const s = segs(new URL(map.app.startUrl || map.screens[0]?.url).pathname)[0];
    return isLang(s) ? s.toLowerCase() : '';
  } catch {
    return '';
  }
}
function mainLang(page, loc) {
  const s = (segs(page.path)[0] || '').toLowerCase();
  if (loc) return s === loc;
  return !isLang(s);
}
function groupsOf(map, loc) {
  const raw = new Map();
  for (const p of map.screens) {
    if (!mainLang(p, loc)) { raw.set(p.id, 'Otros idiomas'); continue; }
    const rest = segs(p.path).slice(loc ? 1 : 0);
    if (!rest.length) { raw.set(p.id, 'Portada'); continue; }
    const seg = deacc(rest[0]);
    const hit = GROUPS.find(([, rx]) => rx.test(seg));
    raw.set(p.id, hit ? hit[0] : `?${seg}`);
  }
  // segmentos sin grupo conocido: con 3 o más páginas son un grupo propio; si no, «Otras»
  const count = new Map();
  for (const g of raw.values()) count.set(g, (count.get(g) || 0) + 1);
  const groups = {};
  for (const [id, g] of raw) groups[id] = g.startsWith('?') ? ((count.get(g) || 0) >= 3 ? pretty(g.slice(1)) : 'Otras') : g;
  const list = new Map();
  for (const g of Object.values(groups)) list.set(g, (list.get(g) || 0) + 1);
  const order = ['Portada', 'Producto', 'Soluciones', 'Casos de éxito', 'Demos', 'Precios', 'Integraciones', 'Recursos', 'Empresa'];
  const groupList = [...list].map(([label, n]) => ({ label, n })).sort((a, b) => {
    const ia = order.indexOf(a.label), ib = order.indexOf(b.label);
    return (ia < 0 ? 50 : ia) - (ib < 0 ? 50 : ib) || b.n - a.n;
  });
  return { groups, groupList };
}

// ---------- léxicos (texto sin tildes y en minúsculas) ----------
const TEAMS = [
  ['Ventas', /\b(ventas|vender mas|comerciales?|sales|preventa|presales|sdrs?|bdrs?|account executives?|vendedores|sales engineers?)\b/],
  ['Marketing', /\b(marketing|growth|campanas|generacion de demanda)\b/],
  ['Soporte', /\b(soporte|support|atencion al cliente|customer support|helpdesk)\b/],
  ['Onboarding', /\b(onboarding|activacion de usuarios|adopcion)\b/],
  ['Customer Success', /\b(customer success|exito del cliente|csms?)\b/],
  ['Enablement', /\b(enablement|formacion interna|forma a tu equipo)\b/],
  ['Equipos de producto', /\b(product managers?|equipos? de producto|product teams?)\b/],
  ['RR. HH.', /\b(rrhh|recursos humanos|nominas|gestion de empleados)\b/],
  ['Finanzas', /\b(finanzas|contabilidad|contables?|facturacion|tesoreria|accounting)\b/],
  ['Autónomos', /\b(autonomos?|freelances?|freelancers?)\b/],
  ['Pymes', /\b(pymes?|pequenas empresas|small business(es)?|smbs?)\b/],
  ['Enterprise', /\b(enterprise|grandes empresas|corporativ[oa]s)\b/],
  ['Asesorías', /\b(asesorias?|gestorias?|despachos)\b/],
  ['Agencias', /\b(agencias|agencies)\b/],
  ['E-commerce', /\b(e-?commerce|tiendas? online)\b/],
];
const TOOLS = ['HubSpot', 'Salesforce', 'Pipedrive', 'Slack', 'Microsoft Teams', 'Zoom', 'Google Meet', 'Gmail', 'Outlook', 'Google Calendar', 'Calendly', 'Zapier', 'Notion', 'Jira', 'Zendesk', 'Intercom', 'Shopify', 'WooCommerce', 'Stripe', 'PayPal', 'WhatsApp', 'Gong', 'Salesloft', 'Marketo', 'Mailchimp', 'Webflow', 'WordPress', 'Figma', 'Asana', 'Trello', 'QuickBooks', 'Xero', 'DocuSign', 'Google Drive', 'Dropbox', 'Airtable', 'Freshworks', 'Segment', 'MCP', 'API'];
const TOOL_RX = TOOLS.map((t) => [t, new RegExp(`(^|[^a-z0-9])${deacc(t).replace(/[.]/g, '\\.')}([^a-z0-9]|$)`)]);
const INTEGRATION_CTX = /\b(integra|integraciones?|integrations?|conecta|conector|funciona con|se sincroniza|sincroniza|crm|herramientas que ya usa|works with|connects?)\b/;
const PRICE_RX = /\b(precios?|planes|tarifas?|pricing|plans?)\b|€|\/mes|por usuario/;
// Titulares que cuentan un dolor o el contraste «antes / ahora» (lo que la web promete quitarte).
const PAIN_RX = /(^|[,.]\s*)no\s|\bno (mas|sin)\b|deja (atras|de)\b|olvidate|\bsin (esperas|agenda|formularios?|tickets|errores|papeleo|esfuerzo)\b|pierd|\bperd(er|eis|emos|ida)\b|tarda|a mano\b|manual|agenda llena|cuello de botella|\breto\b|problema|evita|ahorra|reduce|antes y despues|devuelvele|ya no tiene|cada (visitante|usuario) recibe|\bdon'?t\b|no more|\bstop\b|\bwithout\b/;
const NOT_FUNCTION = /^(ejemplos?|demo|demos|casos?|blog|careers|sobre|about|contact|contacto|reserva|prueba|pasate|research|media|equipos? que|la confianza|resultados|mira como|como funciona|todo lo que|mas demos)\b/;

const brandOf = (map) => deacc(String(map.app.name || map.app.host || '').split(/[\s:|–—-]+/)[0] || '');

function teamsIn(text) {
  const t = deacc(text);
  return TEAMS.filter(([, rx]) => rx.test(t)).map(([label]) => label);
}

/** Construye la capa de conceptos, los grupos y el informe a partir del mapa de páginas. */
export function buildKnowledge(map) {
  const screens = map.screens || [];
  const loc = startLocale(map);
  const { groups, groupList } = groupsOf(map, loc);
  const brand = brandOf(map);
  const main = screens.filter((p) => mainLang(p, loc));
  const byId = new Map(screens.map((s) => [s.id, s]));

  const concepts = new Map(); // clave → concepto
  const pc = []; // página → concepto
  const add = (type, label, pageId, rel, extra = {}) => {
    const key = `${type}:${deacc(label)}`;
    let c = concepts.get(key);
    if (!c) {
      c = { key, type, label, pages: [], explains: [], weight: 0, ...extra };
      concepts.set(key, c);
    }
    if (!c.pages.includes(pageId)) {
      c.pages.push(pageId);
      c.weight += rel === 'explica' ? 2 : 1;
      if (rel === 'explica') c.explains.push(pageId);
      pc.push({ page: pageId, key, rel, conf: 'extraída' });
    } else if (rel === 'explica' && !c.explains.includes(pageId)) {
      c.explains.push(pageId);
      c.weight += 1;
      const e = pc.find((x) => x.page === pageId && x.key === key);
      if (e) e.rel = 'explica';
    }
    return c;
  };

  for (const p of main) {
    const title = p.title || '';
    const heads = p.headings || [];
    const top = [title, ...heads.slice(0, 6)].join(' · ');
    const summary = [p.summary || '', p.purpose || ''].join(' ');
    const links = (p.actions || []).map((a) => a.label).join(' · ');
    const pathText = segs(p.path).join(' ').replace(/-/g, ' ');
    const group = groups[p.id];

    // Para quién (equipos y segmentos)
    for (const t of teamsIn(`${top} ${pathText}`)) add('equipo', t, p.id, 'explica');
    for (const t of teamsIn(summary)) add('equipo', t, p.id, 'menciona');

    // Clientes: «Demo de X», «Cómo X logra…», /customers/x
    const t0 = title.normalize('NFC');
    const pre = /^(demo de|como|how)\s+/.exec(deacc(t0));
    const cm = pre ? /^([A-Z][\w&.'-]*(?:\s[A-Z][\w&.'-]*)?)/.exec(t0.slice(pre[0].length)) : null;
    const pathSegs = segs(p.path).slice(loc ? 1 : 0);
    let client = cm ? cm[1] : null;
    if (!client && (group === 'Casos de éxito' || group === 'Demos') && pathSegs.length >= 2) client = pretty(pathSegs[pathSegs.length - 1]);
    if (client && deacc(client) !== brand) {
      const fig = /(\d[\d.,]*\s?(?:x|%|veces))/i.exec(`${title} ${heads.join(' ')}`);
      add('cliente', client, p.id, 'explica', fig ? { detail: fig[1] } : {});
    }

    // Integraciones: herramientas con contexto de integración (las de los casos de éxito son clientes)
    const low = deacc(`${top} ${summary}`);
    const ctx = INTEGRATION_CTX.test(low) || group === 'Integraciones';
    if (ctx && group !== 'Casos de éxito' && group !== 'Demos') {
      for (const [tool, rx] of TOOL_RX) if (rx.test(low) && deacc(tool) !== deacc(client || '')) add('integracion', tool, p.id, rx.test(deacc(top)) ? 'explica' : 'menciona');
    }

    // Precios
    if (group === 'Precios' || PRICE_RX.test(deacc(top))) add('precio', 'Precios y planes', p.id, 'explica');

    // Funciones: la primera parte del título («Videocall Agent: …», «Software de facturación | Marca»)
    const parts = title.split(/\s*[:|–—]\s+|\s+[|–—]\s*/).map((x) => x.trim()).filter(Boolean);
    const name = parts.find((x) => deacc(x) !== brand && !deacc(x).startsWith(brand + ' ai'));
    if (name && parts.length > 1 && name.split(/\s+/).length <= 5 && name.length <= 44 && !NOT_FUNCTION.test(deacc(name)) && !teamsIn(name).length && !cm && group !== 'Casos de éxito' && group !== 'Recursos' && group !== 'Empresa') {
      add('funcion', name, p.id, 'explica');
    }

    // Problemas: titulares que cuentan el dolor o el «antes / ahora» (máx. 2 por página)
    let n = 0;
    for (const h of heads) {
      if (n >= 2) break;
      const d = deacc(h);
      if (h.length < 12 || !PAIN_RX.test(d) || /\bno solo\b|\bnot just\b/.test(d)) continue;
      add('problema', clip(h, 72), p.id, 'explica');
      n++;
    }
    void links;
  }

  // Límites por tipo, por peso
  const caps = { problema: 14, funcion: 14, equipo: 8, integracion: 8, cliente: 10, precio: 1 };
  const kept = [];
  for (const type of TYPE_ORDER) {
    kept.push(...[...concepts.values()].filter((c) => c.type === type).sort((a, b) => b.weight - a.weight || b.pages.length - a.pages.length).slice(0, caps[type]));
  }
  kept.forEach((c, i) => {
    c.id = 'c' + String(i + 1).padStart(2, '0');
    c.best = c.explains[0] || c.pages[0];
  });
  const keyToId = new Map(kept.map((c) => [c.key, c.id]));
  const pcOut = pc.filter((x) => keyToId.has(x.key)).map((x) => ({ page: x.page, concept: keyToId.get(x.key), rel: x.rel, conf: x.conf }));

  // Conexiones deducidas entre conceptos que se explican en la misma página
  const REL = { 'funcion>problema': 'resuelve', 'equipo>problema': 'le preocupa', 'funcion>equipo': 'para', 'funcion>integracion': 'se integra con', 'cliente>funcion': 'usa', 'cliente>equipo': 'caso de' };
  const cedges = [];
  const seenE = new Set();
  const onPage = new Map();
  for (const x of pcOut) if (x.rel === 'explica') onPage.set(x.page, [...(onPage.get(x.page) || []), x.concept]);
  const cById = new Map(kept.map((c) => [c.id, c]));
  for (const [, ids] of onPage) {
    for (const a of ids) for (const b of ids) {
      if (a === b) continue;
      const rel = REL[`${cById.get(a).type}>${cById.get(b).type}`];
      const k = `${a}>${b}`;
      if (!rel || seenE.has(k)) continue;
      seenE.add(k);
      cedges.push({ from: a, to: b, rel, conf: 'inferida' });
    }
  }

  // Páginas centrales: las que más enlaces reciben (del idioma principal)
  const indeg = new Map();
  for (const e of map.edges || []) if (e.from !== e.to) indeg.set(e.to, (indeg.get(e.to) || 0) + 1);
  const centralPages = main.filter((p) => groups[p.id] !== 'Portada').sort((a, b) => (indeg.get(b.id) || 0) - (indeg.get(a.id) || 0)).slice(0, 5).map((p) => p.id);
  const centralConcepts = [...kept].filter((c) => c.type !== 'precio').sort((a, b) => b.weight - a.weight).slice(0, 6).map((c) => c.id);

  const conceptsOut = kept.map((c) => ({ id: c.id, type: c.type, label: c.label, pages: c.pages, best: c.best, weight: c.weight, ...(c.detail ? { detail: c.detail } : {}) }));
  const informe = buildReport(map, { concepts: conceptsOut, cedges, groupList, centralPages, byId, root: main.find((p) => groups[p.id] === 'Portada') || main[0] });
  return { concepts: conceptsOut, cedges, pc: pcOut, groups, groupList, central: { pages: centralPages, concepts: centralConcepts }, informe };
}

// ---------- informe de la web ----------
const QUESTIONS = {
  Ventas: '¿Cuántas demos hace tu equipo de ventas a la semana y cuánto tiempo les quitan?',
  Marketing: '¿Qué pasa hoy con los visitantes que llegan a tu web y no dejan sus datos?',
  Soporte: '¿Cuántas consultas os llegan que se resolverían enseñando el producto?',
  Onboarding: '¿Cuánto tarda un usuario nuevo en sacarle partido al producto?',
  'Customer Success': '¿Cuántos clientes lleva cada persona de tu equipo de éxito del cliente?',
  Enablement: '¿Cuánto tarda alguien nuevo de tu equipo en dominar el producto?',
  Enterprise: '¿Qué os pide seguridad o compras antes de meter una herramienta así?',
  Autónomos: '¿Cuánto tiempo te llevan cada mes las facturas y los papeles?',
  Pymes: '¿Cuántas herramientas distintas usáis hoy para llevar el negocio?',
  Finanzas: '¿Qué parte de la contabilidad seguís haciendo a mano?',
};
function bfsPath(map, from, to) {
  if (!from || !to) return null;
  if (from === to) return [from];
  const adj = new Map();
  for (const e of map.edges || []) adj.set(e.from, [...(adj.get(e.from) || []), e.to]);
  const prev = new Map([[from, null]]);
  const q = [from];
  while (q.length) {
    const c = q.shift();
    for (const n of adj.get(c) || []) {
      if (prev.has(n)) continue;
      prev.set(n, c);
      if (n === to) {
        const out = [n];
        let k = c;
        while (k) { out.unshift(k); k = prev.get(k); }
        return out;
      }
      q.push(n);
    }
  }
  return [from, to];
}
function buildReport(map, { concepts, cedges, groupList, centralPages, byId, root }) {
  const of = (t) => concepts.filter((c) => c.type === t);
  const page = (id) => (byId.get(id) ? { id, titulo: clip(byId.get(id).title, 70) } : null);
  const problems = of('problema');
  const teams = of('equipo');
  const funcs = of('funcion');
  const tools = of('integracion');
  // El mayor problema: el primero que plantea la portada (es la promesa principal); si no hay, el que más se repite
  const rootHeads = (root?.headings || []).map(deacc);
  const onRoot = problems.filter((p) => root && p.pages.includes(root.id)).sort((a, b) => rootHeads.findIndex((h) => h.startsWith(deacc(a.label).replace(/…$/, ''))) - rootHeads.findIndex((h) => h.startsWith(deacc(b.label).replace(/…$/, ''))));
  const big = onRoot[0] || [...problems].sort((a, b) => b.weight - a.weight)[0];
  const resolve = (c) => cedges.filter((e) => e.to === c.id && e.rel === 'resuelve').map((e) => concepts.find((x) => x.id === e.from)?.label).filter(Boolean);
  // Recorridos: a la página de cada equipo y de los problemas que se tratan fuera de la portada
  const recorridos = [...teams.slice(0, 2), ...problems.filter((p) => p.best !== root?.id).slice(0, 2)]
    .map((c) => ({ para: c.label, tipo: c.type, paginas: (bfsPath(map, root?.id, c.best) || []).map(page).filter(Boolean) }))
    .filter((x) => x.paginas.length > 1)
    .slice(0, 3);
  const preguntas = ['¿Qué es lo que más te está costando ahora mismo?'];
  for (const t of teams) if (QUESTIONS[t.label] && preguntas.length < 4) preguntas.push(QUESTIONS[t.label]);
  if (tools.length) preguntas.push(`¿Qué herramientas usáis ya? (aquí se habla de ${tools.slice(0, 3).map((t) => t.label).join(', ')})`);
  return {
    web: map.app.host,
    que_es: clip((map.ficha && map.ficha.que_es) || root?.summary || root?.title || '', 220),
    mayor_problema: big ? { texto: big.label, pagina: page(big.best), lo_resuelve: resolve(big) } : null,
    para_quien: teams.slice(0, 6).map((t) => ({ nombre: t.label, pagina: page(t.best) })),
    funciones: funcs.slice(0, 8).map((f) => ({ nombre: f.label, pagina: page(f.best) })),
    problemas: problems.slice(0, 8).map((p) => ({ texto: p.label, pagina: page(p.best), lo_resuelve: resolve(p) })),
    clientes: of('cliente').slice(0, 8).map((c) => ({ nombre: c.label, ...(c.detail ? { dato: c.detail } : {}), pagina: page(c.best) })),
    integraciones: tools.map((t) => t.label),
    grupos: groupList,
    paginas_centrales: centralPages.map(page).filter(Boolean),
    recorridos,
    preguntas: preguntas.slice(0, 5),
  };
}

/** El informe en Markdown (se guarda junto al mapa, como el GRAPH_REPORT de Graphify). */
export function reportMarkdown(r) {
  const L = [`# Informe de la web: ${r.web}`, ''];
  if (r.que_es) L.push(`**Qué es:** ${r.que_es}`, '');
  if (r.mayor_problema) L.push(`**El mayor problema que resuelve:** «${r.mayor_problema.texto}» → ${r.mayor_problema.pagina?.id} ${r.mayor_problema.pagina?.titulo || ''}${r.mayor_problema.lo_resuelve.length ? ` (lo resuelve: ${r.mayor_problema.lo_resuelve.join(', ')})` : ''}`, '');
  const list = (title, items) => { if (items.length) L.push(`## ${title}`, ...items.map((x) => `- ${x}`), ''); };
  list('Para quién', r.para_quien.map((t) => `${t.nombre} → ${t.pagina?.id} ${t.pagina?.titulo || ''}`));
  list('Funciones', r.funciones.map((f) => `${f.nombre} → ${f.pagina?.id}`));
  list('Problemas que resuelve', r.problemas.map((p) => `«${p.texto}» → ${p.pagina?.id}${p.lo_resuelve.length ? ` (${p.lo_resuelve.join(', ')})` : ''}`));
  list('Clientes', r.clientes.map((c) => `${c.nombre}${c.dato ? ` (${c.dato})` : ''} → ${c.pagina?.id}`));
  if (r.integraciones.length) L.push(`**Integraciones:** ${r.integraciones.join(', ')}`, '');
  list('Recorridos de demo sugeridos', r.recorridos.map((x) => `Para «${x.para}»: ${x.paginas.map((p) => `${p.titulo} (${p.id})`).join(' → ')}`));
  list('Preguntas para descubrir su problema', r.preguntas);
  list('Grupos de páginas', r.grupos.map((g) => `${g.label}: ${g.n}`));
  list('Páginas centrales (más enlazadas)', r.paginas_centrales.map((p) => `${p.id} ${p.titulo}`));
  return L.join('\n');
}

/** Para la voz: problemas y equipos → página, en pocas líneas. */
export function brainSection(k) {
  const r = k.informe;
  const out = [];
  if (r.mayor_problema) out.push(`Mayor problema que resuelve: «${r.mayor_problema.texto}» → ${r.mayor_problema.pagina?.id}.`);
  if (r.problemas.length) out.push('Problemas → página: ' + r.problemas.slice(0, 6).map((p) => `«${clip(p.texto, 60)}» → ${p.pagina?.id}`).join(' | '));
  if (r.para_quien.length) out.push('Para quién → página: ' + r.para_quien.map((t) => `${t.nombre} → ${t.pagina?.id}`).join(' | '));
  return out.join('\n');
}

/** Conceptos que nombra una frase del visitante (por su léxico o por las palabras de su etiqueta). */
export function conceptHits(text, k) {
  const t = deacc(text);
  const words = new Set(t.split(/[^a-z0-9ñ]+/).filter((w) => w.length >= 4).map((w) => w.slice(0, 5)));
  const teamHits = new Set(TEAMS.filter(([, rx]) => rx.test(t)).map(([l]) => l));
  const toolHits = new Set(TOOL_RX.filter(([, rx]) => rx.test(t)).map(([l]) => l));
  return k.concepts.filter((c) => {
    if (c.type === 'equipo') return teamHits.has(c.label);
    if (c.type === 'integracion') return toolHits.has(c.label);
    if (c.type === 'precio') return PRICE_RX.test(t) || /cuesta|cuanto vale|caro|barato/.test(t);
    const lw = deacc(c.label).split(/[^a-z0-9ñ]+/).filter((w) => w.length >= 5).map((w) => w.slice(0, 5));
    const hit = lw.filter((w) => words.has(w)).length;
    return hit >= 2 || (hit >= 1 && lw.length <= 2);
  });
}
