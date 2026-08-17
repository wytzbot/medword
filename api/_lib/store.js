// Shared persistence helper used by every /api/* route that needs to remember
// something between requests (Pro entitlements, processed payments, webhook
// idempotency keys). Serverless functions do NOT share memory or disk between
// invocations, so this uses Upstash Redis's REST API (just fetch — no SDK
// install needed) when it's configured.
//
// Required env vars for production:
//   UPSTASH_REDIS_REST_URL
//   UPSTASH_REDIS_REST_TOKEN
// (Create a free Upstash Redis database, or use Vercel's "Upstash for Redis"
// marketplace integration, then copy those two values into your Vercel
// Project → Settings → Environment Variables.)
//
// If those aren't set, this falls back to an in-memory Map so the app still
// runs locally — but that fallback is NOT persistent (it resets on every
// cold start and isn't shared across instances), so Pro status and payment
// verification will not survive in that mode. Set the env vars before
// accepting real payments.

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
export const kvBackedByUpstash = Boolean(UPSTASH_URL && UPSTASH_TOKEN);

const memory = globalThis.__medwordMemoryStore || (globalThis.__medwordMemoryStore = new Map());

async function upstash(command) {
  const r = await fetch(UPSTASH_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command)
  });
  if (!r.ok) throw new Error(`Upstash request failed (${r.status})`);
  const data = await r.json();
  return data.result;
}

export async function kvGet(key) {
  if (kvBackedByUpstash) {
    try {
      const result = await upstash(['GET', key]);
      return result ? JSON.parse(result) : null;
    } catch {
      return null;
    }
  }
  return memory.has(key) ? memory.get(key) : null;
}

export async function kvSet(key, value, { ttlSeconds } = {}) {
  if (kvBackedByUpstash) {
    const command = ttlSeconds
      ? ['SET', key, JSON.stringify(value), 'EX', String(ttlSeconds)]
      : ['SET', key, JSON.stringify(value)];
    await upstash(command);
    return;
  }
  memory.set(key, value);
  if (ttlSeconds) {
    const t = setTimeout(() => memory.delete(key), ttlSeconds * 1000);
    t.unref?.();
  }
}

// Sets a key only if it doesn't already exist — used to make payment
// activation idempotent so the same transaction can never grant Pro twice.
// Returns true if this call performed the write (i.e. it was the first).
export async function kvSetIfAbsent(key, value) {
  if (kvBackedByUpstash) {
    try {
      const result = await upstash(['SET', key, JSON.stringify(value), 'NX']);
      return result === 'OK';
    } catch {
      return false;
    }
  }
  if (memory.has(key)) return false;
  memory.set(key, value);
  return true;
}
