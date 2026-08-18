// MedWord Pro - Flutterwave v4 card payments
//
// Flow:
//   1. Prepare payment session -> /api/create-payment
//   2. Encrypt card fields in the browser with the Flutterwave encryption key
//   3. Create v4 direct card charge -> /api/create-payment
//   4. Handle Flutterwave next_action (redirect / PIN / OTP)
//   5. Verify the completed charge -> /api/verify-payment
//
// Never put FLW_CLIENT_ID or FLW_CLIENT_SECRET in this file.

const EMAIL_KEY = 'medwordEmail';
const CACHE_KEY = 'medwordPro';
const PENDING_KEY = 'medwordPendingPayment';
const CACHE_TTL = 60 * 1000;

function readLS(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function writeLS(key, value) {
  try { localStorage.setItem(key, value); } catch {}
}

function removeLS(key) {
  try { localStorage.removeItem(key); } catch {}
}

function cachePro(value) {
  writeLS(CACHE_KEY, JSON.stringify({
    pro: !!value,
    at: Date.now()
  }));
}

function cached() {
  try {
    const x = JSON.parse(readLS(CACHE_KEY) || 'null');
    return !!(
      x?.pro &&
      Date.now() - Number(x.at) < CACHE_TTL
    );
  } catch {
    return false;
  }
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));
}

function randomNonce() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);

  let output = '';
  for (const byte of bytes) {
    output += chars[byte % chars.length];
  }

  return output;
}

function base64(bytes) {
  let output = '';
  const chunk = 0x8000;

  for (let i = 0; i < bytes.length; i += chunk) {
    output += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }

  return btoa(output);
}

async function encryptAES(value, base64Key, nonce) {
  if (!base64Key) {
    throw new Error('Flutterwave encryption key was not returned.');
  }

  if (!nonce || nonce.length !== 12) {
    throw new Error('Invalid encryption nonce.');
  }

  const rawKey = Uint8Array.from(
    atob(base64Key),
    character => character.charCodeAt(0)
  );

  const key = await crypto.subtle.importKey(
    'raw',
    rawKey,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );

  const encrypted = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: new TextEncoder().encode(nonce)
    },
    key,
    new TextEncoder().encode(String(value))
  );

  return base64(new Uint8Array(encrypted));
}


function showPaymentError(message) {
  const old = document.querySelector('#flw-v4-error-toast');
  if (old) old.remove();

  const toast = document.createElement('div');
  toast.id = 'flw-v4-error-toast';
  toast.textContent = message;
  toast.style.cssText = [
    'position:fixed',
    'left:50%',
    'bottom:24px',
    'transform:translateX(-50%)',
    'z-index:100000',
    'width:min(92vw,520px)',
    'box-sizing:border-box',
    'padding:14px 16px',
    'border-radius:12px',
    'background:#8f1d2c',
    'color:#fff',
    'font-weight:600',
    'box-shadow:0 12px 35px rgba(0,0,0,.28)',
    'text-align:center'
  ].join(';');

  document.body.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 7000);
}

function setModalMessage(text, type = 'error') {
  const el = document.querySelector('#flw-v4-message');
  if (!el) return;

  el.textContent = text || '';
  el.style.color = type === 'success' ? '#1b7f5a' : '#c62828';
}

function setModalBusy(busy, text = '') {
  const button = document.querySelector('#flw-v4-pay');
  const cancel = document.querySelector('#flw-v4-cancel');

  if (button) {
    button.disabled = !!busy;
    button.textContent = busy ? text || 'Processing…' : 'Pay NGN 1,000 / $1';
  }

  if (cancel) {
    cancel.disabled = !!busy;
  }
}

function createModalShell(title, subtitle) {
  const old = document.querySelector('#flw-v4-card-modal');
  if (old) old.remove();

  const wrap = document.createElement('div');
  wrap.id = 'flw-v4-card-modal';

  wrap.innerHTML = `
    <div style="position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.68);display:grid;place-items:center;padding:20px">
      <div style="width:min(430px,100%);max-height:90vh;overflow:auto;background:#fff;color:#111;border-radius:20px;padding:22px;box-shadow:0 20px 70px rgba(0,0,0,.35);box-sizing:border-box">
        <h2 style="margin:0 0 6px">${escapeHtml(title)}</h2>
        <p style="margin:0 0 18px;color:#666">${escapeHtml(subtitle)}</p>
        <div id="flw-v4-content"></div>
        <p id="flw-v4-message" style="min-height:22px;margin:12px 0 4px;font-size:14px"></p>
      </div>
    </div>
  `;

  document.body.appendChild(wrap);
  return wrap;
}

