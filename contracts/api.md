# Contratos — servidor local, módulos y Cartesia (solo Javier/P5 lo cambia)

## Servidor local — http://localhost:3000 (server/server.mjs)
| ruta | qué hace | lo implementa |
|---|---|---|
| `GET /` | sirve `web/` (estático) | P5 |
| `POST /api/token` | → `{ token, agentId }` | P1 en `server/token.mjs` |
| `POST /api/open` `{ url }` | abre el Chrome del visitante → `{ ok }` | P3 en `server/watcher.mjs` |
| `GET /api/current` | → `Current` (abajo) | P3 en `server/watcher.mjs` |
| `POST /api/highlight` `{ text }` | resalta el elemento → `{ ok, found }` | P3 en `server/watcher.mjs` |

Si un módulo no existe aún, el servidor devuelve **503** en esa ruta y lo demás sigue.

## Módulos (firmas exactas)
```js
// server/token.mjs (P1)
export async function createToken()   // → { token, agentId }

// server/watcher.mjs (P3)
export async function open(url)       // → { ok: true }
export async function current()       // → Current, ≤ 1 KB
export async function highlight(text) // → { ok, found }

// explorer/routes.mjs (P2)
export function loadMap()                 // → app-map (brain/app-map.json o el fixture)
export function matchScreen(map, url)     // → screen | null
export function routesFrom(map, screenId) // → [{ to, name, steps: ["pulsa «Travel»", ...] }]
```

`Current` (≤ 1 KB, máx 12 acciones y 6 rutas):
```json
{
  "url": "https://books.toscrape.com/catalogue/category/books/travel_2/index.html",
  "pantalla": { "id": "s03", "title": "Travel", "purpose": "Listado de libros de viajes" },
  "acciones": ["Home", "Books", "A Light in the Attic", "next"],
  "rutas": [{ "a": "Inicio", "pasos": ["pulsa «Home»"] }]
}
```

## Cartesia (verificado en docs.cartesia.ai el 2026-11-04)
- Cabeceras: `X-API-Key: $CARTESIA_API_KEY` y `Cartesia-Version: 2026-08-14`.
- Token navegador: `POST https://api.cartesia.ai/access-token` con `{ "grants": { "agent": true }, "expires_in": 900 }` → `{ token }`.
- WebSocket: `wss://api.cartesia.ai/v1/agents/websocket/{agentId}?cartesia_version=2026-08-14&access_token={token}`.
- Primer mensaje (<10 s): `{ "type": "session_create", "audio": { "input_format": "pcm_16000", "output_delivery": "speaking_pace" } }`. Esperar `session_ready`.
- Entrada: `{ "type": "audio_input", "audio": "<base64 PCM 16-bit LE mono 16 kHz>" }`, trozos 20–100 ms. Solo JSON de texto, nunca binario.
- Salida: eventos `audio_output` (base64 mismo formato). `audio_output_clear` → parar y vaciar (interrupción).
- Client tools: llega `client_tool_call` con `tool_call_id`, `tool_name`, `parameters`, `expects_response`. Responder (si lo espera) con `{ "type": "client_tool_result", "tool_call_id", "result": "<string ≤16 KiB>", "is_error": false }`.
- Herramientas: `POST /v1/agents/tools` (defs en `contracts/cartesia-tools.json`) y enganchar con `PATCH /v1/agents/{agentId}` → `config.tools: [{ "id": ... }]`.
- Agente: `PATCH /v1/agents/{agentId}` con `{ "config": { "instructions", "initial_message" } }`.

## .env (nunca al repo)
```
CARTESIA_API_KEY=
CARTESIA_AGENT_ID=
TARGET_URL=https://books.toscrape.com
ANTHROPIC_API_KEY=
```
