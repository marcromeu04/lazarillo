# P3 · Observador: ve lo que hace el usuario (Claude Code Go)

Pásale este fichero entero a tu agente. Lee antes `contracts/api.md`.

**Objetivo**: abrir un Chrome para el visitante, saber en todo momento en qué pantalla está y poder
resaltarle un botón.

**Solo tocas**: `server/watcher.mjs` (y, si quieres, `server/watcher.test.mjs` para probarlo).
**Informe**: `informes/P3.md` desde la primera acción.

## Paso 0

`npm i` hecho. Usa `playwright-core` con **tu Chrome**: `chromium.launch({ channel: "chrome", headless: false })`.
Si `explorer/routes.mjs` aún no existe (lo hace P2), importa con `try/catch` y usa este plan B: carga
`contracts/app-map.example.json` y busca la pantalla cuya `url` coincida exactamente.

## Qué hay que hacer (firmas exactas de `contracts/api.md`)

1. `export async function open(url)`: lanza Chrome (una sola vez), abre la URL a 1280×800 y guarda la
   página. Escucha `framenavigated` del frame principal para tener la URL actual. Si se abre una pestaña
   nueva (`context.on("page")`), pasa a vigilar esa. Devuelve `{ ok: true }`.
2. `export async function current()`: devuelve el objeto `Current` del contrato: `url`, `pantalla`
   (`id`, `title`, `purpose`), `acciones` (≤ 12) y `rutas` (≤ 6, con `routesFrom`). **≤ 1 KB**: es lo que
   oye el agente en cada turno. Si la URL no está en el mapa, `pantalla: null` y las acciones se leen del
   DOM en vivo (textos de enlaces y botones visibles).
3. `export async function highlight(text)`: en la página, busca `a, button, input, [role=button]` cuyo
   texto, `aria-label` o `placeholder` contenga `text` (sin distinguir mayúsculas). Hace
   `scrollIntoView` y le pone `outline: 4px solid #ff3b30` con un pulso. Lo quita a los 4 s. Devuelve
   `{ ok: true, found: true|false }`.

## Hecho cuando

- **13:35**: `open("https://books.toscrape.com")` abre Chrome y `current()` devuelve la URL tras navegar a mano.
- **13:45**: `current()` devuelve la pantalla del mapa y `highlight("Travel")` la marca en rojo.
