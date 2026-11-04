# P4 · Agente de voz en Cartesia (Claude Code Go)

Pásale este fichero entero a tu agente. Lee antes `contracts/api.md` (sección Cartesia).
Documentación: <https://docs.cartesia.ai/llms.txt> (agentes: `agents/introduction.md`, `agents/configuration.md`).

**Objetivo**: el agente guía, configurado y hablando español, con el Product Brain cargado y las dos
client tools enganchadas.

**Solo tocas**: `cartesia/**`. **Informe**: `informes/P4.md` desde la primera acción.

## Paso 0 (13:20, lo primero de todo el equipo)

1. Crea la cuenta en <https://play.cartesia.ai> y una API key en <https://play.cartesia.ai/keys>.
2. Pásala **por privado** a Javier y a P1. **Nunca** al repo ni al grupo. Va en `.env` (ya está en `.gitignore`).

## Qué hay que hacer

1. En el Playground → Agents → crea el agente **«Lazarillo»**:
   - idioma principal `es-ES` y una voz en español (filtra las voces por Spanish);
   - el modelo con menos latencia de la lista (`GET /v1/agents/models` da la latencia media);
   - `speculative_generation: true` y `turn.inactivity_check_in_secs: 15`.
   - Apunta el `agent_id` y pásalo a Javier y a P1.
2. `cartesia/instructions.md`: la plantilla de abajo, con `{{BRAIN}}` donde va el mapa.
3. `cartesia/push-brain.mjs` (`npm run push`): lee `brain/brain.md` (si no existe, genera un mapa mínimo a
   partir de `contracts/app-map.example.json`), sustituye `{{BRAIN}}` y hace `PATCH /v1/agents/{id}` con
   `{ config: { instructions, initial_message } }`.
4. `cartesia/setup-tools.mjs`: crea las dos herramientas de `contracts/cartesia-tools.json` con
   `POST /v1/agents/tools` y las engancha con `PATCH` → `config.tools: [{ id }, { id }]`. Si la API se
   resiste, créalas a mano en el Playground con los mismos nombres y descripciones.

## Plantilla de instrucciones

```text
# Identidad
Eres Lazarillo, un guía de demos por voz. Acabas de explorar esta aplicación por tu cuenta y conoces su
mapa (abajo). Hablas en español de España, cercano y muy breve.
# Cómo hablas
Frases cortas: dos como máximo por turno, salvo que te pidan más. Una pregunta cada vez. Nada de listas,
markdown ni URLs: esto es voz.
# Cómo haces la demo
1. Pregunta primero qué quiere conseguir el visitante.
2. Llama a pantalla_actual antes de dar una indicación y cada vez que diga que ha pulsado algo o que se ha perdido.
3. Da UN paso cada vez («pulsa Travel, en la columna de la izquierda») y llama a resaltar con el texto exacto.
4. Cuando llegue, explica en una frase para qué le sirve esa pantalla a él.
# Límites
Usa solo pantallas y botones del mapa o de pantalla_actual. Si algo no está, dilo: «eso no lo he visto en
la aplicación». No inventes precios, funciones ni datos.
# Mapa de la aplicación (Product Brain)
{{BRAIN}}
```

`initial_message`: «Hola, soy Lazarillo. Acabo de aprenderme esta aplicación. ¿Qué te gustaría conseguir con ella?»

## Hecho cuando

- **13:35**: en el Playground («Preview») preguntas «¿cómo llego a los libros de viajes?» con el mapa de
  books.toscrape.com y responde bien, en español y rápido. **Esto ya es el nivel 1 de la demo.**
- **13:45**: las dos herramientas están enganchadas al agente.
