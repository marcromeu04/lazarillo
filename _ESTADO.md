# _ESTADO.md — Lazarillo

Actualiza en cada checkpoint. Fuente de verdad = el repo.

## 13:3x (en construcción, lado Marc/Claude)
- **Backbone (P5)**: ✓ `server/server.mjs` (node:http, rutas con 503 si falta módulo), `package.json`
  (scripts explore/brain/push/setup-tools/start), `contracts/api.md`, `contracts/app-map.example.json`,
  `contracts/cartesia-tools.json`.
- **P1 voz web** (`web/`, `server/token.mjs`): en construcción (subagente).
- **P2 explorador** (`explorer/`): Javier lo tiene funcionando (books.toscrape.com, ~20 pantallas/15 s,
  brain.md ~1.300 tokens). En este repo: versión propia drop-in a la vez (subagente) para que arranque solo.
- **P3 observador** (`server/watcher.mjs`): en construcción (subagente).
- **P4 cartesia** (`cartesia/`): en construcción (subagente). **BLOQUEO GLOBAL: falta CARTESIA_API_KEY.**
- **v1 (red de seguridad)**: `server.js` + `public/index.html` — app completa iframe+ElevenLabs que YA
  funciona con voz. `npm run start:v1`. Garantiza el checkpoint pase lo que pase.

## Bloqueos
- **Cartesia**: nadie tiene clave. Crear cuenta en play.cartesia.ai, agente «Lazarillo» (es-ES, voz ES),
  pegar brain.md en instrucciones → demo N1 pulsable sin código. Clave SOLO a `.env`, nunca al repo.
- **GitHub compartido**: pendiente URL del repo de equipo. Mientras, se sube a un repo propio.
