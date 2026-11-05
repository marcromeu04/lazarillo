// Modelo del agente de mapeo, intercambiable. Tres formatos de API, que se detectan por la URL:
//   OpenAI      …/chat/completions        (OpenCode Go para Grok/Kimi/DeepSeek/GPT, OpenRouter, Ollama…)
//   Anthropic   …/messages                (OpenCode Go para Claude Haiku 5.5, la API de Anthropic…)
//   Google      …/models/<m>:generateContent (OpenCode Go para Gemini, la API de Gemini…)
// Configuración en .env:
//   MAPEO_LLM_URL       base de la API, p. ej. https://opencode.ai/inference/go/google/v1beta
//   MAPEO_LLM_KEY       la clave de ese proveedor, o «opencode» para usar la que ya tiene OpenCode
//   MAPEO_LLM_MODEL     el modelo, p. ej. gemini-4-argon
//   MAPEO_LLM_ESFUERZO  opcional: low | medium | high … (razonamiento, si el modelo lo admite)
//   MAPEO_LLM_ESFUERZO_PREDICCION  opcional, para la predicción en tiempo real (por defecto low)
//   MAPEO_LLM_FORMATO   opcional: openai | anthropic | google (si la URL no lo deja claro)
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// OpenCode Go pide que cada cliente se identifique con su propio nombre y mande un id de sesión
// estable por conversación (x-opencode-session). Lazarillo: uno por llamada de voz y uno por web.
export const USER_AGENT = 'lazarillo/1.0';
let convSession = randomUUID();
export function newLlmSession() {
  convSession = randomUUID();
  return convSession;
}

// MAPEO_LLM_KEY=opencode → se usa la clave que OpenCode ya tiene guardada (auth.json), leída en el
// momento y solo para direcciones de opencode.ai. No se copia a ningún sitio ni se muestra.
function opencodeKey(url) {
  if (!/^https:\/\/opencode\.ai\//.test(url)) return '';
  const base = process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share');
  try {
    const auth = JSON.parse(readFileSync(join(base, 'opencode', 'auth.json'), 'utf8'));
    const order = /\/inference\/go\//.test(url) ? ['opencode-go', 'opencode'] : ['opencode', 'opencode-go'];
    for (const p of order) if (auth[p]?.type === 'api' && auth[p]?.key) return auth[p].key;
  } catch {}
  return '';
}

export function llmConfig() {
  const url = (process.env.MAPEO_LLM_URL || '').replace(/\/+$/, '');
  const model = process.env.MAPEO_LLM_MODEL || '';
  if (!url || !model) return null;
  // Sin clave no se usa (fallaría en cada turno), salvo un modelo local sin clave (Ollama…).
  if (!process.env.MAPEO_LLM_KEY && !/\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(url)) return null;
  const format = process.env.MAPEO_LLM_FORMATO || (/anthropic/i.test(url) ? 'anthropic' : /google|generativelanguage|v1beta/i.test(url) ? 'google' : 'openai');
  const raw = process.env.MAPEO_LLM_KEY || '';
  const key = raw === 'opencode' ? opencodeKey(url) : raw;
  if (raw === 'opencode' && !key) return null; // no hay clave de OpenCode guardada
  return { url, model, key, effort: process.env.MAPEO_LLM_ESFUERZO || '', format };
}

/** Una llamada de texto → texto. Lanza un error si falla o tarda más de timeoutMs. */
export async function callLLM(prompt, { maxTokens = 1800, timeoutMs = 25000, cfg = llmConfig(), session = convSession } = {}) {
  if (!cfg) throw new Error('sin modelo configurado');
  const auth = { 'User-Agent': USER_AGENT, ...(cfg.key ? { Authorization: `Bearer ${cfg.key}` } : {}), ...(/^https:\/\/opencode\.ai\//.test(cfg.url) ? { 'x-opencode-session': session } : {}) };
  const signal = AbortSignal.timeout(timeoutMs);
  let r;
  let pick;
  if (cfg.format === 'anthropic') {
    // La API de Anthropic lee la clave de x-api-key; Authorization: Bearer es para tokens OAuth, no se manda.
    const { Authorization, ...noBearer } = auth;
    r = await fetch(`${cfg.url}/messages`, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01', ...(cfg.key ? { 'x-api-key': cfg.key } : {}), ...(/^https:\/\/api\.anthropic\.com\//.test(cfg.url) ? noBearer : auth) },
      // Los Claude actuales (Haiku 5.5…) piensan por defecto y ese pensamiento cuenta en max_tokens:
      // margen extra para que el JSON no salga cortado.
      body: JSON.stringify({ model: cfg.model, max_tokens: maxTokens + 6000, messages: [{ role: 'user', content: prompt }], ...(cfg.effort ? { output_config: { effort: cfg.effort } } : {}) }),
    });
    pick = (j) => (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  } else if (cfg.format === 'google') {
    r = await fetch(`${cfg.url}/models/${encodeURIComponent(cfg.model)}:generateContent`, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json', ...(cfg.key ? { 'x-goog-api-key': cfg.key } : {}), ...auth },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: maxTokens, ...(cfg.effort ? { thinkingConfig: { thinkingLevel: cfg.effort } } : {}) } }),
    });
    pick = (j) => (j.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('');
  } else {
    r = await fetch(`${cfg.url}/chat/completions`, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify({ model: cfg.model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }], ...(cfg.effort ? { reasoning_effort: cfg.effort } : {}) }),
    });
    pick = (j) => j.choices?.[0]?.message?.content || '';
  }
  if (!r.ok) throw new Error(`HTTP ${r.status} ${(await r.text().catch(() => '')).slice(0, 120)}`);
  return pick(await r.json());
}

/** Extrae el primer objeto JSON de un texto (los modelos a veces lo envuelven en ```json). */
export function parseJson(text) {
  const s = String(text || '');
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try {
    return JSON.parse(s.slice(a, b + 1));
  } catch {
    return null;
  }
}
