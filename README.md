# Lazarillo

Le das una URL que **nunca ha visto** → un agente explorador la recorre y construye el **Product Brain**
(mapa de pantallas y rutas) → un **agente guía de voz** (Cartesia) te hace la demo hablando, sabe en qué
pantalla estás y te **resalta dónde pulsar**. (Track 1 · Hackathon Karumi × Comillas.)

## Arrancar en cualquier ordenador (30 s)
```bash
npm i
npm start          # http://localhost:3000  (ábrelo en Chrome)
```
La clave de Cartesia va incluida en `.env.demo` (demo del hackathon), así que **no hay que configurar nada**.

### Probar la demo de voz
1. Abre **http://localhost:3000** en Chrome y pulsa **«Empezar demo»** (permite el micrófono; usa **cascos**).
2. En otra terminal, abre el Chrome del visitante en la web a explorar:
   ```bash
   curl -X POST http://localhost:3000/api/open -H 'Content-Type: application/json' \
     -d '{"url":"https://books.toscrape.com/"}'
   ```
3. Háblale: *«¿cómo llego a los libros de viajes?»* → te responde por voz y **resalta «Travel»** en esa ventana.

## Qué hay dentro
- `server/server.mjs` — servidor local (node:http): sirve `web/` y las rutas `/api/token · /api/open · /api/current · /api/highlight`.
- `web/` — cliente de voz: micro ⇄ WebSocket Cartesia ⇄ altavoz, PCM 16 kHz, y ejecuta los client tools.
- `server/watcher.mjs` — observador: Playwright con tu Chrome (`open/current/highlight`).
- `explorer/`, `brain/` — explorador → `app-map.json` + `brain.md` (mapa mental).
- `cartesia/` — crea y configura el agente «Lazarillo» (modelo de menor latencia, voz es-ES, 2 client tools).
- `contracts/` — contratos y fixtures. `v1/` (server.js + public/) — app alternativa iframe+voz como red de seguridad: `npm run start:v1`.

## Agente de voz
Ya creado y en vivo: `gpt-5.4-mini` (552 ms, el de menor latencia), voz española, con las herramientas
`pantalla_actual()` y `resaltar(texto)`. Para regenerarlo: `npm run setup-tools && npm run push`.
