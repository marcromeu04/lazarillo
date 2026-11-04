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
  // Si no hay coincidencia exacta, la pantalla con el prefijo de ruta más largo en común.
  let best = null;
  let bestLen = 0;
  for (const s of map.screens) {
    const a = strip(s.url);
    let i = 0;
    while (i < a.length && i < target.length && a[i] === target[i]) i++;
    if (i > bestLen) {
      bestLen = i;
      best = s;
    }
  }
  return bestLen > new URL(map.app.startUrl).origin.length + 1 ? best : null;
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
