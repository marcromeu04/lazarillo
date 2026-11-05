// Trazabilidad del interés: qué le interesa a cada visitante y qué problema quiere resolver.
//
// La llamada se parte en tramos, uno por página visitada. En cada tramo se mide el tiempo y
// se analiza lo que dice el visitante: preguntas, señales de interés o de compra, frases en
// las que cuenta su problema (el «pain») y pistas de su perfil. Todo local y sin LLM.
// Al colgar se guarda un informe por sesión en sites/<web>/sesiones/ (fuera del repo).
//
// Privacidad: guarda frases literales del visitante. Avísale de que la demo se analiza.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const deacc = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const clip = (t, n) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, n);

const RX = {
  question: /\?|^(que|como|cuanto|cuanta|cual|cuales|donde|cuando|por que|puedo|se puede|teneis|tienes|hay|funciona|sirve)\b/,
  positive: /me interesa|interesante|genial|me gusta|mola|justo lo que|perfecto|guay|me encaja|(me|nos) (sirve|vale)|brutal|increible|que bien|esto es lo que/,
  negative: /no me interesa|no (nos|me) (sirve|hace falta)|aburrid|pasa(mos)? a otra|no hace falta|no es para (mi|nosotros)|dejalo/,
  buying: /precio|cuanto cuesta|coste|tarifa|plan(es)?\b|contratar|probar|prueba gratis|trial|integra|implement|cuanto tarda|plazo|licencia|presupuesto|hablar con ventas|reunion/,
  pain: /problema|nos cuesta|me cuesta|tardamos|perdemos|no tenemos|no podemos|necesitamos|nos falta|me preocupa|lento|manual|a mano|caro|demasiad|no escala|cuello de botella|se nos (va|escapa)|quemad|saturad|no da abasto|no llegamos/,
};
const PROFILE = {
  tamaño: /(\d[\d.]*)\s*(personas|empleados|trabajadores|comerciales|vendedores)|startup|pyme|empresa (grande|pequena|mediana)|multinacional|enterprise|corporativ/,
  area: /ventas|comercial|marketing|soporte|atencion al cliente|onboarding|producto|ingenier|desarroll|cto|ceo|fundador|founder|rrhh|recursos humanos|customer success/,
};
const STOP = new Set('que los las del por para con una uno unos unas como mas pero sus les este esta esto ese esa eso hay muy ser son fue era tan sin sobre entre cuando donde quien cual todo toda todos puede quiero ver vamos vale bueno gracias hola tambien algo otra otro aqui ahora luego tengo tiene tenemos nuestro nuestra'.split(' '));

let session = null;
let seg = null;

export function startSession(site) {
  if (session && !session.endedAt) endSession();
  session = { id: new Date().toISOString().replace(/[:.]/g, '-'), site, startedAt: Date.now(), segments: [], turns: [] };
  seg = null;
  return session;
}

/** La IA (o el visitante) entra en una página: se cierra el tramo anterior y empieza otro. */
export function enterPage(page) {
  if (!session) return;
  const now = Date.now();
  if (seg) seg.leftAt = now;
  if (seg && seg.pageId === page.id) return; // misma página: el tramo sigue
  seg = { pageId: page.id, title: page.title, path: page.path, enteredAt: now, leftAt: null, user: [], ia: [] };
  session.segments.push(seg);
}

export function addTurn(role, text) {
  if (!session || !text) return;
  const t = clip(text, 600);
  session.turns.push({ role, text: t, at: Date.now() - session.startedAt, page: seg?.pageId || null });
  if (seg) seg[role === 'user' ? 'user' : 'ia'].push(t);
}

function analyzeText(lines) {
  const out = { preguntas: 0, positivas: 0, negativas: 0, compra: [], pain: [], perfil: {} };
  for (const line of lines) {
    const sentences = line.split(/(?<=[.!?])\s+/);
    for (const s of sentences) {
      const d = deacc(s);
      if (RX.question.test(d.trim())) out.preguntas++;
      if (RX.positive.test(d)) out.positivas++;
      if (RX.negative.test(d)) out.negativas++;
      if (RX.buying.test(d)) out.compra.push(clip(s, 140));
      if (RX.pain.test(d) && !RX.positive.test(d)) out.pain.push(clip(s, 160)); // «es justo lo que necesitamos» es interés, no un problema
      for (const [k, rx] of Object.entries(PROFILE)) {
        const m = d.match(rx);
        if (m) (out.perfil[k] ||= new Set()).add(m[0]);
      }
    }
  }
  return out;
}

function topics(lines, n = 5) {
  const freq = new Map();
  for (const w of deacc(lines.join(' ')).split(/[^a-z0-9ñ]+/)) if (w.length > 3 && !STOP.has(w)) freq.set(w, (freq.get(w) || 0) + 1);
  return [...freq].sort((a, b) => b[1] - a[1]).slice(0, n).map(([w]) => w);
}

