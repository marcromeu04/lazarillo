// Panel del grafo: lo que construye el agente de mapeo, en vivo, y por dónde va la IA.
// Disposición en árbol: arriba la página principal y debajo las secundarias por niveles
// (profundidad desde la principal). Las rutas bajan como curvas de cada página a las que
// enlaza; el resto de enlaces solo se dibujan, tenues, desde la página actual.
const NS = 'http://www.w3.org/2000/svg';

export function createGraph(svg, info, head) {
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

  const gTree = el('g');
  const gExtra = el('g');
  const gTrail = el('g');
  const gNodes = el('g');
  svg.append(gExtra, gTree, gTrail, gNodes);

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
    const { w, h } = size();
    const { parent, rows } = tree();
    const perRow = Math.max(4, Math.floor((w - 24) / 30)); // cuántas caben por fila sin pisarse
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
    const top = 20;
    const step = lines.length > 1 ? Math.min(52, (h - top - 18) / (lines.length - 1)) : 0;
    for (const [id, p] of pos) {
      const n = nodes.get(id);
      const zig = p.n > 6 ? ((p.k % 2) * 0.36 - 0.18) * step : 0; // filas llenas en zigzag para que se lean las etiquetas
      n.tx = p.x;
      n.ty = top + p.line * step + zig;
      if (n.x == null) { const par = nodes.get(parent.get(id)); n.x = par?.x ?? n.tx; n.y = par?.y ?? n.ty; }
    }
    animate();
  }

  // ---------- dibujo ----------
  function addNode(n) {
    if (nodes.has(n.id)) { Object.assign(nodes.get(n.id), n); layout(); paint(); return; }
    const node = { ...n, x: null, y: null, tx: 0, ty: 0 };
    node.ring = el('circle', { r: 10, class: 'gring' });
    node.dot = el('circle', { r: 5.5, class: 'gn' });
    node.label = el('text', { class: 'gl', dy: -11, 'text-anchor': 'middle' });
    node.label.textContent = short(n.title);
    node.g = el('g', { class: 'gnode' });
    node.g.append(node.ring, node.dot, node.label);
    node.g.addEventListener('mouseenter', () => showInfo(node));
    node.g.addEventListener('mouseleave', () => showInfo(nodes.get(current)));
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
    showInfo(nodes.get(id));
  }
  function setDeep(id, state) { deep.set(id, state); paint(); }

  function paint() {
    const { parent } = tree();
    const root = rootNode();
    if (root) root.dot.setAttribute('r', 7.5);
    for (const n of nodes.values()) if (n !== root) n.dot.setAttribute('r', (5.5 + ((interest[n.id] || 0) / 100) * 5).toFixed(1));
    const outs = new Set(edges.filter((e) => e.from === current).map((e) => e.to));
    for (const n of nodes.values()) {
      const isCur = n.id === current;
      const isVis = visited.includes(n.id);
      const d = deep.get(n.id);
      const isRoot = n === root;
      n.g.setAttribute('class', 'gnode' + (isRoot ? ' root' : '') + (isCur ? ' cur' : '') + (isVis ? ' vis' : '') + (d === 'investigando' ? ' inv' : '') + (d === 'listo' ? ' ready' : '') + (outs.has(n.id) ? ' next' : '') + (prob.has(n.id) && !isCur ? ' prob' : '') + (n.live ? ' live' : '') + ((interest[n.id] || 0) >= 50 ? ' hot' : ''));
      n.label.style.display = isCur || isVis || isRoot || prob.has(n.id) || nodes.size <= 12 ? '' : 'none';
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
    draw();
    const cur = nodes.get(current);
    head.innerHTML = `<b>Grafo</b> · ${Number(nodes.size)} páginas${tokens ? ` · ~${Number(tokens)} tokens` : ''}${cur ? ` · IA en <span class="gcur">${escapeHtml(cur.id)} ${escapeHtml(short(cur.title, 26))}</span>` : ''}`;
  }

  function draw() {
    for (const n of nodes.values()) if (n.x != null) n.g.setAttribute('transform', `translate(${n.x.toFixed(1)},${n.y.toFixed(1)})`);
    for (const g of [gTree, gExtra, gTrail]) for (const p of g.children) {
      const a = nodes.get(p._a), b = nodes.get(p._b);
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

  function showInfo(n) {
    if (!n) { info.textContent = app.host ? `${app.host} · pasa el ratón por una página` : ''; return; }
    const d = deep.get(n.id);
    const it = interest[n.id];
    info.innerHTML = `<b>${escapeHtml(n.id)} · ${escapeHtml(n.title)}</b> <span class="gpath">${escapeHtml(n.path || '')}</span>${it != null ? ` <span class="ghot">interés ${Number(it)}</span>` : ''}<br>${escapeHtml(n.summary || '')}${d ? ` <span class="gdeep">${d === 'listo' ? '● detalle listo' : '◌ investigando'}</span>` : ''}`;
  }

  function reset(view = {}) {
    nodes.clear(); visited.length = 0; deep.clear(); prob = new Set(); interest = {}; current = null;
    gTree.textContent = ''; gExtra.textContent = ''; gTrail.textContent = ''; gNodes.textContent = '';
    app = view.app || {};
    tokens = view.brainTokens || 0;
    edges = (view.edges || []).map((e) => ({ from: e.from, to: e.to, via: e.via }));
    for (const n of view.nodes || []) addNode(n);
    for (const [id, st] of Object.entries(view.deep || {})) deep.set(id, st);
    for (const id of view.visited || []) visited.push(id);
    current = view.current || null;
    layout();
    paint();
    showInfo(nodes.get(current));
  }

  window.addEventListener('resize', () => layout());
  return {
    reset, addNode, addEdge, setCurrent, setDeep,
    setTokens: (t) => { tokens = t; paint(); },
    setProbable: (ids) => { prob = new Set(ids); paint(); },
    setInterest: (scores) => { interest = scores || {}; paint(); },
    title: (id) => nodes.get(id)?.title || id,
    setApp: (a) => { app = a || {}; showInfo(null); },
  };
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}
