// POST /api/verify-payment
// body: { email: string, tx_ref?: string, transaction_id?: string }
// Server-side verification for Flutterwave v4 charges.

import { kvGet, kvSet, kvSetIfAbsent } from './_lib/store.js';

const CLIENT_ID = process.env.FLW_CLIENT_ID;
const CLIENT_SECRET = process.env.FLW_CLIENT_SECRET;
const FLW_BASE_URL = process.env.FLW_BASE_URL || 'https://f4bexperience.flutterwave.com';
const AMOUNT = 1000;
const CURRENCY = 'NGN';
const PRO_DURATION_MS = 31 * 24 * 60 * 60 * 1000;

function makeId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 14)}`;
}

async function getAccessToken() {
  const body = new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: 'client_credentials' });
  const r = await fetch('https://idp.flutterwave.com/realms/flutterwave/protocol/openid-connect/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body
  });
  if (!r.ok) return null;
  const data = await r.json();
  return data?.access_token || null;
}

async function fetchCharge(id) {
  const token = await getAccessToken();
  if (!token) return null;
  try {
    const r = await fetch(`${FLW_BASE_URL}/charges/${encodeURIComponent(id)}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Trace-Id': makeId()
      }
    });
    if (!r.ok) return null;
    const data = await r.json();
    return data?.status === 'success' ? data.data : null;
  } catch {
    return null;
  }
}

async function resolveChargeId({ transaction_id, tx_ref }) {
  if (transaction_id) return transaction_id;
  if (!tx_ref) return null;
  const pending = await kvGet(`payment:${tx_ref}`);
  return pending?.chargeId || null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!CLIENT_ID || !CLIENT_SECRET) return res.status(500).json({ error: 'Payments are not configured on the server yet.' });

  const { email, tx_ref, transaction_id } = req.body || {};
  const normalized = String(email ?? '').trim().toLowerCase();
  if (!normalized || (!tx_ref && !transaction_id)) {
    return res.status(400).json({ error: 'Email and transaction reference required' });
  }

  const chargeId = await resolveChargeId({ transaction_id, tx_ref });
  if (!chargeId) return res.status(200).json({ pro: false, error: 'Payment not confirmed yet' });

  const txn = await fetchCharge(chargeId);
  if (!txn || txn.status !== 'succeeded') return res.status(200).json({ pro: false, error: 'Payment not confirmed yet' });
  if (txn.currency !== CURRENCY || Number(txn.amount) < AMOUNT) return res.status(200).json({ pro: false, error: 'Payment amount mismatch' });

  const ref = txn.reference || tx_ref;
  const pending = await kvGet(`payment:${ref}`);
  if (!pending || pending.email !== normalized) return res.status(200).json({ pro: false, error: 'Transaction does not match this account' });

  const activationKey = `activated:${ref}`;
  const firstActivation = await kvSetIfAbsent(activationKey, { email: normalized, at: Date.now() });
  const existing = await kvGet(`pro:${normalized}`);

  if (firstActivation || !existing?.pro) {
    await kvSet(`pro:${normalized}`, {
      pro: true,
      activatedAt: Date.now(),
      expiresAt: Date.now() + PRO_DURATION_MS,
      txRef: ref
    });
    await kvSet(`payment:${ref}`, { ...pending, status: 'completed', chargeId: txn.id });
  }

  return res.status(200).json({ pro: true });
}
