// make-brain.mjs — produce brain/brain.md
// If brain/brain.md already exists, keep it. Otherwise generate a minimal
// brain from contracts/app-map.example.json: one line per screen plus the
// routes reachable from the home screen.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const brainPath = resolve(root, "brain/brain.md");
const mapPath = resolve(root, "contracts/app-map.example.json");

if (existsSync(brainPath)) {
  const existing = await readFile(brainPath, "utf8");
  console.log(`brain/brain.md ya existe (${existing.length} bytes), lo reutilizo.`);
  process.exit(0);
}

const map = JSON.parse(await readFile(mapPath, "utf8"));
const screens = map.screens || [];
const byId = new Map(screens.map((s) => [s.id, s]));

// One line per screen: `s03 · Travel · purpose · ruta corta`
const screenLines = screens.map((s) => {
  const dests = (s.actions || [])
    .filter((a) => a.to && byId.has(a.to))
    .map((a) => `${a.label} → ${byId.get(a.to).title}`);
  const ruta = dests.length ? dests.join("; ") : "sin salidas";
  return `${s.id} · ${s.title} · ${s.purpose} · ${ruta}`;
});

// Routes from home (first screen / startUrl)
const home =
  screens.find((s) => s.url === map.app?.startUrl) || screens[0];
const homeRoutes = home
  ? (map.edges || [])
      .filter((e) => e.from === home.id)
      .map((e) => {
        const to = byId.get(e.to);
        return `Desde ${home.title}: pulsa «${e.via}» para ir a ${to ? to.title : e.to}`;
      })
  : [];

const out = [
  `# ${map.app?.name || "Aplicación"}`,
  ``,
  `## Pantallas`,
  ...screenLines,
  ``,
  `## Rutas desde ${home ? home.title : "inicio"}`,
  ...homeRoutes,
  ``,
].join("\n");

await mkdir(dirname(brainPath), { recursive: true });
await writeFile(brainPath, out, "utf8");
console.log(`brain/brain.md generado (${out.length} bytes, ${screens.length} pantallas).`);
