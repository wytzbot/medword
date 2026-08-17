// POST /api/create-payment
// body: { email: string, card?: { number, expiry_month, expiry_year, cvv } }
// returns either checkout/redirect information or the v4 encryption key needed
// by the browser to encrypt card details before the charge is created.

import { kvSet } from './_lib/store.js';

const CLIENT_ID = process.env.FLW_CLIENT_ID;
const CLIENT_SECRET = process.env.FLW_CLIENT_SECRET;
const ENCRYPTION_KEY = process.env.FLW_ENCRYPTION_KEY;
const FLW_BASE_URL = process.env.FLW_BASE_URL || 'https://f4bexperience.flutterwave.com';
const AMOUNT = 1000;
const CURRENCY = 'NGN';

function makeRef() {
  return `medword-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
function makeId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 14)}`;
}

async function getAccessToken() {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: 'client_credentials'
  });
  const r = await fetch('https://idp.flutterwave.com/realms/flutterwave/protocol/openid-connect/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  if (!r.ok) return null;
  const data = await r.json();
  return data?.access_token || null;
}

function v4Headers(token, idempotencyKey) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Trace-Id': makeId(),
    'X-Idempotency-Key': idempotencyKey
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!CLIENT_ID || !CLIENT_SECRET || !ENCRYPTION_KEY) {
    return res.status(500).json({ error: 'Payments are not configured on the server yet.' });
  }

  const body = req.body || {};
  const normalized = String(body.email ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return res.status(400).json({ error: 'Valid email required' });
  }

  // First call: prepare the browser for v4 card encryption without exposing
  // any Flutterwave API credentials.
  if (!body.card) {
    const ref = makeRef();
    await kvSet(`payment:${ref}`, {
      email: normalized,
      amount: AMOUNT,
      currency: CURRENCY,
      status: 'pending',
      createdAt: Date.now()
    });
    return res.status(200).json({ reference: ref, encryption_key: ENCRYPTION_KEY });
  }

  const card = body.card;
  const required = ['encrypted_card_number', 'encrypted_expiry_month', 'encrypted_expiry_year', 'encrypted_cvv', 'nonce'];
  if (required.some(k => !card[k])) return res.status(400).json({ error: 'Incomplete card details' });

  const ref = String(body.reference || '').trim();
  if (!/^[a-zA-Z0-9-]{6,42}$/.test(ref)) return res.status(400).json({ error: 'Invalid payment reference' });

  const { kvGet, kvSet: storeSet } = await import('./_lib/store.js');
  const saved = await kvGet(`payment:${ref}`);
  if (!saved || saved.email !== normalized || saved.status !== 'pending') {
    return res.status(400).json({ error: 'Payment session is invalid or expired' });
  }

  try {
    const token = await getAccessToken();
    if (!token) return res.status(502).json({ error: 'Could not authenticate with Flutterwave.' });

    const redirectUrl = process.env.FLW_REDIRECT_URL || `${req.headers.origin || `https://${req.headers.host}`}`;
    const r = await fetch(`${FLW_BASE_URL}/orchestration/direct-charges`, {
      method: 'POST',
      headers: v4Headers(token, ref),
      body: JSON.stringify({
        amount: AMOUNT,
        currency: CURRENCY,
        reference: ref,
        redirect_url: redirectUrl,
        customer: { email: normalized },
        payment_method: {
          type: 'card',
          card: {
            encrypted_card_number: card.encrypted_card_number,
            encrypted_expiry_month: card.encrypted_expiry_month,
            encrypted_expiry_year: card.encrypted_expiry_year,
            encrypted_cvv: card.encrypted_cvv,
            nonce: card.nonce
          }
        }
      })
    });

    const data = await r.json();
    if (!r.ok || data?.status !== 'success' || !data?.data?.id) {
      return res.status(502).json({ error: 'Could not start payment. Please check your card details and try again.' });
    }

    const charge = data.data;
    await storeSet(`payment:${ref}`, {
      ...saved,
      status: charge.status || 'pending',
      chargeId: charge.id
    });

    return res.status(200).json({
      reference: ref,
      charge_id: charge.id,
      status: charge.status,
      redirect_url: charge?.next_action?.redirect_url?.url || null
    });
  } catch {
    return res.status(502).json({ error: 'Could not reach the payment provider.' });
  }
}
