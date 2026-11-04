# P5 · Integración, prueba y pitch (Javier: Claude Code Pro + Orca/OpenCode)

**Objetivo**: que a las 13:45 todo funcione de punta a punta en tu portátil y que a las 14:00 el pitch
cuente qué demuestra con números.

**Solo tocas**: `server/server.mjs`, `package.json`, `PLAN.md`, `_ESTADO.md`, `contracts/**`, `eval/**`, `pitch/**`.

## Tú, con Claude Code

1. **13:20**: `server/server.mjs` con `node:http` y sin dependencias. Carga `.env` con `process.loadEnvFile()`,
   sirve `web/` y monta las rutas de `contracts/api.md` importando `./token.mjs` y `./watcher.mjs`, con
   `try/catch`: si un módulo aún no existe, esa ruta devuelve 503 y lo demás sigue funcionando. Puerto 3000.
   Haz push **antes de las 13:25**: P1 y P3 lo necesitan para probar.
2. En cada checkpoint: `git pull`, prueba la cadena entera, actualiza `_ESTADO.md` y avisa de los bloqueos.
3. **13:45, congelación**: `npm run explore -- <url>` → `npm run brain` → `npm run push` → `npm start`
   → `POST /api/open` → hablar con el agente.

## Workers de Orca (OpenCode), cada uno con su fichero

- **W1 · prueba con números** (`eval/**`): `eval/preguntas.json` con 10 preguntas «¿cómo llego a X?» sobre
  books.toscrape.com y su ruta correcta (sacada a mano de la web), y `eval/run.mjs`, que compara con
  `routesFrom` e imprime «X/10 rutas correctas». Ese número va al pitch.
- **W2 · pitch** (`pitch/**`): `pitch/pitch.md` con el guion de 3 minutos (la estructura está en `PLAN.md`)
  y `pitch/mapa.html`, que pinta `brain/app-map.json` como grafo con Mermaid desde CDN. Es el «wow» visual
  del explorador.

## Ensayo (13:50)

Pestañas abiertas: la web de Lazarillo, el Chrome del visitante, `pitch/mapa.html` y el Playground de
Cartesia (el plan B del nivel 1).
