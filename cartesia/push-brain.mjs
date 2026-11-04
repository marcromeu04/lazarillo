// push-brain.mjs (npm run push) — reads brain/brain.md, substitutes {{BRAIN}}
// into cartesia/instructions.md, and PATCHes the agent config with the
// instructions, initial_message, tools, model, voice and language.
// Agent id comes from CARTESIA_AGENT_ID in .env.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { cartesia, getEnv, ROOT } from "./lib.mjs";
import { MODEL_ID, VOICE_ID, INITIAL_MESSAGE } from "./create-agent.mjs";
import { setupTools } from "./setup-tools.mjs";

export async function pushBrain(agentId, brainText) {
  const id = agentId || (await getEnv("CARTESIA_AGENT_ID"));
  if (!id) throw new Error("CARTESIA_AGENT_ID ausente en .env");

  const template = await readFile(
    resolve(ROOT, "cartesia/instructions.md"),
    "utf8",
  );
  const brain = brainText || (await readFile(resolve(ROOT, "brain/brain.md"), "utf8"));
  const instructions = template.replace("{{BRAIN}}", brain.trim());

  const toolIds = await setupTools();

  const body = {
    config: {
      instructions,
      initial_message: INITIAL_MESSAGE,
      tools: toolIds.map((tid) => ({ id: tid })),
      model: { id: MODEL_ID },
      audio: { output: { voice_id: VOICE_ID } },
      language: { primary: "es", additional: [] },
    },
  };

  const agent = await cartesia(`/v1/agents/${id}`, { method: "PATCH", body });
  return { agent, toolIds, instructionsLength: instructions.length };
}

const isMain = process.argv[1] && process.argv[1].endsWith("push-brain.mjs");
if (isMain) {
  const { agent, toolIds, instructionsLength } = await pushBrain();
  console.error(
    `Push OK → agent=${agent.id} tools=${toolIds.length} instrucciones=${instructionsLength}B model=${agent.config?.model?.id} voice=${agent.config?.audio?.output?.voice_id}`,
  );
  console.log(agent.id);
}
