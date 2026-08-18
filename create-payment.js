// POST /api/create-payment
//
// Actions:
// 1) Prepare: { email }
// 2) Create card charge: { email, reference, card }
// 3) Authorize charge: { email, reference, charge_id, authorization }
//
// Flutterwave v4 direct card flow. Secrets stay server-side; only the
// encryption key is returned to the browser because Flutterwave requires
// card fields to be encrypted before they are sent to the API.

import { kvGet, kvSet } from './_lib/store.js';

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

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function v4Headers(token, idempotencyKey) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Trace-Id': makeId(),
    'X-Idempotency-Key': idempotencyKey
  };
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
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    }
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data?.access_token) {
    console.error('Flutterwave token error:', {
      status: response.status,
      error: data?.error,
      description: data?.error_description
    });
    return null;
  }

  return data.access_token;
}

function getNextAction(charge) {
  const next = charge?.next_action || {};
  const redirect = next?.redirect_url?.url || next?.redirect?.url || null;

  if (redirect) {
    return {
      type: 'redirect_url',
      redirect_url: redirect
    };
  }

  const type = String(next?.type || '').toLowerCase();

  if (type === 'requires_pin' || next?.requires_pin) {
    return { type: 'requires_pin' };
  }

  if (type === 'requires_otp' || next?.requires_otp) {
    return { type: 'requires_otp' };
  }

  if (type === 'requires_additional_fields' || next?.requires_additional_fields) {
    return {
      type: 'requires_additional_fields',
      details: next?.requires_additional_fields || null
    };
  }

  if (type === 'payment_instructions' || next?.payment_instruction) {
    return {
      type: 'payment_instruction',
      note: next?.payment_instruction?.note || ''
    };
  }

  return null;
}

async function preparePayment(email) {
  const reference = makeRef();

  await kvSet(`payment:${reference}`, {
    email,
    amount: AMOUNT,
    currency: CURRENCY,
    status: 'pending',
    createdAt: Date.now()
  });

  return {
    reference,
    encryption_key: ENCRYPTION_KEY,
    amount: AMOUNT,
    currency: CURRENCY
  };
}

async function createCardCharge({ email, reference, card }) {
  const required = [
    'encrypted_card_number',
    'encrypted_expiry_month',
    'encrypted_expiry_year',
    'encrypted_cvv',
    'nonce'
  ];

  if (required.some(key => !card?.[key])) {
    return {
      ok: false,
      status: 400,
      error: 'Incomplete encrypted card details.'
    };
  }

  if (String(card.nonce).length !== 12) {
    return {
      ok: false,
      status: 400,
      error: 'Invalid card encryption nonce.'
    };
  }

  const saved = await kvGet(`payment:${reference}`);

  if (!saved || saved.email !== email || saved.status === 'completed') {
    return {
      ok: false,
      status: 400,
      error: 'Payment session is invalid or expired.'
    };
  }

  const token = await getAccessToken();

  if (!token) {
    return {
      ok: false,
      status: 502,
      error: 'Could not authenticate with Flutterwave. Check your v4 Client ID and Client Secret.'
    };
  }

  const redirectUrl = process.env.FLW_REDIRECT_URL || '';

  const payload = {
    amount: AMOUNT,
    currency: CURRENCY,
    reference,
    customer: { email },
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
  };

  if (redirectUrl) payload.redirect_url = redirectUrl;

  const response = await fetch(
    `${FLW_BASE_URL.replace(/\/$/, '')}/orchestration/direct-charges`,
    {
      method: 'POST',
      headers: v4Headers(token, reference),
      body: JSON.stringify(payload)
    }
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data?.data?.id) {
    console.error('Flutterwave charge error:', {
      httpStatus: response.status,
      status: data?.status,
      message: data?.message,
      error: data?.error,
      code: data?.code,
      validation_errors: data?.error?.validation_errors
    });

    return {
      ok: false,
      status: response.status >= 400 && response.status < 600 ? 502 : 500,
      error:
        data?.error?.message ||
        data?.message ||
        'Flutterwave could not start the payment. Please check the card details and try again.'
    };
  }

  const charge = data.data;
  const nextAction = getNextAction(charge);

  await kvSet(`payment:${reference}`, {
    ...saved,
    status: charge.status || 'pending',
    chargeId: charge.id,
    nextAction,
    updatedAt: Date.now()
  });

  return {
    ok: true,
    reference,
    charge_id: charge.id,
    status: charge.status || 'pending',
    next_action: nextAction,
    message: data?.message || 'Charge created'
  };
}

