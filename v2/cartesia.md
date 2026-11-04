# v2/cartesia.md — Guía de voz Cartesia (P4)

Managed Agent de Cartesia: **el LLM va incluido en Cartesia**. Nosotros solo le
damos instrucciones (persona + mapa) y dos herramientas de cliente. La voz es
rápida y natural; el trabajo pesado (mapear la web) lo hace P2 antes de hablar.

Todo vive en `v2/cartesia-agent.js`. ESM, Node 18+, `fetch` global.

## Qué hace

1. **buildInstructions({brainMd, comunicacionMd})** → string con el system prompt
   completo: persona de `knowledge/comunicacion.md` + reglas de voz + playbook +
   el `brain.md` que escribe P2 (única fuente de verdad del mapa). Voz primero,
   1–3 frases por turno, nunca lee etiquetas/ids en voz alta. Si no pasas los
   textos, usa un fallback de persona y avisa de que no hay mapa.
2. **CLIENT_TOOLS** → las dos herramientas de cliente en el schema de Cartesia
   (`type: "client"`):
   - `pantalla_actual()` — sin argumentos, `expects_response: true`.
     Resultado esperado: `{ screen_id, path, title, section }`.
   - `resaltar(texto: string)` — `expects_response: false` (acción visual).
     Resultado: `{ ok: true }`.
3. **createAgent({brainMd, comunicacionMd})** → registra las dos tools
   (`POST /v1/agents/tools`), crea el agente (`POST /v1/agents`) con las
   instrucciones + ids de tools, y devuelve `{ agentId }`.
4. **mintSession(agentId)** → pide un token efímero (`POST /access-token`,
   grant `agent`) y devuelve lo que el navegador necesita para abrir la voz.

## Variables de entorno

- `CARTESIA_API_KEY` — **única** clave, solo desde `process.env`. Nunca se
  hardcodea y **nunca** se envía al navegador.
- Si falta la clave, `createAgent` devuelve `{ agentId: 'mock', mock: true }` y
  `mintSession` devuelve un token vacío con `mock: true`. La app arranca igual.

## Constantes a verificar

Todos los paths/payloads están aislados arriba del archivo y marcados con
`// TODO(verify): confirm against play.cartesia.ai docs`:

- `CARTESIA_VERSION = '2026-08-14'` (header `Cartesia-Version` en cada request).
- `ENDPOINTS`: `/v1/agents`, `/v1/agents/tools`, `/access-token`, `/v1/agents/models`.
- `DEFAULTS`: `modelId` (LLM hospedado), `voiceId` (voz española), `language: 'es'`,
  `tokenTtlSecs: 3600` (máx 1h).
- `WS_BASE` + `agentStreamUrl(id)` → `wss://api.cartesia.ai/agents/stream/{id}`.

**Antes de la demo real:** confirmar `modelId` y un `voiceId` español bueno en
`play.cartesia.ai`, y que el grant `agent` autoriza el WebSocket de stream.

## Cómo conecta P1 (navegador)

P5 expone un endpoint (p.ej. `GET /api/session`) que por dentro llama a
`mintSession(agentId)` y le pasa a P1 este objeto:

```js
{
  agentId,                 // id del managed agent
  token,                   // access token EFÍMERO (nunca la API key)
  wsUrl,                   // wss://api.cartesia.ai/agents/stream/<agentId>
  cartesiaVersion,         // ponlo donde el cliente lo necesite
  expiresIn,               // segundos de validez (renovar antes de que caduque)
  mock                     // true si no hay clave → mostrar "voz no configurada"
}
```

P1 abre el WebSocket a `wsUrl` autenticando con el token
(`?access_token=<token>` en navegador, o `Authorization: Bearer <token>`),
manda el evento `start` como primer mensaje, y hace ping cada 60–90 s (timeout
de inactividad ~180 s).

**Tool calls:** cuando Cartesia pide `pantalla_actual` o `resaltar`, P1 recibe el
evento tool-call, lo reenvía al bridge (P3) por `postMessage`, y devuelve el
resultado a Cartesia:
- `pantalla_actual` → espera `{type:'current_screen', ...}` del bridge y responde
  `{ screen_id, path, title, section }` (`expects_response: true`).
- `resaltar` → dispara el highlight (`{type:'highlight_result', ok}`); no hace
  falta devolver nada a Cartesia (`expects_response: false`).

## Cómo lo monta P5 (server.js)

```js
import { createAgent, mintSession } from './cartesia-agent.js';
import fs from 'node:fs/promises';

const brainMd = await fs.readFile('cache/<dominio>.brain.md', 'utf8').catch(() => '');
const comunicacionMd = await fs.readFile('knowledge/comunicacion.md', 'utf8').catch(() => '');

const { agentId } = await createAgent({ brainMd, comunicacionMd });
// Cachea agentId. En /api/session:
const session = await mintSession(agentId);   // -> mándalo a P1
```

Recrea el agente (o actualiza sus instrucciones) cuando cambie el `brain.md`.
El `comunicacionMd` es opcional: si no se pasa, se usa el fallback embebido.

## Firmas (para P5)

```
buildInstructions({ brainMd?: string, comunicacionMd?: string }): string
CLIENT_TOOLS: Array<ClientToolDef>
createAgent({ brainMd?, comunicacionMd? }): Promise<{ agentId, mock?, config? }>
mintSession(agentId): Promise<{ agentId, token, wsUrl, cartesiaVersion, expiresIn, mock? }>
```
