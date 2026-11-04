# Lazarillo v2 — contratos compartidos (NO romper entre agentes)

Arquitectura (plan Javier + Marc):
1. **Explorador profundo (P2)** — en segundo plano, con varios sub-agentes, recorre la web a fondo,
   entiende FUNCIONALIDADES (no solo títulos) y produce `brain.md` + `brain.json`. Se precomputa y cachea
   ANTES de hablar: cuando Marc dice "ya", el mapa mental ya está listo.
2. **Guía de voz Cartesia (P4)** — Managed Agent (el LLM va incluido en Cartesia). Recibe `brain.md` +
   `knowledge/comunicacion.md` en sus instrucciones. Latencia mínima, calidad máxima. NO mapea en vivo:
   solo habla sobre el brain ya construido. Expone dos client tools (ver abajo).
3. **Observador / bridge (P3)** — mira el Chrome del visitante. Implementa las dos client tools contra el DOM real.
4. **Voz web (P1)** — frontend: mic, conexión realtime a Cartesia, orbe, transcripción; recibe las llamadas a
   client tools y las ejecuta vía el bridge (postMessage), devolviendo el resultado a Cartesia.
5. **Integración (P5 = Claude principal)** — `v2/server.js`, .env, arranque.

El agente de voz SIEMPRE rápido y natural. Todo el trabajo pesado (mapear, entender) ocurre en segundo plano.

---

## brain.json  (fuente de verdad del mapa mental, la escribe P2)
```json
{
  "product": { "name": "", "one_liner": "", "audience": "" },
  "screens": [
    {
      "id": "home",                       // slug estable
      "path": "/",
      "title": "",
      "purpose": "una frase: para qué sirve",
      "functionalities": ["qué PUEDE HACER el usuario aquí, en lenguaje natural"],
      "key_elements": ["textos EXACTOS de botones/enlaces/títulos — se usan para resaltar()"],
      "wow": "lo más potente de esta pantalla, una frase",
      "how_to_get_here": "dicho como se habla, p.ej. 'arriba a la derecha, en Precios'",
      "reachable_from": ["home"]          // ids de pantallas desde las que se llega
    }
  ],
  "edges": [ { "from": "home", "to": "pricing", "via": "Precios" } ],
  "suggested_tour": ["home", "pricing", "..."],   // orden ideal para demo, lo wow primero
  "main_nav": ["etiquetas"]
}
```
`brain.md` = versión legible de lo mismo, pensada para meterse TAL CUAL en las instrucciones del agente de voz:
producto, luego una sección por pantalla (propósito, funcionalidades, cómo llegar, elementos exactos, wow),
y el tour sugerido. Sin markdown ruidoso: prosa corta y clara.

Se guarda en `cache/<dominio>.brain.json` y `cache/<dominio>.brain.md`.

---

## Client tools (las define P4 en Cartesia, las ejecuta P1→P3)
`pantalla_actual()` → `{ "screen_id": "pricing", "path": "/precios", "title": "Precios", "section": "Planes" }`
  El agente lo llama para saber SIEMPRE dónde está el visitante. Debe responder en <300 ms.
`resaltar(texto)` → `{ "ok": true }`
  Resalta en el Chrome del visitante el elemento visible cuyo texto más se parezca a `texto`
  (usar key_elements). Anillo morado pulsante + chapita "aquí" durante 4 s.

Transporte: el frontend (P1) recibe los eventos tool-call de Cartesia, llama al bridge (P3) por
`postMessage`, y devuelve el JSON de resultado a Cartesia. El bridge responde con:
  `{type:'current_screen', ...}`  y  `{type:'highlight_result', ok}`.

---

## Reglas para todos
- Nadie toca v1 (server.js, public/, raíz). Todo v2 vive en `v2/`.
- Claves SOLO desde `process.env` (.env). Nunca hardcodear.
- ESM, Node 18+. Sin build step. Frontend vanilla.
- Si falta la red o el Playwright-extension/MCP, el código degrada con fallback y deja TODO marcado con `// TODO(live):`.
- Reutiliza lo que ya funciona en v1 (crawler cheerio, bridge de highlight) cuando aplique.