/** Interés 0-100 de una página: tiempo, cuánto habla y pregunta, y lo que dice. */
function score(seconds, a, userTurns) {
  const s = seconds * 0.6 + a.preguntas * 14 + userTurns * 6 + a.positivas * 18 + a.compra.length * 14 + a.pain.length * 10 - a.negativas * 25;
  return Math.max(0, Math.min(100, Math.round(s)));
}

/** Interés por página hasta ahora (para pintar el grafo en vivo). */
export function liveInterest() {
  if (!session) return {};
  const now = Date.now();
  const byPage = new Map();
  for (const sg of session.segments) {
    const p = byPage.get(sg.pageId) || { seconds: 0, user: [] };
    p.seconds += ((sg.leftAt || now) - sg.enteredAt) / 1000;
    p.user.push(...sg.user);
    byPage.set(sg.pageId, p);
  }
  return Object.fromEntries([...byPage].map(([id, p]) => [id, score(p.seconds, analyzeText(p.user), p.user.length)]));
}

export function report() {
  if (!session) return null;
  const now = session.endedAt || Date.now();
  const byPage = new Map();
  for (const sg of session.segments) {
    const p = byPage.get(sg.pageId) || { id: sg.pageId, title: sg.title, path: sg.path, seconds: 0, visits: 0, user: [], ia: [] };
    p.seconds += ((sg.leftAt || now) - sg.enteredAt) / 1000;
    p.visits++;
    p.user.push(...sg.user);
    p.ia.push(...sg.ia);
    byPage.set(sg.pageId, p);
  }
  const pages = [...byPage.values()].map((p) => {
    const a = analyzeText(p.user);
    return { id: p.id, title: p.title, path: p.path, segundos: Math.round(p.seconds), visitas: p.visits, intervenciones: p.user.length, preguntas: a.preguntas, interes: score(p.seconds, a, p.user.length), temas: topics(p.user), pain: a.pain, compra: a.compra };
  }).sort((x, y) => y.interes - x.interes);
  const all = analyzeText(session.turns.filter((t) => t.role === 'user').map((t) => t.text));
  const top = pages[0];
  return {
    sesion: session.id,
    web: session.site,
    duracionSeg: Math.round((now - session.startedAt) / 1000),
    paginas: pages,
    pain: [...new Set(all.pain)].slice(0, 6),
    señalesCompra: [...new Set(all.compra)].slice(0, 6),
    perfil: Object.fromEntries(Object.entries(all.perfil).map(([k, v]) => [k, [...v]])),
    resumen: top ? `Le interesó sobre todo «${top.title}» (${top.segundos} s, ${top.preguntas} preguntas)${all.pain[0] ? `. Su problema: «${all.pain[0]}»` : ''}${all.compra[0] ? `. Señal de compra: «${all.compra[0]}»` : ''}.` : 'Sin datos suficientes.',
    transcripcion: session.turns,
  };
}

/** Al colgar: cierra la sesión, guarda el informe y lo devuelve. */
export function endSession() {
  if (!session || session.endedAt) return report();
  if (seg) seg.leftAt = Date.now();
  session.endedAt = Date.now();
  const r = report();
  if (session.turns.length || session.segments.length > 1) {
    const dir = path.join(ROOT, 'sites', String(session.site || 'web').replace(/[^a-z0-9.-]/gi, '_'), 'sesiones');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${session.id}.json`), JSON.stringify(r, null, 2));
  }
  return r;
}

/** Todas las sesiones guardadas de una web: qué páginas interesan más y qué problemas se repiten. */
export function aggregate(site) {
  const dir = path.join(ROOT, 'sites', String(site || 'web').replace(/[^a-z0-9.-]/gi, '_'), 'sesiones');
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch {}
  const pages = new Map();
  const pains = new Map();
  const buys = new Map();
  for (const f of files) {
    let r;
    try {
      r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    } catch {
      continue;
    }
    for (const p of r.paginas || []) {
      const a = pages.get(p.id) || { id: p.id, title: p.title, sesiones: 0, interesTotal: 0, segundos: 0 };
      a.sesiones++;
      a.interesTotal += p.interes;
      a.segundos += p.segundos;
      pages.set(p.id, a);
    }
    for (const x of r.pain || []) pains.set(x, (pains.get(x) || 0) + 1);
    for (const x of r.señalesCompra || []) buys.set(x, (buys.get(x) || 0) + 1);
  }
  return {
    web: site,
    sesiones: files.length,
    paginas: [...pages.values()].map((a) => ({ id: a.id, title: a.title, sesiones: a.sesiones, interesMedio: Math.round(a.interesTotal / a.sesiones), segundosMedios: Math.round(a.segundos / a.sesiones) })).sort((x, y) => y.interesMedio - x.interesMedio),
    painFrecuentes: [...pains].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([t, n]) => ({ frase: t, veces: n })),
    señalesCompra: [...buys].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([t, n]) => ({ frase: t, veces: n })),
  };
}
