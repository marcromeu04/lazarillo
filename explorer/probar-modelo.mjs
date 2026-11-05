// npm run probar-modelo — comprueba el modelo del agente de mapeo configurado en .env:
// saca la ficha de la web cargada y hace una predicción de ejemplo, con sus tiempos.
import { existsSync } from 'node:fs';
if (existsSync('.env')) process.loadEnvFile('.env');
const { llmConfig } = await import('./llm.mjs');
const graph = await import('./graph.mjs');
const { interpret, fichaText } = await import('./interpret.mjs');

const cfg = llmConfig();
if (!cfg) {
  console.log('\nSin modelo configurado: el mapeo usa la ficha y la predicción básicas (sin coste, al instante).');
  console.log('Para usar uno, rellena MAPEO_LLM_URL, MAPEO_LLM_MODEL y MAPEO_LLM_KEY en .env (ver .env.example).\n');
  process.exit(0);
}
console.log(`\nModelo: ${cfg.model} · formato ${cfg.format} · esfuerzo ${cfg.effort || 'por defecto'}`);
graph.loadInitial();
const m = graph.getMap();
delete m.ficha;
console.log(`Web: ${m.app.host} (${m.screens.length} páginas)\n`);

const it = await interpret(m, graph.compactBrain(m));
console.log(`Ficha: ${it.via} en ${(it.ms / 1000).toFixed(1)} s`);
console.log(fichaText(it.ficha).split('\n').slice(0, 4).join('\n'), '\n');

graph.setVisitor(m.screens[0].url);
const t0 = Date.now();
const got = await new Promise((resolve) => {
  const off = graph.onEvent((e) => { if (e.type === 'predict' && e.role === 'modelo') { off(); resolve(e); } });
  graph.noteTurn('user', '¿Cuánto me costaría esto y cómo empiezo a probarlo?');
  setTimeout(() => resolve(null), 20000);
});
console.log(got ? `Predicción con el modelo en ${((Date.now() - t0) / 1000).toFixed(1)} s: ${got.items.map((i) => `${i.id} ${m.screens.find((s) => s.id === i.id)?.title.slice(0, 40)} (${i.p}%)`).join(' | ')}` : 'Predicción con el modelo: sin respuesta en 20 s (se usa la predicción por palabras).');
console.log(it.via.startsWith('sin modelo') ? '\n✗ El modelo no respondió bien: revisa la URL, el modelo y la clave.\n' : '\n✓ Modelo funcionando.\n');
process.exit(0);
