# Lazarillo

Le das una URL que **nunca ha visto** → un agente explorador la recorre y construye el **Product Brain**
(mapa de pantallas y rutas) → un **agente guía de voz** (Cartesia) te hace la demo hablando, sabe en qué
pantalla estás y te **resalta dónde pulsar**. (Track 1 · Hackathon Karumi × Comillas.)

## ⭐ Recomendado: usa la rama `mejoras`

La rama `main` es la entrega del hackathon (14:00) y se queda tal cual. **Recomendamos usar el repo con las
mejoras de la rama `mejoras`: mejoran muchísimo la experiencia de usuario.** El visitante dice «quiero ver
esto» y la IA va ella misma a esa página, se la explica con datos concretos y propone el siguiente paso, con
una conversación natural y sin esperas. Y funciona con cualquier web, no solo con karumi.ai.

### Arrancar con tu propia cuenta de Cartesia (2 minutos)

```bash
git clone https://github.com/marcromeu04/lazarillo && cd lazarillo && git checkout mejoras
npm i
cp .env.example .env      # pon TU CARTESIA_API_KEY (https://play.cartesia.ai/keys): en el repo no va ninguna
npm run setup             # crea tu agente de voz, registra las herramientas y le carga el grafo
npm start                 # http://localhost:3000 en Chrome
```

No hay que tocar nada más: `npm run setup` deja el id de tu agente en `.env`. Necesitas Node 22 y Google
Chrome instalado (el agente de mapeo usa tu Chrome; no descarga navegadores).

### Qué cambia respecto a la entrega

| | Entrega (`main`) | Mejoras (`mejoras`) |
|---|---|---|
| Quién navega | el visitante, la IA solo señala | **la IA pulsa y navega ella misma** (`ir_a`) y narra mientras carga |
| Webs | karumi.ai | **cualquier web**: escribe la URL arriba y pulsa «Explorar». Cada web se abre en **su propio origen local** (`server/server.mjs`, proxy inverso), así que también cargan las SPA (React, Vite, Next.js) y las direcciones que redirigen a otro dominio. Con 14 webs reales, antes 4 salían en blanco (simplehost.es, YouTube, Holded, Factorial); ahora ninguna |
| Contexto de la voz | cerebro de 37 KB (~9.300 tokens) en cada turno | **grafo compacto: ~1.300 tokens** para las 25 páginas de karumi.ai (7× menos) |
| Detalle de cada página | todo de golpe en las instrucciones | **solo al entrar en ella y una vez por llamada** (~1 KB por herramienta) |
| Mapeo | Chrome página a página: ~60 s para 30 páginas | **dos fases**: primero el mapa mental con HTML en paralelo y sitemap (**40 páginas de karumi.ai en ~7 s**), y el detalle después, según la probabilidad. En webs pintadas con JavaScript, **la propia pantalla de la demo hace de navegador**: el puente lee la página ya pintada y de ahí salen su detalle y las páginas nuevas, sin abrir otro Chrome (simplehost.es: de 1 página y detalle vacío a 2 páginas con su texto real) |
| Velocidad | descarga cada página al navegar | **el agente de mapeo se adelanta**: investiga las vecinas y las que predice la conversación; la página prevista se abre en ~1,2 s (0,55 s son el resaltado, a propósito) |
| Si algo falla | — | responde en **17 ms** con alternativas y la IA sigue sin darle importancia |
| Tono | instrucciones básicas | prompt de **persona de producto con experiencia**: natural, segura, va al grano |
| Cómo empieza | pregunta qué le trae | **descubre el problema del visitante** (qué le duele, cómo lo hace hoy, qué quiere ver) y va directo a la página que más valor le aporta; si no lo tiene claro, le enseña el mayor problema que resuelve el software |
| Pantalla | `scrollIntoView` a la primera coincidencia | **la pantalla sigue a la voz en el orden de la página** (`server/bridge.js`): un solo movimiento a la vez, encuadra la sección bajo la cabecera fija, fundido en los saltos largos, no toca carruseles, respeta scroll-snap y Lenis, y si el visitante mueve la página o dice «párate aquí», se queda quieta. En karumi.ai, la misma narración de 10 frases antes saltaba a las preguntas frecuentes y volvía; ahora avanza siempre en el orden de la página |
| Panel | log | **cinco vistas** (teclas 1-5, pantalla completa con F): **Demo** (web + llamada), **Web** sola, **Grafo** en grande y en vivo (principal → secundarias, con dónde está la IA, su recorrido, lo que se investiga y lo probable), **Conversación** en burbujas y **Panel** de interés que se actualiza en directo durante la llamada |
| Ventas | — | **trazabilidad del interés**: tiempo y preguntas por página, problema (pain), señales de compra y perfil de cada visitante |

