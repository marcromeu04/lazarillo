# Lazarillo — Plan (Track 1, Karumi × Comillas)

**Una frase:** le das una URL que nunca ha visto → un agente explorador la recorre en <60 s y construye el
**Product Brain** (grafo de pantallas + rutas) → un agente guía de voz (Cartesia) te hace la demo hablando,
sabe en qué pantalla estás y te resalta dónde pulsar.

## Arquitectura: 2 agentes + 1 cerebro
```
URL ─► [EXPLORADOR] Playwright + Chrome · BFS mismo dominio · ≤25 pantallas · <60 s
         ▼  brain/app-map.json (grafo)  +  brain/brain.md (<5k tokens, rutas precalculadas)
[GUÍA DE VOZ] Cartesia Managed Agent (oído Ink + LLM gestionado + voz Sonic)
         ▲ client tools por WebSocket:
         │  pantalla_actual() → /api/current → observador: dónde está + rutas desde ahí (≤1 KB)
         │  resaltar(texto)   → /api/highlight → observador: marca el botón en el Chrome del visitante
[web/] micro ⇄ WebSocket Cartesia ⇄ altavoz      [server/watcher] Chrome del visitante
```

## Gestión del contexto (la clave)
1. **Fijo**: el mapa compacto va en las instrucciones. El LLM NO calcula rutas (van precalculadas por BFS).
2. **Vivo**: `pantalla_actual()` devuelve solo la pantalla actual + rutas desde ahí (≤1 KB) → turnos cortos → voz fluida.
3. **Acción**: `resaltar(texto)` señala en pantalla.

**DOM, no visión**: exacto, gratis, sin clave de LLM, segundos. La visión va en «con una semana más».

## Niveles (se presenta el más alto que funcione a las 13:45)
- **N1 (13:35, obligatorio)**: explorador → brain.md → agente Cartesia hablando de la app en el Playground.
- **N2 (13:45)**: web con voz por WebSocket + `pantalla_actual`.
- **N3 (si sobra)**: `resaltar` + eval de 10 rutas.

## Reparto (ficheros disjuntos) — ver `contracts/api.md`
- P1 voz web → `web/**`, `server/token.mjs`
- P2 explorador → `explorer/**`, `brain/**`  (Javier lo tiene funcionando)
- P3 observador → `server/watcher.mjs`
- P4 cartesia → `cartesia/**`
- P5 integración → `server/server.mjs`, `contracts/**`, `package.json`, `PLAN.md`, `_ESTADO.md`, `eval/**`, `pitch/**`

## Red de seguridad
`npm run start:v1` → app v1 completa (iframe + ElevenLabs, voz con fallback del navegador) que YA funciona.
Garantiza una demo pulsable pase lo que pase con Cartesia.

## Arranque
```
npm i
cp .env.example .env        # CARTESIA_API_KEY, CARTESIA_AGENT_ID, ANTHROPIC_API_KEY
npm run explore -- https://books.toscrape.com && npm run brain && npm run push
npm start                   # http://localhost:3000 en Chrome
```
