// Rutas sobre el mapa: el LLM no calcula caminos, se los damos hechos.
import { existsSync, readFileSync } from "node:fs";

export function loadMap() {
  const file = existsSync("brain/app-map.json") ? "brain/app-map.json" : "contracts/app-map.example.json";
  return JSON.parse(readFileSync(file, "utf8"));
}

const strip = (u) => {
  try {
    const x = new URL(u);
    return (x.origin + x.pathname).replace(/\/index\.html?$/, "/").replace(/\/$/, "");
  } catch {
    return u;
  }
};

export function matchScreen(map, url) {
  if (!url) return null;
  const target = strip(url);
  const exact = map.screens.find((s) => strip(s.url) === target);
  if (exact) return exact;
  // Sin coincidencia exacta: la pantalla que comparte más segmentos de ruta enteros (no letras).
  const segs = (u) => {
    try {
      return new URL(u).pathname.split("/").filter(Boolean);
    } catch {
      return [];
    }
  };
  const t = segs(url);
  let best = null;
  let bestN = 0;
  for (const s of map.screens) {
    const a = segs(s.url);
    let i = 0;
    while (i < a.length && i < t.length && a[i] === t[i]) i++;
    if (i > bestN) {
      bestN = i;
      best = s;
    }
  }
  return best;
}

export function routesFrom(map, fromId) {
  const adj = new Map();
  for (const e of map.edges) {
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from).push(e);
  }
  const prev = new Map([[fromId, null]]);
  const q = [fromId];
  while (q.length) {
    const cur = q.shift();
    for (const e of adj.get(cur) || []) {
      if (prev.has(e.to)) continue;
      prev.set(e.to, e);
      q.push(e.to);
    }
  }
  const name = (id) => map.screens.find((s) => s.id === id)?.title || id;
  const routes = [];
  for (const [to, e] of prev) {
    if (!e) continue;
    const steps = [];
    let cur = e;
    while (cur) {
      steps.unshift(`pulsa «${cur.via}»`);
      cur = prev.get(cur.from);
    }
    routes.push({ to, name: name(to), steps });
  }
  return routes.sort((a, b) => a.steps.length - b.steps.length);
}