Medido en local el 2026-11-04 con karumi.ai/es (40 páginas en 6,8 s) y books.toscrape.com (40 páginas en 3,2 s).

### Cómo funciona: dos agentes que se pasan el contexto

1. **Agente de mapeo** (`explorer/`): recorre la web con Chrome y construye el grafo, con todas las
   direcciones y un resumen de una frase de cada una. Durante la demo se adelanta:
   - al entrar en una página, investiga a fondo esa y sus vecinas (`deep.mjs`);
   - por la conversación, predice a qué páginas querrá ir el visitante y las prepara (`graph.mjs → predict`).
     Lo hace sin LLM, en menos de 5 ms por turno.
2. **Agente de la demo** (Cartesia): lleva en la memoria solo el grafo compacto. Al entrar en una página
   recibe su detalle ampliado (`pantalla_actual` / `ir_a`), pulsa por su cuenta y, si algo falla, pasa a
   otra cosa.

### El modelo del agente de mapeo (opcional, el que tú quieras)

El agente de mapeo funciona sin modelo: hace el mapa en segundos, una ficha básica de la web y predice por
palabras. Con un modelo, además **interpreta qué es la web y sus funcionalidades** (la ficha va al principio de
lo que sabe la voz) y **analiza la conversación en tiempo real** para predecir a qué páginas querrá ir el
visitante, y las prepara antes. Se configura en `.env` con cualquier proveedor en formato OpenAI, Anthropic o
Google (ver `.env.example`):

```
MAPEO_LLM_URL=https://opencode.ai/inference/go/openai/v1
MAPEO_LLM_MODEL=glm-5.3-flash
MAPEO_LLM_KEY=<tu clave>
```

**En la demo usamos GLM-5.3-Flash** (OpenCode Go): rápido y barato. Para más inteligencia, cambia a uno de la
tabla de abajo.

Compruébalo con `npm run probar-modelo`.

**Qué modelo usamos y por qué** (medido el 2026-11-04): pedimos al menos **35 en el Artificial Analysis
Intelligence Index** y, de los que pasan, el más rápido. Ninguno de los gratuitos de OpenCode llega (GLM-5.3-Flash
28, MiMo Flash 27, Beam 18, Nemotron Super VL 14), y además solo funcionan dentro del programa OpenCode, no por
API. Con OpenCode Go:

| Modelo | Índice AA | 1.ª respuesta (AA) | Nota |
|---|---|---|---|
| **Gemini 4 Argon** | **50** | 39,5 s | el más inteligente de los rápidos: **recomendado** |
| Claude Haiku 5.5 (xhigh) | 35 | 49 s | el más barato de los que pasan |
| Grok 4.7 (high) | 35 | 32 s | |

### Trazabilidad del interés (`insights/`)

Cada llamada se parte en tramos, uno por página. En cada tramo se mide el tiempo, las preguntas, las señales
de interés y de compra, las frases en las que el visitante cuenta su problema y su perfil (tamaño, área). Al
colgar se guarda un informe en `sites/<web>/sesiones/`. El enlace «informe ↗» del panel suma todas las
sesiones: qué páginas interesan más y qué problemas se repiten, para afinar la venta.

> **Privacidad:** el informe guarda frases literales del visitante. Avísale de que la demo se analiza. Los
> informes se quedan en tu ordenador: `sites/` no se sube al repo.

### Seguridad

