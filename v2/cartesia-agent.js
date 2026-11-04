// v2/cartesia-agent.js — Lazarillo v2 · Cartesia Managed Agent (P4)
//
// Creates/configures a Cartesia MANAGED agent (Cartesia hosts the LLM) for
// low-latency Spanish voice guiding. The agent's instructions embed brain.md +
// knowledge/comunicacion.md. It exposes two CLIENT tools that run in the
// visitor's browser (P1) against the DOM bridge (P3):
//   - pantalla_actual()        -> { screen_id, path, title, section }
//   - resaltar(texto: string)  -> { ok: true }
//
// ESM, Node 18+, uses global fetch. Key ONLY from process.env.CARTESIA_API_KEY.
// Boots without a key (returns a mock) so the app still runs.
//
// Every endpoint path / payload shape is isolated in the constants below and
// marked // TODO(verify): confirm against play.cartesia.ai docs, because the
// Agents API surface is young and may shift.

// ---------------------------------------------------------------------------
// API surface (isolate everything that could change here)
// ---------------------------------------------------------------------------

const API_BASE = 'https://api.cartesia.ai';

// Cartesia requires a dated version header on every request.
// TODO(verify): confirm current version against play.cartesia.ai docs.
const CARTESIA_VERSION = '2026-08-14';

const ENDPOINTS = {
  // TODO(verify): confirm against play.cartesia.ai docs — POST, returns ManagedAgentV1 { id }.
  createAgent: '/v1/agents',
  // TODO(verify): confirm against play.cartesia.ai docs — PATCH/PUT to update config.
  updateAgent: (agentId) => `/v1/agents/${agentId}`,
  // TODO(verify): confirm against play.cartesia.ai docs — POST, returns { id } (agent_tool_...).
  createTool: '/v1/agents/tools',
  // TODO(verify): confirm against play.cartesia.ai docs — list available model ids.
  listModels: '/v1/agents/models',
  // TODO(verify): confirm against play.cartesia.ai docs — POST, returns { token }.
  accessToken: '/access-token',
};

// Realtime WebSocket the browser (P1) opens, authed with the ephemeral token.
// TODO(verify): confirm against play.cartesia.ai docs — wss base + /agents/stream/{id}.
const WS_BASE = 'wss://api.cartesia.ai';
const agentStreamUrl = (agentId) => `${WS_BASE}/agents/stream/${agentId}`;

// Voice + model defaults for Spanish guiding. Keep latency low, quality high.
// TODO(verify): confirm model id and a good Spanish voice_id against play.cartesia.ai docs.
const DEFAULTS = {
  modelId: 'sonic-agent',                               // Cartesia-hosted LLM id
  voiceId: 'a0e99841-438c-4a64-b679-ae501e7d6091',      // placeholder Spanish-capable voice
  language: 'es',
  tokenTtlSecs: 3600,                                   // max 1h per docs
};

// ---------------------------------------------------------------------------
// knowledge/comunicacion.md — embedded fallback.
// P5 should pass the live file contents into buildInstructions({comunicacionMd}).
// This copy exists so the agent still has a voice persona if the file is absent.
// ---------------------------------------------------------------------------

const COMUNICACION_FALLBACK = `
Eres Lazarillo, un guía que sabe mucho y es cercano, como un sales engineer
español sentado al lado del visitante. Tuteas. Hablas con seguridad y calidez,
sin sonar a vendedor pesado.

Longitud y forma: turnos MUY cortos, de una a tres frases, unas treinta y cinco
palabras como mucho. Una idea por turno. Terminas devolviendo la palabra con una
pregunta corta o una indicación clara. Escribes para que se ESCUCHE, no para que
se lea: frases cortas y muletillas habladas ("vale", "mira", "fíjate", "a ver",
"justo aquí"). Nada de listas, markdown, emojis, URLs, paréntesis ni siglas
raras. Los números, en palabras.

Ritmo: pausas con comas para respirar. Una pausa justo antes del dato importante.

Orientación: SIEMPRE dices dónde está el visitante y adónde vais.

Actitud: usas las palabras del visitante. Primero entiendes, luego enseñas; si no
sabes qué busca, haces UNA sola pregunta. Nunca te inventas nada: solo hablas de
lo que hay en el mapa o en la página actual. Si algo no está: "Eso no lo veo en
la web, pero lo más parecido es…". Si te interrumpen, paras y contestas a lo
nuevo sin quejarte. Contestas en el idioma en que te hable el visitante.

Prohibido: "¡Excelente pregunta!", "como IA", los monólogos, repetir el saludo,
leer la pantalla entera.
`.trim();

// ---------------------------------------------------------------------------
// Client tools — Cartesia client-tool schema (type: "client").
// ---------------------------------------------------------------------------

