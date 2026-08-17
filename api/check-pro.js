// POST /api/check-pro
// body: { email: string }
// returns: { pro: boolean }
//
// Looks up the entitlement written by /api/verify-payment or
// /api/flutterwave-webhook after a real, verified payment. Pro access is
// time-limited (see PRO_DURATION_MS in verify-payment.js / flutterwave-webhook.js)
// so this also checks the stored expiry.

import { kvGet } from './_lib/store.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email } = req.body || {};
  const normalized = String(email ?? '').trim().toLowerCase();
  if (!normalized || !normalized.includes('@')) return res.status(400).json({ error: 'Valid email required' });

  const entitlement = await kvGet(`pro:${normalized}`);
  const active = Boolean(entitlement?.pro && (!entitlement.expiresAt || entitlement.expiresAt > Date.now()));
  return res.status(200).json({ pro: active });
}
