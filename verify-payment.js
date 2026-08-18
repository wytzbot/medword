// POST /api/verify-payment
// body: { email: string, tx_ref?: string, transaction_id?: string }
//
// Server-side Flutterwave v4 verification. Pro is granted only after the
// charge itself is confirmed as succeeded and the amount/currency/reference
// match the payment session stored for the customer.

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
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: 'client_credentials'
  });

  const response = await fetch(
    'https://idp.flutterwave.com/realms/flutterwave/protocol/openid-connect/token',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body
    }
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data?.access_token) {
    console.error('Flutterwave verification token error:', {
      status: response.status,
      error: data?.error,
      description: data?.error_description
    });
    return null;
  }

  return data.access_token;
}

async function fetchCharge(id) {
  const token = await getAccessToken();
  if (!token) return null;

  try {
    const response = await fetch(
      `${FLW_BASE_URL.replace(/\/$/, '')}/charges/${encodeURIComponent(id)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Trace-Id': makeId()
        }
      }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data?.data) {
      console.error('Flutterwave charge lookup error:', {
        httpStatus: response.status,
        status: data?.status,
        message: data?.message,
        error: data?.error
      });
      return null;
    }

    return data.data;
  } catch (error) {
    console.error('Flutterwave charge lookup network error:', error);
    return null;
  }
}

async function resolveChargeId({ transaction_id, tx_ref }) {
  // Prefer our own stored charge ID when tx_ref is available. This avoids
  // treating a redirect transaction_id as a charge ID when Flutterwave has
  // returned a different identifier.
  if (tx_ref) {
    const pending = await kvGet(`payment:${tx_ref}`);
    if (pending?.chargeId) return pending.chargeId;
  }

  return transaction_id || null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!CLIENT_ID || !CLIENT_SECRET) {
    return res.status(500).json({
      error: 'Payments are not configured on the server yet.'
    });
  }

  const body = req.body || {};
  const normalized = String(body.email ?? '').trim().toLowerCase();
  const txRef = String(body.tx_ref ?? '').trim();
  const transactionId = String(body.transaction_id ?? '').trim();

  if (!normalized || (!txRef && !transactionId)) {
    return res.status(400).json({
      error: 'Email and transaction reference required.'
    });
  }

  try {
    const chargeId = await resolveChargeId({
      transaction_id: transactionId,
      tx_ref: txRef
    });

    if (!chargeId) {
      return res.status(200).json({
        pro: false,
        error: 'Payment not confirmed yet.'
      });
    }

    const txn = await fetchCharge(chargeId);

    if (!txn) {
      return res.status(200).json({
        pro: false,
        error: 'Could not retrieve the payment status yet.'
      });
    }

    const status = String(txn.status || '').toLowerCase();

    if (status !== 'succeeded') {
      if (['failed', 'cancelled', 'reversed'].includes(status)) {
        return res.status(200).json({
          pro: false,
          error: `Payment ${status}.`
        });
      }

      return res.status(200).json({
        pro: false,
        pending: true,
        error: 'Payment not confirmed yet.'
      });
    }

    // Never grant Pro unless the amount and currency match the product.
    if (
      String(txn.currency || '').toUpperCase() !== CURRENCY ||
      Number(txn.amount) < AMOUNT
    ) {
      console.error('Flutterwave payment amount mismatch:', {
        chargeId,
        amount: txn.amount,
        currency: txn.currency
      });

      return res.status(200).json({
        pro: false,
        error: 'Payment amount mismatch.'
      });
    }

    const ref = String(txn.reference || txRef || '').trim();

    if (!ref) {
      return res.status(200).json({
        pro: false,
        error: 'Payment reference missing.'
      });
    }

    const pending = await kvGet(`payment:${ref}`);

    if (!pending || pending.email !== normalized) {
      return res.status(200).json({
        pro: false,
        error: 'Transaction does not match this account.'
      });
    }

    // Idempotency guard: a webhook/redirect/manual verification can all hit
    // this endpoint without granting a second subscription period.
    const activationKey = `activated:${ref}`;
    const firstActivation = await kvSetIfAbsent(
      activationKey,
      {
        email: normalized,
        at: Date.now()
      }
    );

    const existing = await kvGet(`pro:${normalized}`);

    if (firstActivation || !existing?.pro) {
      const now = Date.now();

      await kvSet(`pro:${normalized}`, {
        pro: true,
        activatedAt: now,
        expiresAt: now + PRO_DURATION_MS,
        txRef: ref,
        chargeId: txn.id
      });

      await kvSet(`payment:${ref}`, {
        ...pending,
        status: 'completed',
        chargeId: txn.id,
        completedAt: now
      });
    }

    return res.status(200).json({
      pro: true,
      reference: ref,
      charge_id: txn.id
    });
  } catch (error) {
    console.error('verify-payment unexpected error:', error);

    return res.status(500).json({
      error: 'Payment verification failed. Please try again.'
    });
  }
}