export const CLIENT_TOOLS = [
  {
    type: 'client',
    name: 'pantalla_actual',
    description:
      'Devuelve dónde está AHORA el visitante en la web: id de pantalla, ruta, ' +
      'título y sección visible. Llámala antes de orientar o de resaltar, para ' +
      'no equivocarte de página. No recibe argumentos. Responde en menos de 300 ms.',
    // Must return a value — the agent needs the location to reason.
    expects_response: true,
    // TODO(verify): valid values auto|force|off; keep the agent quiet while it checks.
    pre_tool_speech: 'off',
    // TODO(verify): immediate vs async execution semantics.
    execution_mode: 'immediate',
    response_timeout_secs: 5,
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    type: 'client',
    name: 'resaltar',
    description:
      'Resalta en el navegador del visitante el elemento visible cuyo texto más ' +
      'se parezca a "texto" (usa los textos exactos de key_elements del mapa). ' +
      'Dibuja un anillo morado pulsante con una chapita durante unos segundos. ' +
      'Úsala para señalar UN solo elemento por turno.',
    // Fire-and-forget visual action; the agent keeps talking.
    expects_response: false,
    pre_tool_speech: 'off',
    execution_mode: 'immediate',
    response_timeout_secs: 5,
    parameters: {
      type: 'object',
      properties: {
        texto: {
          type: 'string',
          description:
            'Texto EXACTO (o lo más cercano) del botón, enlace o título a resaltar.',
        },
      },
      required: ['texto'],
    },
  },
];

// ---------------------------------------------------------------------------
// Instructions builder — voice-first system prompt.
// ---------------------------------------------------------------------------

/**
 * Build the full system instruction string for the managed agent.
 * @param {{brainMd?: string, comunicacionMd?: string}} opts
 * @returns {string}
 */