function cardModal() {
  const wrap = createModalShell(
    'Complete payment',
    'MedWord Pro — NGN 1,000 / $1'
  );

  const content = wrap.querySelector('#flw-v4-content');

  content.innerHTML = `
    <form id="flw-v4-card-form">
      <label style="display:block;margin:10px 0 5px;font-weight:600">Card number</label>
      <input required inputmode="numeric" autocomplete="cc-number" maxlength="19" name="number" placeholder="1234 5678 9012 3456" style="width:100%;padding:13px;border:1px solid #ccc;border-radius:10px;box-sizing:border-box">

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div>
          <label style="display:block;margin:10px 0 5px;font-weight:600">Expiry</label>
          <input required inputmode="numeric" autocomplete="cc-exp" maxlength="5" name="expiry" placeholder="MM/YY" style="width:100%;padding:13px;border:1px solid #ccc;border-radius:10px;box-sizing:border-box">
        </div>
        <div>
          <label style="display:block;margin:10px 0 5px;font-weight:600">CVV</label>
          <input required inputmode="numeric" autocomplete="cc-csc" maxlength="4" name="cvv" placeholder="123" style="width:100%;padding:13px;border:1px solid #ccc;border-radius:10px;box-sizing:border-box">
        </div>
      </div>

      <button id="flw-v4-pay" type="submit" style="width:100%;margin-top:12px;padding:14px;border:0;border-radius:10px;background:#111;color:#fff;font-weight:700;cursor:pointer">Pay NGN 1,000 / $1</button>
      <button id="flw-v4-cancel" type="button" style="width:100%;padding:11px;margin-top:5px;border:0;background:transparent;color:#666;cursor:pointer">Cancel</button>
    </form>
  `;

  return new Promise(resolve => {
    let settled = false;

    const finish = value => {
      if (settled) return;
      settled = true;
      wrap.remove();
      resolve(value);
    };

    wrap.querySelector('#flw-v4-cancel').onclick = () => finish(null);

    wrap.querySelector('#flw-v4-card-form').onsubmit = event => {
      event.preventDefault();

      const form = new FormData(event.currentTarget);
      const number = String(form.get('number') || '').replace(/\D/g, '');
      const expiry = String(form.get('expiry') || '').trim();
      const cvv = String(form.get('cvv') || '').replace(/\D/g, '');

      if (!/^\d{12,19}$/.test(number)) {
        setModalMessage('Enter a valid card number.');
        return;
      }

      const match = expiry.match(/^(0[1-9]|1[0-2])\s*\/\s*(\d{2}|\d{4})$/);

      if (!match) {
        setModalMessage('Enter the expiry as MM/YY.');
        return;
      }

      if (!/^\d{3,4}$/.test(cvv)) {
        setModalMessage('Enter a valid CVV.');
        return;
      }

      finish({
        number,
        expiry,
        cvv
      });
    };
  });
}

function authorizationModal(type) {
  const isPin = type === 'pin';

  const wrap = createModalShell(
    isPin ? 'Card authorization' : 'Enter OTP',
    isPin
      ? 'Your bank requires your card PIN to continue.'
      : 'Enter the one-time password sent by your bank.'
  );

  const content = wrap.querySelector('#flw-v4-content');

  content.innerHTML = `
    <form id="flw-v4-auth-form">
      <label style="display:block;margin:10px 0 5px;font-weight:600">
        ${isPin ? 'Card PIN' : 'OTP'}
      </label>
      <input
        required
        autofocus
        inputmode="numeric"
        autocomplete="one-time-code"
        maxlength="${isPin ? '6' : '8'}"
        name="code"
        type="password"
        placeholder="${isPin ? 'Enter PIN' : 'Enter OTP'}"
        style="width:100%;padding:13px;border:1px solid #ccc;border-radius:10px;box-sizing:border-box"
      >
      <button id="flw-v4-pay" type="submit" style="width:100%;margin-top:14px;padding:14px;border:0;border-radius:10px;background:#111;color:#fff;font-weight:700;cursor:pointer">
        ${isPin ? 'Continue' : 'Verify OTP'}
      </button>
      <button id="flw-v4-cancel" type="button" style="width:100%;padding:11px;margin-top:5px;border:0;background:transparent;color:#666;cursor:pointer">
        Cancel
      </button>
    </form>
  `;

  return new Promise(resolve => {
    let settled = false;

    const finish = value => {
      if (settled) return;
      settled = true;
      wrap.remove();
      resolve(value);
    };

    wrap.querySelector('#flw-v4-cancel').onclick = () => finish(null);

    wrap.querySelector('#flw-v4-auth-form').onsubmit = event => {
      event.preventDefault();

      const form = new FormData(event.currentTarget);
      const code = String(form.get('code') || '').trim();

      if (!/^\d{3,8}$/.test(code)) {
        setModalMessage(
          isPin ? 'Enter your card PIN.' : 'Enter the OTP sent by your bank.'
        );
        return;
      }

      finish(code);
    };
  });
}

