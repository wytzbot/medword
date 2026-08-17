// POST /api/flutterwave-webhook
// Flutterwave v4 charge.completed webhook. The event is authenticated using
// the configured webhook secret hash, then the charge is fetched directly
// from Flutterwave before Pro access is granted.

import crypto from 'node:crypto';
import { kvGet, kvSet, kvSetIfAbsent } from './_lib/store.js';

const CLIENT_ID = process.env.FLW_CLIENT_ID;
const CLIENT_SECRET = process.env.FLW_CLIENT_SECRET;
const WEBHOOK_HASH = process.env.FLW_WEBHOOK_SECRET_HASH;
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

async function verifyCharge(transactionId) {
  const token = await getAccessToken();
  if (!token) return null;
  try {
    const r = await fetch(`${FLW_BASE_URL}/charges/${encodeURIComponent(transactionId)}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Trace-Id': makeId() }
    });
    if (!r.ok) return null;
    const data = await r.json();
    return data?.status === 'success' ? data.data : null;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const signature = req.headers['flutterwave-signature'];
  const legacyHash = req.headers['verif-hash'];
  let validSignature = false;
  if (WEBHOOK_HASH && legacyHash && legacyHash === WEBHOOK_HASH) validSignature = true;
  if (WEBHOOK_HASH && signature) {
    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
    const expected = crypto.createHmac('sha256', WEBHOOK_HASH).update(rawBody).digest('base64');
    validSignature = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(signature)));
  }
  if (!validSignature) return res.status(401).json({ error: 'Invalid webhook signature' });
  if (!CLIENT_ID || !CLIENT_SECRET) return res.status(500).json({ error: 'Payments are not configured on the server yet.' });

  const event = req.body || {};
  const txId = event?.data?.id;
  if (event?.type !== 'charge.completed' && event?.event !== 'charge.completed') {
    return res.status(200).json({ received: true });
  }
  if (!txId) return res.status(200).json({ received: true });

  const txn = await verifyCharge(txId);
  if (!txn || txn.status !== 'succeeded' || txn.currency !== CURRENCY || Number(txn.amount) < AMOUNT) {
    return res.status(200).json({ received: true });
  }

  const email = String(txn.customer?.email ?? '').trim().toLowerCase();
  const ref = txn.reference;
  if (!email || !ref) return res.status(200).json({ received: true });

  const pending = await kvGet(`payment:${ref}`);
  if (!pending || pending.email !== email) return res.status(200).json({ received: true });

  const activationKey = `activated:${ref}`;
  const firstActivation = await kvSetIfAbsent(activationKey, { email, at: Date.now() });
  if (firstActivation) {
    await kvSet(`pro:${email}`, {
      pro: true,
      activatedAt: Date.now(),
      expiresAt: Date.now() + PRO_DURATION_MS,
      txRef: ref
    });
    await kvSet(`payment:${ref}`, { ...pending, status: 'completed', chargeId: txn.id });
  }

  return res.status(200).json({ received: true });
}
