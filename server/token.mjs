// Lazarillo v2 — token Cartesia para el navegador (P1).
// ESM, sin dependencias, usa el fetch global de Node 18+.
// Nunca lanza: si falla o no hay clave, devuelve mock para que la demo siga viva.

export async function createToken() {
  const key = process.env.CARTESIA_API_KEY;
  const agentId = process.env.CARTESIA_AGENT_ID || null;

  if (!key) return { token: null, agentId: null, mock: true };

  try {
    const r = await fetch('https://api.cartesia.ai/access-token', {
      method: 'POST',
      headers: {
        'X-API-Key': key,
        'Cartesia-Version': '2026-08-14',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ grants: { agent: true }, expires_in: 900 }),
    });

    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      return { token: null, agentId, mock: true, error: `access-token ${r.status}`, detail: detail.slice(0, 300) };
    }

    const data = await r.json().catch(() => ({}));
    const token = data.token || data.access_token || null;
    if (!token) return { token: null, agentId, mock: true, error: 'sin token en la respuesta' };

    return { token, agentId };
  } catch (e) {
    return { token: null, agentId, mock: true, error: String(e && e.message || e) };
  }
}