function savePendingPayment(reference, chargeId, email) {
  writeLS(PENDING_KEY, JSON.stringify({
    reference,
    chargeId,
    email,
    createdAt: Date.now()
  }));
}

function clearPendingPayment() {
  removeLS(PENDING_KEY);
}

function pendingPayment() {
  try {
    return JSON.parse(readLS(PENDING_KEY) || 'null');
  } catch {
    return null;
  }
}

async function apiJson(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message =
      data?.error ||
      data?.message ||
      `Payment request failed (${response.status}).`;

    throw new Error(message);
  }

  return data;
}

function normalizeNextAction(action) {
  if (!action) return null;

  const type = String(action.type || '').toLowerCase();

  if (type === 'redirect_url' && action.redirect_url) {
    return {
      type: 'redirect_url',
      redirect_url: action.redirect_url
    };
  }

  if (type === 'requires_pin') {
    return { type: 'requires_pin' };
  }

  if (type === 'requires_otp') {
    return { type: 'requires_otp' };
  }

  if (type === 'requires_additional_fields') {
    return {
      type: 'requires_additional_fields',
      details: action.details || null
    };
  }

  if (type === 'payment_instruction') {
    return {
      type: 'payment_instruction',
      note: action.note || ''
    };
  }

  return null;
}

async function authorizeCharge({
  email,
  reference,
  chargeId,
  encryptionKey,
  type
}) {
  if (type === 'requires_pin') {
    const pin = await authorizationModal('pin');
    if (!pin) return null;

    const nonce = randomNonce();
    const encryptedPin = await encryptAES(
      pin,
      encryptionKey,
      nonce
    );

    return apiJson('/api/create-payment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        action: 'authorize',
        email,
        reference,
        charge_id: chargeId,
        authorization: {
          type: 'pin',
          pin: {
            nonce,
            encrypted_pin: encryptedPin
          }
        }
      })
    });
  }

  if (type === 'requires_otp') {
    const otp = await authorizationModal('otp');
    if (!otp) return null;

    return apiJson('/api/create-payment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        action: 'authorize',
        email,
        reference,
        charge_id: chargeId,
        authorization: {
          type: 'otp',
          otp: {
            code: otp
          }
        }
      })
    });
  }

  return null;
}

async function processNextAction({
  email,
  reference,
  chargeId,
  encryptionKey,
  nextAction
}) {
  let action = normalizeNextAction(nextAction);
  let currentChargeId = chargeId;

  // Give the user up to three authorization steps. This covers the common
  // PIN -> OTP and PIN -> 3DS flows without risking an endless loop.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (!action) {
      const verification = await verifyPaymentReturn(
        reference,
        currentChargeId,
        { poll: true }
      );

      if (verification?.pro) {
        clearPendingPayment();
        return verification;
      }

      return verification;
    }

    if (action.type === 'redirect_url') {
      savePendingPayment(
        reference,
        currentChargeId,
        email
      );

      window.location.assign(action.redirect_url);
      return {
        pro: false,
        redirecting: true
      };
    }

    if (
      action.type === 'requires_pin' ||
      action.type === 'requires_otp'
    ) {
      const response = await authorizeCharge({
        email,
        reference,
        chargeId: currentChargeId,
        encryptionKey,
        type: action.type
      });

      if (!response) {
        return { pro: false, cancelled: true };
      }

      currentChargeId = response.charge_id || currentChargeId;
      action = normalizeNextAction(response.next_action);
      continue;
    }

    if (action.type === 'payment_instruction') {
      const message = action.note ||
        'Follow the payment instructions to complete the transaction.';

      setModalMessage(message, 'success');

      return {
        pro: false,
        pending: true,
        instruction: message
      };
    }

    if (action.type === 'requires_additional_fields') {
      return {
        pro: false,
        pending: true,
        error: 'Flutterwave requires additional billing information for this card.'
      };
    }

    return {
      pro: false,
      pending: true
    };
  }

  return {
    pro: false,
    pending: true,
    error: 'Payment authorization requires another step. Please try again.'
  };
}

