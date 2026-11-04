// Lazarillo v2 — servidor local (Javier / P5). node:http, sin dependencias.
// Sirve web/ y monta las rutas del contrato. Si un módulo aún no existe, esa ruta
// devuelve 503 y lo demás sigue funcionando (nadie espera a nadie).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const WEB = path.join(ROOT, 'web');

// Cargar entorno sin dependencias. Prueba .env y, si no, .env.demo (clave de
// demo incluida para que arranque en cualquier ordenador sin configurar nada).
function loadEnv(file) {
  try {
    const raw = fs.readFileSync(path.join(ROOT, file), 'utf8');
    let n = 0;
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) { process.env[m[1]] = m[2].trim(); n++; }
    }
    return n;
  } catch { return 0; }
}
loadEnv('.env');
loadEnv('.env.demo'); // relleno: solo pone las que falten

const PORT = process.env.PORT || 3000;

// Carga perezosa de módulos de compañeros; si falta, la ruta responde 503.
async function load(mod) {
  try { return await import(mod); }
  catch (e) { return { __missing: true, __err: String(e.message || e) }; }
}
const token = await load('./token.mjs');
const watcher = await load('./watcher.mjs');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function sendJson(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); }
function body(req) {
  return new Promise((resolve) => {
    let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve({}); } });
  });
}
function serveStatic(req, res) {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';
  const file = path.join(WEB, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(WEB) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end('not found');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  try {
    if (url === '/api/token' && req.method === 'POST') {
      if (token.__missing || !token.createToken) return sendJson(res, 503, { error: 'token.mjs no disponible', detail: token.__err });
      return sendJson(res, 200, await token.createToken());
    }
    if (url === '/api/open' && req.method === 'POST') {
      if (watcher.__missing || !watcher.open) return sendJson(res, 503, { error: 'watcher.mjs no disponible', detail: watcher.__err });
      const { url: target } = await body(req);
      return sendJson(res, 200, await watcher.open(target));
    }
    if (url === '/api/current' && req.method === 'GET') {
      if (watcher.__missing || !watcher.current) return sendJson(res, 503, { error: 'watcher.mjs no disponible', detail: watcher.__err });
      return sendJson(res, 200, await watcher.current());
    }
    if (url === '/api/highlight' && req.method === 'POST') {
      if (watcher.__missing || !watcher.highlight) return sendJson(res, 503, { error: 'watcher.mjs no disponible', detail: watcher.__err });
      const { text } = await body(req);
      return sendJson(res, 200, await watcher.highlight(text));
    }
    if (req.method === 'GET') return serveStatic(req, res);
    res.writeHead(404); res.end('not found');
  } catch (e) {
    sendJson(res, 500, { error: String(e.message || e) });
  }
});

server.listen(PORT, () => {
  console.log(`\n  Lazarillo v2 → http://localhost:${PORT}  (Chrome)`);
  console.log(`  token.mjs: ${token.__missing ? '✗ (503)' : '✓'}   watcher.mjs: ${watcher.__missing ? '✗ (503)' : '✓'}`);
  if (!process.env.CARTESIA_API_KEY) console.log('  ⚠  Falta CARTESIA_API_KEY en .env — la voz no conectará (demo N1 = Playground).');
});
