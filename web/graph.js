// Panel del grafo: lo que construye el agente de mapeo, en vivo, y por dónde va la IA.
// Dos capas (la idea de Graphify, llevada a las demos de producto):
//  - Páginas: árbol de la principal a las secundarias por niveles, coloreadas por grupo (Producto,
//    Soluciones, Casos de éxito…). Es el mapa de navegación: dónde se puede ir y qué se pulsa.
//  - Conceptos: de qué habla la web (problemas que resuelve, funciones, para quién, integraciones,
//    clientes y precios), en columnas por tipo, unidos entre sí (inferido) y a sus páginas (extraído).
// Modos: «Páginas», «Conceptos» o «Ambos». Buscador, y un clic fija la ficha de una página o un concepto.
const NS = 'http://www.w3.org/2000/svg';
const TYPE_LABEL = { problema: 'Problemas', funcion: 'Funciones', equipo: 'Para quién', integracion: 'Integraciones', cliente: 'Clientes', precio: 'Precios' };
const SHORT_LABEL = { problema: 'Probl.', funcion: 'Func.', equipo: 'Quién', integracion: 'Integr.', cliente: 'Client.', precio: '€' };
const TYPE_NAME = { problema: 'problema que resuelve', funcion: 'función', equipo: 'para quién', integracion: 'integración', cliente: 'cliente', precio: 'precios' };
export const TYPE_COLOR = { problema: '#f87171', funcion: '#c084fc', equipo: '#34d399', integracion: '#60a5fa', cliente: '#fbbf24', precio: '#f472b6' };
const GROUP_PALETTE = ['#a78bfa', '#34d399', '#fbbf24', '#f472b6', '#60a5fa', '#2dd4bf', '#fb923c', '#e879f9'];
const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function createGraph(svg, info, head, legend) {
  const nodes = new Map(); // id → {id,title,summary,path,live,x,y,tx,ty,g,dot,ring,label}
  let edges = []; // {from,to,via}
  let current = null;
  const visited = [];
  const deep = new Map();
  let prob = new Set();
  let interest = {};
  let app = {};
  let tokens = 0;
  let raf = 0;
  let big = false; // vista «Grafo» a pantalla grande: todas las etiquetas y más aire
  let pinned = null; // {kind:'page'|'concept', id}: su ficha se queda abajo
  let hover = null;
  let mode = 'pages';
  let query = '';
  let kn = { concepts: [], cedges: [], pc: [], groups: {}, groupList: [] };
  const cnodes = new Map(); // id → {c, g, box, label, x, y}
  const groupColor = new Map();

  const gCE = el('g'); // conceptos ↔ conceptos (inferidas)
  const gPC = el('g'); // página ↔ concepto (extraídas)
  const gTree = el('g');
  const gExtra = el('g');
  const gTrail = el('g');
  const gNodes = el('g');
  const gCHeads = el('g');
  const gConcepts = el('g');
  svg.append(gCE, gPC, gExtra, gTree, gTrail, gNodes, gCHeads, gConcepts);

  function el(tag, attrs = {}) {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    return e;
  }
  const size = () => ({ w: svg.clientWidth || 320, h: svg.clientHeight || 230 });
  const short = (t, n = 18) => ((t || '').length > n ? t.slice(0, n - 1) + '…' : t || '');
  const curve = (a, b) => {
    const my = (a.y + b.y) / 2;
    return `M${a.x.toFixed(1)},${a.y.toFixed(1)} C${a.x.toFixed(1)},${my.toFixed(1)} ${b.x.toFixed(1)},${my.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}`;
  };
  const rootNode = () => nodes.values().next().value;
  const showPages = () => mode !== 'concepts';
  const showConcepts = () => mode !== 'pages' && kn.concepts.length > 0;
  function areas() {
    const { w, h } = size();
    if (!showConcepts()) return { w, pages: { y0: 0, h }, concepts: null };
    if (!showPages()) return { w, pages: null, concepts: { y0: 0, h } };
    const ph = Math.round(h * 0.55);
    return { w, pages: { y0: 0, h: ph }, concepts: { y0: ph, h: h - ph } };
  }
  const posOf = (id) => nodes.get(id) || cnodes.get(id);

  // ---------- árbol: nivel y padre de cada página (BFS desde la principal) ----------
  function tree() {
    const root = nodes.keys().next().value;
    const parent = new Map();
    const level = new Map();
    if (!root) return { parent, level, rows: [] };
    const adj = new Map();
    for (const e of edges) {
      if (!adj.has(e.from)) adj.set(e.from, []);
      adj.get(e.from).push(e.to);
    }
    level.set(root, 0);
    const order = [root];
    for (let i = 0; i < order.length; i++) {
      const c = order[i];
      for (const t of adj.get(c) || []) if (nodes.has(t) && !level.has(t)) { level.set(t, level.get(c) + 1); parent.set(t, c); order.push(t); }
    }
    // páginas a las que aún no llega ningún enlace conocido: al último nivel
    const maxL = Math.max(0, ...level.values());
    for (const id of nodes.keys()) if (!level.has(id)) { level.set(id, maxL + 1); order.push(id); }
    const rows = [];
    for (const id of order) (rows[level.get(id)] ||= []).push(id);
    return { parent, level, rows };
  }

  function layout() {
    const A = areas();
    for (const g of [gTree, gExtra, gTrail, gNodes]) g.style.display = A.pages ? '' : 'none';
    if (A.pages) {
      const w = A.w, h = A.pages.h;
      const { parent, rows } = tree();
      const perRow = Math.max(4, Math.floor((w - 24) / (big ? 118 : 30))); // cuántas caben por fila sin pisarse (en grande, con su etiqueta)
      const lines = []; // filas visuales (un nivel largo se parte en varias)
      const pos = new Map();
      for (const row of rows) {
        if (!row) continue;
        // hijos ordenados según la posición de su padre: menos cruces
        row.sort((a, b) => (pos.get(parent.get(a))?.x ?? 0) - (pos.get(parent.get(b))?.x ?? 0));
        for (let i = 0; i < row.length; i += perRow) {
          const chunk = row.slice(i, i + perRow);
          lines.push(chunk);
          chunk.forEach((id, k) => pos.set(id, { x: ((k + 1) * w) / (chunk.length + 1), line: lines.length - 1, k, n: chunk.length }));
        }
      }
      const top = A.pages.y0 + (big ? 36 : 20);
      const step = lines.length > 1 ? Math.min(big ? 120 : 52, (h - (big ? 36 : 20) - (big ? 30 : 18)) / (lines.length - 1)) : 0;
      for (const [id, p] of pos) {
        const n = nodes.get(id);
        const zig = p.n > 6 ? ((p.k % 2) * 0.36 - 0.18) * step : 0; // filas llenas en zigzag para que se lean las etiquetas
        n.tx = p.x;
        n.ty = top + p.line * step + zig;
        if (n.x == null) { const par = nodes.get(parent.get(id)); n.x = par?.x ?? n.tx; n.y = par?.y ?? n.ty; }
      }
    }
    layoutConcepts(A);
    animate();
  }

  // ---------- capa de conceptos: columnas por tipo ----------
  function layoutConcepts(A = areas()) {
    for (const g of [gConcepts, gCHeads, gCE, gPC]) g.style.display = A.concepts ? '' : 'none';
    gCHeads.textContent = '';
    if (!A.concepts) return;
    const types = Object.keys(TYPE_LABEL).filter((t) => kn.concepts.some((c) => c.type === t));
    const colW = A.w / Math.max(1, types.length);
    const compact = colW < 120; // lateral estrecho: cabeceras cortas y nombres solo del concepto en foco
    const y0 = A.concepts.y0 + (showPages() ? 10 : 6);
    types.forEach((t, i) => {
      const x0 = i * colW;
      const items = kn.concepts.filter((c) => c.type === t).sort((a, b) => b.weight - a.weight);
      const head = el('text', { class: 'chead', x: (x0 + 12).toFixed(1), y: (y0 + 12).toFixed(1) });
      head.textContent = compact ? `${SHORT_LABEL[t]} ${items.length}` : `${TYPE_LABEL[t]} · ${items.length}`;
      head.style.fill = TYPE_COLOR[t];
      gCHeads.append(head);
      const avail = A.concepts.h - (y0 - A.concepts.y0) - 30;
      const step = Math.min(big ? 30 : 22, avail / Math.max(1, items.length));
      const maxChars = Math.max(6, Math.floor((colW - 34) / (big ? 7 : 6)));
      items.forEach((c, j) => {
        const cn = cnodes.get(c.id);
        if (!cn) return;
        cn.x = x0 + 18;
        cn.y = y0 + 28 + j * step + step / 2;
        cn.g.setAttribute('transform', `translate(${cn.x.toFixed(1)},${cn.y.toFixed(1)})`);
        cn.label.textContent = short(c.label.replace(/^«|»$/g, ''), compact ? 22 : maxChars);
        cn.tight = step < (big ? 15 : 13);
        cn.compact = compact;
      });
    });
    paintConcepts();
  }

  function buildConcepts() {
    gConcepts.textContent = '';
    cnodes.clear();
    for (const c of kn.concepts) {
      const s = 7 + Math.min(5, c.weight);
      const g = el('g', { class: 'cnode' });
      const box = el('rect', { x: -s / 2, y: -s / 2, width: s, height: s, rx: 2.5 });
      box.style.fill = TYPE_COLOR[c.type] || '#94a3b8';
      const label = el('text', { class: 'cl', x: s / 2 + 6, dy: 4 });
      g.append(box, label);
      const cn = { id: c.id, c, g, box, label, x: 0, y: 0, tight: false };
      g.addEventListener('mouseenter', () => { hover = { kind: 'concept', id: c.id }; paintConcepts(); showInfoFor(hover); });
      g.addEventListener('mouseleave', () => { hover = null; paintConcepts(); showInfoFor(pinned); });
      g.addEventListener('click', () => { pinned = pinned && pinned.id === c.id ? null : { kind: 'concept', id: c.id }; paint(); showInfoFor(pinned); });
      gConcepts.append(g);
      cnodes.set(c.id, cn);
    }
  }

  // La página o concepto en foco (ratón, fijado o, si no, la página actual) enciende sus conexiones.
  const focus = () => hover || pinned || (current ? { kind: 'page', id: current } : null);
  function related(f) {
    const set = new Set();
    if (!f) return set;
    set.add(f.id);
    if (f.kind === 'concept') {
      for (const e of kn.cedges) { if (e.from === f.id) set.add(e.to); if (e.to === f.id) set.add(e.from); }
      for (const x of kn.pc) if (x.concept === f.id) set.add(x.page);
    } else for (const x of kn.pc) if (x.page === f.id) set.add(x.concept);
    return set;
  }
  function paintConcepts() {
    if (!showConcepts()) return;
    const f = focus();
    const rel = related(f);
    const q = query;
    for (const cn of cnodes.values()) {
      const on = rel.has(cn.id);
      const match = q && fold(cn.c.label).includes(q);
      cn.g.setAttribute('class', 'cnode' + (on ? ' on' : '') + (f && f.id === cn.id ? ' focus' : '') + (match ? ' match' : '') + (q && !match ? ' dim' : '') + (pinned && pinned.id === cn.id ? ' pin' : ''));
      const isFocus = (f && f.id === cn.id) || (pinned && pinned.id === cn.id);
      cn.label.style.display = cn.compact ? (isFocus ? '' : 'none') : !cn.tight || on || match || big ? '' : 'none';
    }
    // conexiones entre conceptos: todas tenues, las del foco encendidas
    gCE.textContent = '';
    for (const e of kn.cedges) {
      const p = el('path', { class: 'ce' + (f && (e.from === f.id || e.to === f.id) ? ' on' : '') });
      p._a = e.from; p._b = e.to;
      gCE.append(p);
    }
    // página ↔ concepto: solo las del foco (si no, sería una maraña)
    gPC.textContent = '';
    if (showPages() && f) {
      for (const x of kn.pc) {
        if (!(f.kind === 'page' ? x.page === f.id : x.concept === f.id)) continue;
        const p = el('path', { class: 'pc' + (x.rel === 'explica' ? ' strong' : '') });
        p._a = x.page; p._b = x.concept;
        gPC.append(p);
      }
    }
    draw();
  }

  // ---------- dibujo de páginas ----------
  function addNode(n) {
    if (nodes.has(n.id)) { Object.assign(nodes.get(n.id), n); layout(); paint(); return; }
    const node = { ...n, x: null, y: null, tx: 0, ty: 0 };
    node.ring = el('circle', { r: 10, class: 'gring' });
    node.dot = el('circle', { r: 5.5, class: 'gn' });
    node.label = el('text', { class: 'gl', dy: -11, 'text-anchor': 'middle' });
    node.label.textContent = short(n.title);
    node.g = el('g', { class: 'gnode' });
    node.g.append(node.ring, node.dot, node.label);
    node.g.addEventListener('mouseenter', () => { hover = { kind: 'page', id: n.id }; paintConcepts(); showInfoFor(hover); });
    node.g.addEventListener('mouseleave', () => { hover = null; paintConcepts(); showInfoFor(pinned); });
    node.g.addEventListener('click', () => { pinned = pinned && pinned.id === n.id ? null : { kind: 'page', id: n.id }; paint(); showInfoFor(pinned); });
    gNodes.append(node.g);
    nodes.set(n.id, node);
    layout();
    paint();
  }

  function addEdge(e) {
    if (edges.some((x) => x.from === e.from && x.to === e.to)) return;
    edges.push({ from: e.from, to: e.to, via: e.via });
    layout();
    paint();
  }

  function setCurrent(id) {
    if (!id) return;
    current = id;
    if (visited[visited.length - 1] !== id) visited.push(id);
    paint();
    showInfoFor(pinned);
  }
  function setDeep(id, state) { deep.set(id, state); paint(); }

  function colorOfGroup(label) {
    if (!label || label === 'Otras' || label === 'Otros idiomas') return '#475569';
    if (label === 'Portada') return '#e7e9f0';
    if (!groupColor.has(label)) groupColor.set(label, GROUP_PALETTE[groupColor.size % GROUP_PALETTE.length]);
    return groupColor.get(label);
  }

  function paint() {
    const { parent } = tree();
    const root = rootNode();
    if (root) root.dot.setAttribute('r', 7.5);
    for (const n of nodes.values()) if (n !== root) n.dot.setAttribute('r', (5.5 + ((interest[n.id] || 0) / 100) * 5).toFixed(1));
    const outs = new Set(edges.filter((e) => e.from === current).map((e) => e.to));
    const q = query;
    for (const n of nodes.values()) {
      const isCur = n.id === current;
      const isVis = visited.includes(n.id);
      const d = deep.get(n.id);
      const isRoot = n === root;
      const isPin = pinned && pinned.id === n.id;
      const match = q && (fold(n.title).includes(q) || fold(n.path).includes(q));
      n.g.style.setProperty('--gc', colorOfGroup(kn.groups[n.id]));
      n.g.setAttribute('class', 'gnode' + (isRoot ? ' root' : '') + (isCur ? ' cur' : '') + (isVis ? ' vis' : '') + (d === 'investigando' ? ' inv' : '') + (d === 'listo' ? ' ready' : '') + (outs.has(n.id) ? ' next' : '') + (prob.has(n.id) && !isCur ? ' prob' : '') + (n.live ? ' live' : '') + ((interest[n.id] || 0) >= 50 ? ' hot' : '') + (isPin ? ' pin' : '') + (match ? ' match' : '') + (q && !match ? ' dim' : ''));
      n.label.textContent = short(n.title, big ? 22 : 18);
      n.label.style.display = big || isCur || isVis || isRoot || isPin || match || prob.has(n.id) || nodes.size <= 12 ? '' : 'none';
    }
    // rutas del árbol (padre → hijo)
    gTree.textContent = '';
    for (const [child, par] of parent) {
      const p = el('path', { class: 'ge tree' + (par === current ? ' out' : '') });
      p._a = par; p._b = child;
      gTree.append(p);
    }
    // otros enlaces que salen de la página actual (atajos fuera del árbol)
    gExtra.textContent = '';
    for (const e of edges) if (e.from === current && parent.get(e.to) !== e.from) {
      const p = el('path', { class: 'ge extra' });
      p._a = e.from; p._b = e.to;
      gExtra.append(p);
    }
    // recorrido de la IA
    gTrail.textContent = '';
    for (let i = 1; i < visited.length; i++) {
      const p = el('path', { class: 'gtrail' });
      p._a = visited[i - 1]; p._b = visited[i];
      gTrail.append(p);
    }
    paintConcepts();
    draw();
    const cur = nodes.get(current);
    head.innerHTML = `<b>Grafo</b> · ${Number(nodes.size)} páginas${kn.concepts.length ? ` · ${Number(kn.concepts.length)} conceptos` : ''}${tokens ? ` · ~${Number(tokens)} tokens` : ''}${cur ? ` · IA en <span class="gcur">${escapeHtml(cur.id)} ${escapeHtml(short(cur.title, 26))}</span>` : ''}`;
    paintLegend();
  }

  function draw() {
    for (const n of nodes.values()) if (n.x != null) n.g.setAttribute('transform', `translate(${n.x.toFixed(1)},${n.y.toFixed(1)})`);
    for (const g of [gTree, gExtra, gTrail, gPC, gCE]) for (const p of g.children) {
      const a = posOf(p._a), b = posOf(p._b);
      if (a && b && a.x != null && b.x != null) p.setAttribute('d', curve(a, b));
    }
  }

  function animate() {
    if (raf) return;
    const stepFn = () => {
      raf = 0;
      let moving = false;
      for (const n of nodes.values()) {
        if (n.x == null) continue;
        const dx = n.tx - n.x, dy = n.ty - n.y;
        if (Math.abs(dx) > 0.3 || Math.abs(dy) > 0.3) { n.x += dx * 0.18; n.y += dy * 0.18; moving = true; }
        else { n.x = n.tx; n.y = n.ty; }
      }
      draw();
      if (moving) raf = requestAnimationFrame(stepFn);
    };
    raf = requestAnimationFrame(stepFn);
  }

  // ---------- ficha de abajo ----------
  const pageLink = (id) => { const n = nodes.get(id); return n ? `${escapeHtml(id)} ${escapeHtml(short(n.title, 30))}` : escapeHtml(id); };
  function showInfoFor(f) {
    if (!f) f = current ? { kind: 'page', id: current } : null;
    if (!f) { info.textContent = app.host ? `${app.host} · pasa el ratón por una página o un concepto` : ''; return; }
    if (f.kind === 'concept') {
      const c = kn.concepts.find((x) => x.id === f.id);
      if (!c) { info.textContent = ''; return; }
      const INCOMING = { resuelve: (o) => `lo resuelve ${o}`, 'le preocupa': (o) => `le preocupa a ${o}`, para: (o) => `${o} es para este perfil`, 'se integra con': (o) => `${o} se integra con esto`, usa: (o) => `lo usa ${o}`, 'caso de': (o) => `caso de éxito: ${o}` };
      const links = kn.cedges.filter((e) => e.from === c.id || e.to === c.id).slice(0, 5).map((e) => {
        const other = escapeHtml(short(kn.concepts.find((x) => x.id === (e.from === c.id ? e.to : e.from))?.label, 34));
        return e.from === c.id ? `${escapeHtml(e.rel)} → ${other}` : (INCOMING[e.rel] ? INCOMING[e.rel](other) : `${other} → ${escapeHtml(e.rel)}`);
      });
      info.innerHTML = `<b>${escapeHtml(c.label)}</b> <span class="ctype" style="color:${TYPE_COLOR[c.type]}">${escapeHtml(TYPE_NAME[c.type] || c.type)}</span>${c.detail ? ` · <b>${escapeHtml(c.detail)}</b>` : ''}<br>En ${c.pages.length === 1 ? 'la página' : `${Number(c.pages.length)} páginas`}: ${c.pages.slice(0, 4).map(pageLink).join(' · ')}${c.pages.length > 4 ? ' …' : ''}${links.length ? `<br><span class="gpath">Conexiones deducidas:</span> ${links.join(' · ')}` : ''}`;
      return;
    }
    const n = nodes.get(f.id);
    if (!n) { info.textContent = ''; return; }
    const d = deep.get(n.id);
    const it = interest[n.id];
    const grp = kn.groups[n.id];
    const talks = kn.pc.filter((x) => x.page === n.id).map((x) => kn.concepts.find((c) => c.id === x.concept)).filter(Boolean).slice(0, 5);
    info.innerHTML = `<b>${escapeHtml(n.id)} · ${escapeHtml(n.title)}</b> <span class="gpath">${escapeHtml(n.path || '')}</span>${grp ? ` <span class="ggroup" style="color:${colorOfGroup(grp)}">${escapeHtml(grp)}</span>` : ''}${it != null ? ` <span class="ghot">interés ${Number(it)}</span>` : ''}<br>${escapeHtml(n.summary || '')}${d ? ` <span class="gdeep">${d === 'listo' ? '● detalle listo' : '◌ investigando'}</span>` : ''}${talks.length ? `<br><span class="gpath">Habla de:</span> ${talks.map((c) => `<span style="color:${TYPE_COLOR[c.type]}">${escapeHtml(short(c.label, 36))}</span>`).join(' · ')}` : ''}`;
  }

  function paintLegend() {
    if (!legend) return;
    const parts = [];
    if (showPages()) {
      for (const g of kn.groupList.filter((x) => x.label !== 'Otros idiomas' && x.label !== 'Otras').slice(0, 8)) parts.push(`<span><i style="background:${colorOfGroup(g.label)}"></i>${escapeHtml(g.label)} ${Number(g.n)}</span>`);
      parts.push('<span><i style="background:#a855f7;box-shadow:0 0 0 2px rgba(168,85,247,.4)"></i>IA aquí</span><span><i style="background:#6366f1"></i>visitada</span><span><i style="border:2px dashed #fbbf24"></i>investigando</span><span><i style="border:2px solid rgba(52,211,153,.7)"></i>detalle listo</span><span><i style="border:2px dashed #60a5fa"></i>probable</span>');
    }
    if (showConcepts()) {
      for (const [t, label] of Object.entries(TYPE_LABEL)) if (kn.concepts.some((c) => c.type === t)) parts.push(`<span><i class="sq" style="background:${TYPE_COLOR[t]}"></i>${escapeHtml(label)}</span>`);
      parts.push('<span><i class="ln"></i>deducida</span>');
    }
    legend.innerHTML = parts.join('');
  }

  function reset(view = {}) {
    nodes.clear(); visited.length = 0; deep.clear(); prob = new Set(); interest = {}; current = null; pinned = null; hover = null;
    gTree.textContent = ''; gExtra.textContent = ''; gTrail.textContent = ''; gNodes.textContent = ''; gPC.textContent = ''; gCE.textContent = '';
    app = view.app || {};
    tokens = view.brainTokens || 0;
    kn = view.knowledge || { concepts: [], cedges: [], pc: [], groups: {}, groupList: [] };
    groupColor.clear();
    buildConcepts();
    edges = (view.edges || []).map((e) => ({ from: e.from, to: e.to, via: e.via }));
    for (const n of view.nodes || []) addNode(n);
    for (const [id, st] of Object.entries(view.deep || {})) deep.set(id, st);
    for (const id of view.visited || []) visited.push(id);
    current = view.current || null;
    layout();
    paint();
    showInfoFor(null);
  }

  /** Busca páginas y conceptos; devuelve el primero que coincide (o null). */
  function setQuery(q) {
    query = fold(q).trim();
    paint();
    if (!query) return null;
    const p = [...nodes.values()].find((n) => fold(n.title).includes(query) || fold(n.path).includes(query));
    if (p) return { kind: 'page', id: p.id };
    const c = kn.concepts.find((x) => fold(x.label).includes(query));
    return c ? { kind: 'concept', id: c.id } : null;
  }

  // Se recoloca cuando cambia su tamaño (ventana o vista), no solo al redimensionar la ventana.
  let lastSize = '';
  const relayout = () => { const { w, h } = size(); const k = `${w}x${h}`; if (k !== lastSize && w > 0 && h > 0) { lastSize = k; layout(); } };
  if (window.ResizeObserver) new ResizeObserver(relayout).observe(svg); else window.addEventListener('resize', relayout);
  return {
    reset, addNode, addEdge, setCurrent, setDeep,
    setBig: (on) => { big = !!on; svg.classList.toggle('big', big); layout(); paint(); },
    setMode: (m) => { mode = ['pages', 'concepts', 'both'].includes(m) ? m : 'pages'; layout(); paint(); showInfoFor(pinned); },
    getMode: () => mode,
    setKnowledge: (k) => { kn = k || kn; buildConcepts(); layout(); paint(); showInfoFor(pinned); },
    setQuery,
    pin: (f) => { pinned = f; paint(); showInfoFor(pinned); },
    setTokens: (t) => { tokens = t; paint(); },
    setProbable: (ids) => { prob = new Set(ids); paint(); },
    setInterest: (scores) => { interest = scores || {}; paint(); },
    title: (id) => nodes.get(id)?.title || id,
    setApp: (a) => { app = a || {}; showInfoFor(null); },
  };
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}
