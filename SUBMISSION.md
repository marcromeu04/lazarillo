# Entrega — Lazarillo (Track 1, Karumi × Comillas)

Agente que explora una web que nunca ha visto, construye su Product Brain
(mapa de pantallas y rutas) y te hace la demo por voz: sabe en qué pantalla
estás y te resalta dónde pulsar.

## Ejecutar en cualquier ordenador
    git clone https://github.com/marcromeu04/lazarillo
    cd lazarillo && npm i && npm start
    # abrir http://localhost:3000 en Chrome → "Empezar demo"

La clave de Cartesia va incluida y visible en `.env.demo` (no hay que configurar nada).

## Agente de voz (en vivo)
- Modelo gpt-5.4-mini (552 ms, el de menor latencia), voz española.
- Client tools: pantalla_actual() y resaltar(texto).
- Verificado por WebSocket: saluda, entiende y llama a las herramientas.

Equipo: Marc (marcromeu04) + Javier (JRN-Snowball).