El servidor solo escucha en `127.0.0.1` y rechaza llamadas de otras webs. La web explorada se muestra desde
su propio origen local (`www-capcut-com.localhost:3001`), distinto del de la app: sus scripts no pueden leer
la app ni usar `/api`, y ese origen solo sirve el dominio que se está explorando, sin pasarle cookies. Las
claves van en `.env`, que nunca se sube.

### Futuras mejoras

Lo que hemos visto al probarlo con webs reales y que lo mejoraría todavía más, de más a menos valor:

| Mejora | Por qué (lo que hemos visto) | Esfuerzo |
|---|---|---|
| **Medir la voz en llamadas reales** (tiempo de cada turno, preguntas antes de enseñar, tiempo hasta la página que resuelve su problema) | Hoy el cuello de botella es el turno de voz (modelo + síntesis), no la pantalla ni la predicción. Sin medirlo no sabemos qué tocar | bajo |
| **Fuentes e imágenes de CDN de terceros** también por el proxy local | Algunas CDN solo dejan usar sus fuentes desde la web real (p. ej. `b.stripecdn.com` en Stripe): la página se ve, pero con otra tipografía | medio |
| **Webs con Cloudflare**: abrirlas directas en el iframe cuando no lo prohíben (sin puente) en vez del aviso | Cloudflare frena las peticiones del servidor; hoy se ofrece abrirlas en otra pestaña | medio |
| **HTTPS local** (certificado de desarrollo) para webs que montan sus direcciones con `https://` + el host actual | Allbirds (Shopify) pide `https://www-allbirds-com.localhost:3001` y esa petición falla; la página carga, pero sin esa parte | medio |
| **Exportar el informe de interés** (PDF/CSV) o mandarlo al CRM | Las señales de compra y el problema del visitante son para el comercial: que no se queden en el panel | medio |
| **Predicción con un modelo de decisión** (p. ej. Jev) solo si gana en local | En nuestras demos, 7 de 8 cambios de página iban a una página enlazada que ya se prepara al entrar; el predictor por palabras acierta 4 de 7 en su top 3. Con ≥ 50 cambios grabados se compara en local antes de integrarlo (otra clave, y las frases del visitante saldrían a EE. UU.) | bajo para medir |
| **Chromium de Playwright como respaldo** si no hay Chrome instalado | Para montarlo en un servidor o en Docker. Ver la medición de abajo | bajo |

**¿Renta un navegador (Chromium) para el mapeo?** Como mapeo principal, **no**. Medido el 2026-11-05 con 20 páginas
por web, el HTML y el navegador sacan las mismas páginas, los mismos titulares por página y casi los mismos
enlaces, pero el navegador tarda de 7 a 10 veces más:

| Web | HTML | Navegador |
|---|---|---|
| karumi.ai/es | 20 págs en 5,1 s | 20 págs en 39,4 s |
| holded.com/es | 20 págs en 2,9 s | 20 págs en 23,4 s |
| factorial.es | 20 págs en 1,8 s | 20 págs en 15,7 s |
| linear.app | 20 págs en 2,9 s | 20 págs en 27,6 s |
| notion.com/es | 20 págs en 8,1 s | 20 págs en 58 s |
| simplehost.es (se pinta con JavaScript) | sin enlaces | 2 págs en 2,6 s (todas las que tiene) |

Ya se usa donde sí renta: cuando el HTML llega sin enlaces (web pintada con JavaScript), el mapeo pasa solo a
Chrome. Cambiar el Chrome instalado por el Chromium de Playwright no cambia los resultados (es el mismo motor);
solo ayuda en máquinas sin Chrome, a cambio de descargar el navegador (más de 100 MB) en cada instalación.

---

## Arrancar la entrega (rama `main`) en cualquier ordenador (30 s)
```bash
npm i
npm start          # http://localhost:3000  (ábrelo en Chrome)
```
En `main` va la configuración de la demo del hackathon. En `mejoras` no hay ninguna clave en el repo: cada uno pone
la suya de Cartesia en `.env` (ver «Arrancar con tu propia cuenta de Cartesia» arriba).

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
