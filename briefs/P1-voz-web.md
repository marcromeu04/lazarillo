# P1 · Voz web (Claude Code Max)

Pásale este fichero entero a tu agente. Lee antes `PLAN.md` y `contracts/api.md`.

**Objetivo**: una página donde pulsas «Empezar demo» y hablas con el agente de Cartesia por voz, con
latencia mínima, y que ejecuta sus client tools contra nuestro servidor.

**Solo tocas**: `web/index.html`, `web/app.js`, `web/pcm-worklet.js`, `server/token.mjs`.
**Informe**: `informes/P1.md` desde la primera acción, una línea por avance o bloqueo con la hora.

## Paso 0

- Necesitas `CARTESIA_API_KEY` y `CARTESIA_AGENT_ID` en `.env` (te los pasa P4 por privado). Mientras
  tanto, escribe el código; no esperes.
- `server/server.mjs` lo hace Javier; si aún no está, prueba `token.mjs` con un `node -e`.

## Qué hay que hacer

1. `server/token.mjs`: `export async function createToken()` → `POST https://api.cartesia.ai/access-token`
   con las cabeceras `X-API-Key` y `Cartesia-Version: 2026-08-14` y el body
   `{ grants: { agent: true }, expires_in: 900 }` → devuelve `{ token, agentId: process.env.CARTESIA_AGENT_ID }`.
2. `web/index.html`: botón «Empezar demo», botón «Colgar», indicador de estado (conectando / escuchando /
   hablando) y un panel de log con los eventos y las llamadas a herramientas. Diseño limpio, oscuro, una
   sola pantalla: lo verá el jurado.
3. `web/app.js`:
   - `POST /api/token` → abre `wss://api.cartesia.ai/v1/agents/websocket/${agentId}?cartesia_version=2026-08-14&access_token=${token}`.
   - Al abrir, manda `session_create` con `input_format: "pcm_16000"` y `output_delivery: "speaking_pace"`.
   - En `session_ready`: `getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })`
     → `AudioContext({ sampleRate: 16000 })` → AudioWorklet (`web/pcm-worklet.js`) que pasa Float32 a Int16 LE
     → trozos de 40 ms (640 muestras) → base64 → `{ type: "audio_input", audio }`.
   - `audio_output`: base64 → Int16 → Float32 → `AudioBufferSourceNode` encadenados con `nextStartTime`
     (sin huecos). `audio_output_clear`: para todas las fuentes y reinicia `nextStartTime` (interrupción).
   - `client_tool_call`: `pantalla_actual` → `GET /api/current` → responde con `client_tool_result`
     (`result` = JSON en string). `resaltar` → `POST /api/highlight { text: parameters.texto }` (no espera
     respuesta). Herramienta desconocida → `is_error: true`. Registra cada llamada en el panel de log.
   - Si el AudioWorklet falla, recurre a `ScriptProcessorNode`.

## Hecho cuando

- **13:35**: se oye el saludo del agente en la web y el agente te entiende (con o sin las herramientas).
- **13:45**: `pantalla_actual` va y vuelve (se ve en el log) y el agente usa la respuesta.

Consejo para la demo: cascos o altavoz bajo; si no, el agente se oye a sí mismo.
