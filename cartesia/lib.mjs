// lib.mjs — shared helpers for Cartesia scripts (ESM, Node 18+, global fetch)
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(__dirname, "..");

export const BASE = "https://api.cartesia.ai";
export const CARTESIA_VERSION = "2026-08-14";

async function readEnv() {
  const raw = await readFile(resolve(ROOT, ".env"), "utf8");
  const env = {};
  for (const line of raw.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

export async function apiKey() {
  const k = (await readEnv()).CARTESIA_API_KEY;
  if (!k) throw new Error("CARTESIA_API_KEY ausente en .env");
  return k;
}

export async function getEnv(name) {
  return (await readEnv())[name] || "";
}

export async function cartesia(path, { method = "GET", body, key } = {}) {
  const k = key || (await apiKey());
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "X-API-Key": k,
      "Cartesia-Version": CARTESIA_VERSION,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    throw new Error(`${method} ${path} → HTTP ${res.status}: ${text}`);
  }
  return data;
}
