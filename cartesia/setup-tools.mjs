// setup-tools.mjs — POST /v1/agents/tools for each tool in
// contracts/cartesia-tools.json, collect their ids. Idempotent-ish: if a tool
// with the same name already exists it is reused instead of duplicated.
// Prints the ids as a JSON array on the final stdout line.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { cartesia, ROOT } from "./lib.mjs";

export async function setupTools() {
  const defs = JSON.parse(
    await readFile(resolve(ROOT, "contracts/cartesia-tools.json"), "utf8"),
  );

  // Fetch existing tools so we can reuse by name.
  const existing = await cartesia("/v1/agents/tools");
  const byName = new Map((existing.data || []).map((t) => [t.name, t.id]));

  const ids = [];
  for (const def of defs) {
    if (byName.has(def.name)) {
      console.error(`Herramienta «${def.name}» ya existe → ${byName.get(def.name)}`);
      ids.push(byName.get(def.name));
      continue;
    }
    // La API live solo acepta execution_mode "immediate"|"async".
    // El contrato usa "sync" para pantalla_actual (espera respuesta) → "immediate".
    const payload = { ...def };
    if (payload.execution_mode === "sync") payload.execution_mode = "immediate";
    const created = await cartesia("/v1/agents/tools", {
      method: "POST",
      body: payload,
    });
    console.error(`Herramienta «${def.name}» creada → ${created.id}`);
    ids.push(created.id);
  }
  return ids;
}

const isMain = process.argv[1] && process.argv[1].endsWith("setup-tools.mjs");
if (isMain) {
  const ids = await setupTools();
  console.log(JSON.stringify(ids));
}