export function peekCachedPro() {
  return cached();
}

export async function checkPro({ force = false } = {}) {
  if (!force && cached()) return true;

  const email = readLS(EMAIL_KEY);
  if (!email) return false;

  try {
    const data = await apiJson('/api/check-pro', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: normalizeEmail(email)
      })
    });

    cachePro(!!data?.pro);
    return !!data?.pro;
  } catch {
    return false;
  }
}

export async function startPro(email) {
  const normalized = normalizeEmail(email);

  if (!validEmail(normalized)) {
    return false;
  }

  let card = null;

  try {
    // Step 1: prepare the server-side payment session.
    const setup = await apiJson('/api/create-payment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: normalized
      })
    });

    if (!setup?.reference || !setup?.encryption_key) {
      throw new Error(
        'Flutterwave did not return a payment reference and encryption key.'
      );
    }

    // Step 2: collect card details.
    card = await cardModal();
    if (!card) return false;

    const match = card.expiry.match(
      /^(0[1-9]|1[0-2])\s*\/\s*(\d{2}|\d{4})$/
    );

    if (!match) {
      throw new Error('Enter the expiry as MM/YY.');
    }

    const month = match[1];
    const year = match[2].length === 2
      ? `20${match[2]}`
      : match[2];

    // Step 3: encrypt each sensitive card field with the same 12-char nonce.
    const nonce = randomNonce();

    const encrypted = {
      encrypted_card_number: await encryptAES(
        card.number,
        setup.encryption_key,
        nonce
      ),
      encrypted_expiry_month: await encryptAES(
        month,
        setup.encryption_key,
        nonce
      ),
      encrypted_expiry_year: await encryptAES(
        year,
        setup.encryption_key,
        nonce
      ),
      encrypted_cvv: await encryptAES(
        card.cvv,
        setup.encryption_key,
        nonce
      ),
      nonce
    };

    // Keep the email locally before any redirect/authorization step.
    writeLS(EMAIL_KEY, normalized);

    // Step 4: create the v4 direct card charge.
    const charge = await apiJson('/api/create-payment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: normalized,
        reference: setup.reference,
        card: encrypted
      })
    });

    if (!charge?.charge_id) {
      throw new Error('Flutterwave did not return a charge ID.');
    }

    savePendingPayment(
      charge.reference || setup.reference,
      charge.charge_id,
      normalized
    );

    // Step 5: process whatever Flutterwave says is required next.
    const result = await processNextAction({
      email: normalized,
      reference: charge.reference || setup.reference,
      chargeId: charge.charge_id,
      encryptionKey: setup.encryption_key,
      nextAction: charge.next_action
    });

    if (result?.pro) {
      cachePro(true);
      clearPendingPayment();
      return true;
    }

    if (result?.redirecting || result?.pending) {
      return true;
    }

    if (result?.cancelled) {
      clearPendingPayment();
      return false;
    }

    return false;
  } catch (error) {
    console.error('Flutterwave v4 payment error:', error);

    // Show the real server/provider error instead of silently returning false.
    const message = error?.message || 'Payment could not be completed.';

    const existing = document.querySelector('#flw-v4-card-modal');

    if (existing) {
      setModalBusy(false);
      setModalMessage(message);
    }

    showPaymentError(message);
    return false;
  }
}

export async function verifyPaymentReturn(
  reference = null,
  chargeId = null,
  options = {}
) {
  const email = normalizeEmail(readLS(EMAIL_KEY));
  if (!email) return { pro: false };

  const params = new URLSearchParams(location.search);
  const pending = pendingPayment();

  const txRef =
    reference ||
    params.get('tx_ref') ||
    pending?.reference ||
    null;

  const transactionId =
    chargeId ||
    params.get('transaction_id') ||
    pending?.chargeId ||
    null;

  if (!txRef && !transactionId) {
    return { pro: false };
  }

  const poll = options.poll !== false;
  const attempts = poll ? 5 : 1;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const data = await apiJson('/api/verify-payment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email,
          tx_ref: txRef,
          transaction_id: transactionId
        })
      });

      if (data?.pro) {
        cachePro(true);
        clearPendingPayment();
        return data;
      }

      if (attempt < attempts - 1) {
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    } catch (error) {
      console.error('Flutterwave verification error:', error);

      if (attempt === attempts - 1) {
        return {
          pro: false,
          error: error?.message || 'Payment verification failed.'
        };
      }
    }
  }

  return {
    pro: false,
    error: 'Payment is still being processed.'
  };
}