async function authorizeCharge({ email, reference, chargeId, authorization }) {
  const saved = await kvGet(`payment:${reference}`);

  if (
    !saved ||
    saved.email !== email ||
    saved.chargeId !== chargeId ||
    saved.status === 'completed'
  ) {
    return {
      ok: false,
      status: 400,
      error: 'Payment authorization session is invalid or expired.'
    };
  }

  if (!authorization?.type) {
    return {
      ok: false,
      status: 400,
      error: 'Authorization details are required.'
    };
  }

  const token = await getAccessToken();

  if (!token) {
    return {
      ok: false,
      status: 502,
      error: 'Could not authenticate with Flutterwave.'
    };
  }

  const response = await fetch(
    `${FLW_BASE_URL.replace(/\/$/, '')}/charges/${encodeURIComponent(chargeId)}`,
    {
      method: 'PUT',
      headers: v4Headers(
        token,
        `${reference}-auth-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      ),
      body: JSON.stringify({ authorization })
    }
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data?.data?.id) {
    console.error('Flutterwave authorization error:', {
      httpStatus: response.status,
      status: data?.status,
      message: data?.message,
      error: data?.error,
      code: data?.code
    });

    return {
      ok: false,
      status: 502,
      error:
        data?.error?.message ||
        data?.message ||
        'Flutterwave could not authorize this payment.'
    };
  }

  const charge = data.data;
  const nextAction = getNextAction(charge);

  await kvSet(`payment:${reference}`, {
    ...saved,
    status: charge.status || 'pending',
    chargeId: charge.id,
    nextAction,
    updatedAt: Date.now()
  });

  return {
    ok: true,
    reference,
    charge_id: charge.id,
    status: charge.status || 'pending',
    next_action: nextAction,
    message: data?.message || 'Payment authorization updated'
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!CLIENT_ID || !CLIENT_SECRET || !ENCRYPTION_KEY) {
    return res.status(500).json({
      error: 'Payments are not configured on the server yet.'
    });
  }

  const body = req.body || {};
  const email = String(body.email ?? '').trim().toLowerCase();

  if (!validEmail(email)) {
    return res.status(400).json({ error: 'Valid email required.' });
  }

  try {
    // Prepare the payment and return the Flutterwave encryption key.
    if (!body.card && body.action !== 'authorize') {
      const prepared = await preparePayment(email);
      return res.status(200).json(prepared);
    }

    // Authorize an existing charge (PIN/OTP/etc.).
    if (body.action === 'authorize') {
      const reference = String(body.reference || '').trim();
      const chargeId = String(body.charge_id || '').trim();

      if (!/^[a-zA-Z0-9-]{6,42}$/.test(reference)) {
        return res.status(400).json({ error: 'Invalid payment reference.' });
      }

      if (!chargeId) {
        return res.status(400).json({ error: 'Charge ID is required.' });
      }

      const result = await authorizeCharge({
        email,
        reference,
        chargeId,
        authorization: body.authorization
      });

      return res.status(result.ok ? 200 : result.status).json(result.ok ? result : { error: result.error });
    }

    const reference = String(body.reference || '').trim();

    if (!/^[a-zA-Z0-9-]{6,42}$/.test(reference)) {
      return res.status(400).json({ error: 'Invalid payment reference.' });
    }

    const result = await createCardCharge({
      email,
      reference,
      card: body.card
    });

    return res.status(result.ok ? 200 : result.status).json(
      result.ok
        ? result
        : { error: result.error }
    );
  } catch (error) {
    console.error('create-payment unexpected error:', error);
    return res.status(500).json({
      error: 'An unexpected payment error occurred. Please try again.'
    });
  }
}
