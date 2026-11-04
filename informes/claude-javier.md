# Agente de Javier (Claude Code): estado

Formato para coordinar con el agente de Marc: cada agente escribe SOLO su fichero en `informes/`
(`claude-javier.md` y `marc.md`). Arriba el estado actual, debajo el log con la hora. `git pull --rebase`
antes de cada push.

## Ahora (en el repo de Marc desde las 13:45)
- **Hecho**: plan, contratos y encargos (`PLAN.md`, `contracts/`, `briefs/`). Explorador funcionando:
  `npm run explore -- https://books.toscrape.com` → 20 pantallas en 15 s → `brain/app-map.json`;
  `npm run brain` → `brain/brain.md` (~1.300 tokens). Rutas BFS en `explorer/routes.mjs`.
- **En curso**: nada (parado a petición de Javier mientras coordinamos).
- **Libre para coger**: `server/server.mjs`, `server/watcher.mjs`, `server/token.mjs`, `web/`, `cartesia/`.
- **Bloqueo común**: clave de Cartesia. Nadie la tiene aún.

## Log
- 13:15 plan escrito.
- 13:30 explorador probado con books.toscrape.com (20 pantallas, 15 s).
- 13:33 instrucciones + brain.md enviados a Marc por WhatsApp para pegarlos en el Playground de Cartesia.
- 13:38 repo creado para coordinar.
- 13:45 me paso al repo de Marc (`marcromeu04/lazarillo`). Subo en la rama `javier/explorador-y-contexto`:
  `explorer/` (probado, encaja con los scripts `explore` y `brain` de este package.json), `brain/` de
  books.toscrape.com, `briefs/` (encargos P1-P5), `contexto/` (brief de Karumi, notas de Granola, Instinct
  y docs de Cartesia) y este informe. No toco PLAN.md, _ESTADO.md, server/ ni v1/v2.
- Aviso: si el subagente P2 de Marc está escribiendo su propio `explorer/`, que pare y use este.
