// Solo webs públicas: ni el explorador ni el proxy pueden llegar a tu ordenador o a tu red
// (localhost, redes privadas, link-local, metadatos de la nube…).
//  - isPublicUrl(u): comprobación previa (esquema, host, DNS) con caché corta.
//  - safeFetch(u):   descarga en la que la IP se valida AL CONECTAR (sin margen para un
//                    cambio de DNS entre comprobar y conectar) y cada redirección se valida
//                    antes de seguirla.
import dns from 'node:dns';
import net from 'node:net';
import { Agent, fetch as ufetch } from 'undici';

// Dos listas separadas: una BlockList con reglas IPv6 también «captura» IPv4 por su forma
// mapeada (::ffff:a.b.c.d), así que mezclarlas bloquearía todas las webs.
const blocked4 = new net.BlockList();
for (const [a, p] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3]]) blocked4.addSubnet(a, p, 'ipv4');
const blocked6 = new net.BlockList();
for (const [a, p] of [['::', 128], ['::1', 128], ['100::', 64], ['2001:db8::', 32], ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8]]) blocked6.addSubnet(a, p, 'ipv6');

/** IPv6 → sus 8 bloques de 16 bits (admite «::» y una IPv4 al final). */
function expand6(ip) {
  let s = ip.toLowerCase().split('%')[0];
  const v4 = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const [a, b, c, d] = v4[1].split('.').map(Number);
    s = s.slice(0, -v4[1].length) + ((a << 8) | b).toString(16) + ':' + ((c << 8) | d).toString(16);
  }
  const [head, tail] = s.split('::');
  const h = head ? head.split(':') : [];
  const t = tail !== undefined ? (tail ? tail.split(':') : []) : [];
  const parts = tail !== undefined ? [...h, ...Array(8 - h.length - t.length).fill('0'), ...t] : h;
  return parts.map((x) => parseInt(x || '0', 16));
}

/** Si la IPv6 lleva una IPv4 dentro (mapeada ::ffff:, compatible :: o NAT64 64:ff9b::), la devuelve. */
function embeddedV4(ip) {
  const p = expand6(ip);
  if (p.length !== 8) return null;
  const tail = `${p[6] >> 8}.${p[6] & 255}.${p[7] >> 8}.${p[7] & 255}`;
  const zeros5 = p.slice(0, 5).every((x) => x === 0);
  if (zeros5 && (p[5] === 0xffff || p[5] === 0) && (p[6] || p[7])) return tail;
  if (p[0] === 0x64 && p[1] === 0xff9b && p.slice(2, 6).every((x) => x === 0)) return tail;
  return null;
}

export function isBlockedIp(ip) {
  const v = net.isIP(ip);
  if (v === 4) return blocked4.check(ip, 'ipv4');
  if (v === 6) {
    const inner = embeddedV4(ip);
    return inner ? blocked4.check(inner, 'ipv4') : blocked6.check(ip, 'ipv6');
  }
  return true;
}

const BAD_HOST = /^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.home\.arpa)$/i;
const cache = new Map(); // host → { ok, at }
const TTL = 30_000;

/** true si la URL es http(s) y su host resuelve solo a direcciones públicas. */
export async function isPublicUrl(u) {
  let host;
  try {
    const url = new URL(u);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return false;
    host = url.hostname.replace(/^\[|\]$/g, '');
  } catch {
    return false;
  }
  if (BAD_HOST.test(host)) return false;
  if (net.isIP(host)) return !isBlockedIp(host);
  const hit = cache.get(host);
  if (hit && Date.now() - hit.at < TTL) return hit.ok;
  let ok = false;
  try {
    const addrs = await dns.promises.lookup(host, { all: true });
    ok = addrs.length > 0 && addrs.every((a) => !isBlockedIp(a.address));
  } catch {}
  cache.set(host, { ok, at: Date.now() });
  return ok;
}

// La IP se valida en el momento de conectar: es la que de verdad se usa.
const agent = new Agent({
  connect: {
    lookup(hostname, options, cb) {
      dns.lookup(hostname, { all: true }, (err, addrs) => {
        if (err) return cb(err);
        if (!addrs.length || addrs.some((a) => isBlockedIp(a.address))) return cb(Object.assign(new Error('dirección interna bloqueada'), { code: 'EBLOCKED' }));
        if (options && options.all) return cb(null, addrs);
        cb(null, addrs[0].address, addrs[0].family);
      });
    },
  },
  connections: 16,
  keepAliveTimeout: 10_000,
});

/**
 * Descarga solo webs públicas. Devuelve { res, url } con la URL final tras redirecciones.
 * Lanza un error si algún salto apunta a una dirección interna.
 */
export async function safeFetch(url, { headers = {}, timeoutMs = 10_000, maxHops = 5 } = {}) {
  let current = url;
  for (let hop = 0; hop <= maxHops; hop++) {
    if (!(await isPublicUrl(current))) throw Object.assign(new Error('solo webs públicas'), { code: 'EBLOCKED' });
    const res = await ufetch(current, { headers, redirect: 'manual', dispatcher: agent, signal: AbortSignal.timeout(timeoutMs) });
    const loc = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    if (!loc) return { res, url: current };
    try {
      await res.body?.cancel();
    } catch {}
    current = new URL(loc, current).href;
  }
  throw new Error('demasiadas redirecciones');
}
