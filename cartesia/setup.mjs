// npm run setup — deja Lazarillo listo con TU cuenta de Cartesia, sin pasos a mano:
//   1. lee CARTESIA_API_KEY de tu .env (nunca usa la clave de demo de .env.demo);
//   2. crea el agente de voz «Lazarillo» en tu cuenta (o reutiliza el que ya creaste);
//   3. registra las herramientas (pantalla_actual, ir_a, resaltar) y le carga el grafo;
//   4. guarda su id en .env como CARTESIA_AGENT_ID_MEJORAS.
// Después: npm start → http://localhost:3000
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, cartesia } from './lib.mjs';
import { createAgent } from './create-agent.mjs';
import { pushBrain } from './push-brain.mjs';
import * as graph from '../explorer/graph.mjs';

const envPath = path.join(ROOT, '.env');
const readEnvFile = () => {
  try {
    return fs.readFileSync(envPath, 'utf8');
  } catch {
    return '';
  }
};
const getVar = (raw, k) => (raw.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim() || '';

try {
  process.loadEnvFile(envPath); // también el modelo del agente de mapeo (MAPEO_LLM_*)
} catch {}
let raw = readEnvFile();
const key = getVar(raw, 'CARTESIA_API_KEY');
if (!key) {
  console.error('\n✗ Falta tu clave: crea .env a partir de .env.example y pon CARTESIA_API_KEY=<tu clave de play.cartesia.ai/keys>\n');
  process.exit(1);
}

let agentId = getVar(raw, 'CARTESIA_AGENT_ID_MEJORAS');
if (agentId) {
  try {
    await cartesia(`/v1/agents/${agentId}`, { key });
    console.log(`✓ Reutilizo tu agente ${agentId}`);
  } catch {
    console.log(`  El agente ${agentId} no está en tu cuenta: creo uno nuevo.`);
    agentId = '';
  }
}
if (!agentId) {
  const agent = await createAgent();
  agentId = agent.id;
  console.log(`✓ Agente «${agent.name}» creado en tu cuenta: ${agentId}`);
}

graph.loadInitial();
await graph.ensureFicha(); // qué es la web y sus funcionalidades, antes de cargarla en la voz
const brain = graph.compactBrain();
const { toolIds, instructionsLength } = await pushBrain(agentId, brain);
console.log(`✓ ${toolIds.length} herramientas registradas y grafo de ${graph.getMap().app.host} cargado (${instructionsLength} caracteres de instrucciones, ~${Math.round(brain.length / 4)} tokens de grafo)`);

raw = readEnvFile();
// El id va en las dos variables: CARTESIA_AGENT_ID_MEJORAS (la que usa el servidor) y
// CARTESIA_AGENT_ID (para que tu .env no herede el agente de demo de .env.demo).
for (const k of ['CARTESIA_AGENT_ID_MEJORAS', 'CARTESIA_AGENT_ID']) {
  const line = `${k}=${agentId}`;
  const rx = new RegExp(`^${k}=.*$`, 'm');
  raw = rx.test(raw) ? raw.replace(rx, line) : raw.replace(/\r?\n?$/, '\n') + line + '\n';
}
fs.writeFileSync(envPath, raw);
console.log('✓ Guardado en .env\n\nListo. Arranca con:  npm start   →  http://localhost:3000\n');
