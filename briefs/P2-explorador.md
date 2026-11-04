# P2 · Explorador → Product Brain (Claude Code Pro)

Pásale este fichero entero a tu agente. Lee antes `PLAN.md`, `contracts/api.md` y
`contracts/app-map.example.json` (el formato de salida es ese).

**Objetivo**: dada una URL que no conoce, recorrerla sola en menos de 60 s y dejar el mapa de la app en
`brain/app-map.json` y su versión para el LLM en `brain/brain.md`.

**Solo tocas**: `explorer/explore.mjs`, `explorer/to-brain.mjs`, `explorer/routes.mjs`, `brain/**`.
**Informe**: `informes/P2.md` desde la primera acción.

## Paso 0

`npm i` hecho. Playwright usa **tu Chrome instalado**: `chromium.launch({ channel: "chrome" })` desde
`playwright-core`. No descargues navegadores.

## Qué hay que hacer

1. `explorer/explore.mjs <url> [--max 25]`:
   - BFS por enlaces del **mismo dominio**, profundidad ≤ 3, máximo 25 pantallas, 1280×800, `headless: true`.
   - Salta `mailto:`, `tel:`, `#`, ficheros (`.pdf`, `.jpg`, `.zip`…) y todo lo que suene a destructivo
     (`logout`, `delete`, `borrar`, `salir`). No envía formularios: solo los describe.
   - Normaliza URLs (sin `#`). `waitUntil: "domcontentloaded"`, 10 s de timeout por página; si falla, sigue.
   - Por pantalla: `id` (`s01`…), `url`, `title`, `purpose` (meta description o primer párrafo, ≤ 160
     caracteres), `headings` (h1/h2, ≤ 5), `actions` (enlaces visibles ≤ 30, botones ≤ 15, inputs ≤ 10;
     `label` ≤ 40 caracteres, sin duplicados; `to` = id de destino si está en el mapa) y una captura en
     `brain/shots/sNN.png`.
   - `edges` = `{ from, to, via }` por cada acción con `to`. Escribe `brain/app-map.json`.
2. `explorer/routes.mjs` con las firmas de `contracts/api.md`: `loadMap()` (usa `brain/app-map.json` y,
   si no existe, el fixture), `matchScreen(map, url)` (coincidencia exacta y si no, la URL más parecida
   por ruta) y `routesFrom(map, id)` (BFS → camino más corto como pasos «pulsa «X»»).
3. `explorer/to-brain.mjs`: `app-map.json` → `brain/brain.md`, **menos de 20 KB**, en español:
   - una línea por pantalla: `s03 · Travel · para qué sirve · ruta corta de la URL`;
   - las rutas desde la pantalla de inicio a cada pantalla (usa `routesFrom`);
   - las 8 acciones principales de cada pantalla.

## Hecho cuando

- **13:35**: `npm run explore -- https://books.toscrape.com && npm run brain` deja los dos ficheros, y
  están en el repo (commit + push).
- **13:45**: también funciona con `https://karumi.ai` (la demo del pitch: «le hacemos la demo de Karumi a
  Karumi»).
