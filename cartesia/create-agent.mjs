// create-agent.mjs — POST /v1/agents to create "Lazarillo".
// Chosen model: lowest average_latency_ms (gpt-5.4-mini, 552 ms).
// Chosen voice: Darío (es-ES, masculine) 35b2cfc1-...
// speculative_generation is supported (seen in config shape) and left on.
// Prints the new agent id on the last line of stdout so callers can capture it.
import { cartesia } from "./lib.mjs";

export const MODEL_ID = "gpt-5.4-mini";
export const VOICE_ID = "35b2cfc1-e6fb-4d69-a598-c1780612be4a"; // Darío, es-ES masc.
export const INITIAL_MESSAGE =
  "¡Hola! Soy Lazarillo, te enseño la web en un par de minutos. Cuéntame, ¿qué te trae por aquí?";

export async function createAgent() {
  const body = {
    name: "Lazarillo",
    config: {
      speculative_generation: true,
      instructions: "",
      initial_message: INITIAL_MESSAGE,
      model: { id: MODEL_ID },
      language: { primary: "es", additional: [] },
      audio: { output: { voice_id: VOICE_ID } },
    },
  };
  const agent = await cartesia("/v1/agents", { method: "POST", body });
  return agent;
}

const isMain = process.argv[1] && process.argv[1].endsWith("create-agent.mjs");
if (isMain) {
  const agent = await createAgent();
  console.error(
    `Agente creado: name=${agent.name} model=${agent.config?.model?.id} voice=${agent.config?.audio?.output?.voice_id} lang=${agent.config?.language?.primary}`,
  );
  console.log(agent.id);
}