export function buildInstructions({ brainMd = '', comunicacionMd = '' } = {}) {
  const persona = (comunicacionMd && comunicacionMd.trim()) || COMUNICACION_FALLBACK;
  const brain =
    (brainMd && brainMd.trim()) ||
    'AÚN NO HAY MAPA. Di que estás preparando el recorrido y haz UNA pregunta ' +
      'para entender qué busca el visitante.';

  return [
    '# QUIÉN ERES Y CÓMO HABLAS',
    persona,
    '',
    '# CANAL DE VOZ (IMPORTANTE)',
    'Esto es una conversación HABLADA en tiempo real. Una a tres frases por turno,',
    'nunca más. Al terminar, devuelve la palabra con una pregunta corta o una',
    'indicación clara. No leas nunca en voz alta rutas, etiquetas, ids ni nada',
    'entre corchetes o llaves: son instrucciones internas, no texto para decir.',
    '',
    '# CÓMO ACTÚAS SOBRE LA PANTALLA (HERRAMIENTAS)',
    'Tienes dos herramientas que ocurren en el navegador del visitante:',
    '- pantalla_actual(): te dice dónde está AHORA (pantalla, ruta, título, sección).',
    '  Llámala al empezar y siempre que necesites orientarte, ANTES de resaltar.',
    '- resaltar(texto): marca en pantalla el elemento cuyo texto pasas. Usa SIEMPRE',
    '  los textos exactos del mapa (key_elements). Un solo elemento por turno,',
    '  pegado a la frase que lo describe ("fíjate aquí…", y resaltas).',
    'No describas que vas a usar una herramienta: úsala y comenta en lenguaje natural.',
    '',
    '# RITMO DE LA DEMO',
    '1) Saluda breve y haz UNA pregunta para entender qué necesita.',
    '2) Lleva la conversación a la pantalla que resuelve lo suyo; di dónde está',
    '   ahora, qué va a tocar y qué verá.',
    '3) Resalta UN elemento concreto y cuenta en una frase qué gana con él.',
    '4) Pregúntale si quiere ver el siguiente paso.',
    'Enseña primero lo más impresionante PARA LO QUE ÉL NECESITA, no la portada.',
    'Si pregunta algo que no está en el mapa, reconócelo y ofrece lo más parecido.',
    'Nunca te inventes pantallas ni elementos: solo lo que está en el MAPA de abajo.',
    '',
    '# MAPA DE LA WEB (tu única fuente de verdad)',
    brain,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

function apiKey() {
  return process.env.CARTESIA_API_KEY || '';
}

async function cartesiaFetch(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      'Cartesia-Version': CARTESIA_VERSION,
      'Content-Type': 'application/json',
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(
      `Cartesia ${method} ${path} -> ${res.status} ${res.statusText}: ${text.slice(0, 500)}`,
    );
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// ---------------------------------------------------------------------------
// createAgent — create the two client tools, then the managed agent.
// ---------------------------------------------------------------------------

/**
 * Create/configure the Cartesia managed agent.
 * @param {{brainMd?: string, comunicacionMd?: string}} opts
 * @returns {Promise<{agentId: string, mock?: boolean, config?: object}>}
 */
export async function createAgent({ brainMd = '', comunicacionMd = '' } = {}) {
  const instructions = buildInstructions({ brainMd, comunicacionMd });

  if (!apiKey()) {
    console.warn(
      '[cartesia-agent] CARTESIA_API_KEY ausente — devuelvo agente MOCK. ' +
        'La app arranca igual, pero no habrá voz real hasta configurar la clave.',
    );
    return {
      agentId: 'mock',
      mock: true,
      // Return the config we WOULD have sent, so P5/tests can inspect it.
      config: {
        instructions,
        model: { id: DEFAULTS.modelId },
        language: { primary: DEFAULTS.language },
        audio: { output: { voice_id: DEFAULTS.voiceId } },
        tools: CLIENT_TOOLS,
      },
    };
  }

  // 1) Register the client tools (shared resources) and collect their ids.
  //    TODO(verify): confirm the agent references tools by id in config.tools.
  const toolIds = [];
  for (const tool of CLIENT_TOOLS) {
    const created = await cartesiaFetch(ENDPOINTS.createTool, {
      method: 'POST',
      body: tool,
    });
    const id = created.id || created.tool_id;
    if (!id) {
      throw new Error(
        `[cartesia-agent] respuesta de createTool sin id: ${JSON.stringify(created).slice(0, 300)}`,
      );
    }
    toolIds.push(id);
  }

  // 2) Create the managed agent with the embedded instructions + tool refs.
  //    TODO(verify): confirm the exact create payload shape (config.*).
  const payload = {
    name: 'Lazarillo',
    description: 'Guía de voz en español para demos web (Lazarillo v2).',
    config: {
      instructions,
      // null => el agente espera a que hable el visitante. P1 puede saludar.
      initial_message: null,
      model: { id: DEFAULTS.modelId },
      language: { primary: DEFAULTS.language },
      audio: { output: { voice_id: DEFAULTS.voiceId } },
      tools: toolIds,
    },
  };

  const agent = await cartesiaFetch(ENDPOINTS.createAgent, {
    method: 'POST',
    body: payload,
  });

  const agentId = agent.id || agent.agent_id;
  if (!agentId) {
    throw new Error(
      `[cartesia-agent] respuesta de createAgent sin id: ${JSON.stringify(agent).slice(0, 300)}`,
    );
  }

  console.log(`[cartesia-agent] agente creado: ${agentId}`);
  return { agentId, config: payload.config };
}

// ---------------------------------------------------------------------------
// mintSession — ephemeral token + connection info for the browser (P1).
// ---------------------------------------------------------------------------

/**
 * Mint an ephemeral session for the browser to open a realtime voice WebSocket.
 * NEVER returns the API key — only a short-lived access token.
 * @param {string} agentId
 * @returns {Promise<{
 *   mock?: boolean,
 *   agentId: string,
 *   token: string,
 *   wsUrl: string,
 *   cartesiaVersion: string,
 *   expiresIn: number
 * }>}
 */
export async function mintSession(agentId) {
  if (!agentId) throw new Error('[cartesia-agent] mintSession necesita un agentId');

  if (!apiKey() || agentId === 'mock') {
    console.warn(
      '[cartesia-agent] mintSession en modo MOCK (sin clave o agente mock) — ' +
        'token vacío; P1 debe mostrar aviso de "voz no configurada".',
    );
    return {
      mock: true,
      agentId,
      token: '',
      wsUrl: agentStreamUrl(agentId),
      cartesiaVersion: CARTESIA_VERSION,
      expiresIn: 0,
    };
  }

  // TODO(verify): confirm grants/expires_in shape and that "agent" grant
  // authorizes the /agents/stream WebSocket.
  const res = await cartesiaFetch(ENDPOINTS.accessToken, {
    method: 'POST',
    body: {
      grants: { agent: true },
      expires_in: DEFAULTS.tokenTtlSecs,
    },
  });

  const token = res.token || res.access_token;
  if (!token) {
    throw new Error(
      `[cartesia-agent] respuesta de access-token sin token: ${JSON.stringify(res).slice(0, 300)}`,
    );
  }

  return {
    agentId,
    token,
    // Browser connects with ?access_token=<token> (or Authorization: Bearer).
    wsUrl: agentStreamUrl(agentId),
    cartesiaVersion: CARTESIA_VERSION,
    expiresIn: DEFAULTS.tokenTtlSecs,
  };
}

// Also export the constants so P5/tests can inspect or override them.
export { API_BASE, WS_BASE, CARTESIA_VERSION, ENDPOINTS, DEFAULTS, agentStreamUrl };
