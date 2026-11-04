// Solo webs públicas: ni el explorador ni el proxy pueden apuntar a tu ordenador o a tu red
// (localhost, redes privadas, link-local, metadatos de la nube…).
import { lookup } from 'node:dns/promises';
import net from 'node:net';

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  const x = ip.toLowerCase();
  if (x.startsWith('::ffff:')) return isPrivateIp(x.slice(7));
  return x === '::' || x === '::1' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe80');
}

const cache = new Map(); // host → Promise<boolean>

/** true si la URL es http(s) y su host resuelve solo a direcciones públicas. */
export function isPublicUrl(u) {
  let host;
  try {
    const url = new URL(u);
    if (!/^https?:$/.test(url.protocol)) return Promise.resolve(false);
    host = url.hostname.replace(/^\[|\]$/g, '');
  } catch {
    return Promise.resolve(false);
  }
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return Promise.resolve(false);
  if (net.isIP(host)) return Promise.resolve(!isPrivateIp(host));
  if (!cache.has(host)) {
    cache.set(
      host,
      lookup(host, { all: true })
        .then((addrs) => addrs.length > 0 && addrs.every((a) => !isPrivateIp(a.address)))
        .catch(() => false),
    );
  }
  return cache.get(host);
}
