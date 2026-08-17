const EMAIL_KEY = 'medwordEmail';
const CACHE_KEY = 'medwordPro';
const CACHE_TTL = 60 * 1000;

function readLS(key) { try { return localStorage.getItem(key); } catch { return null; } }
function writeLS(key, value) { try { localStorage.setItem(key, value); } catch {} }
function removeLS(key) { try { localStorage.removeItem(key); } catch {} }

function cachePro(value) {
  writeLS(CACHE_KEY, JSON.stringify({ pro: !!value, at: Date.now() }));
}

function cached() {
  try {
    const x = JSON.parse(readLS(CACHE_KEY) || 'null');
    return !!(x?.pro && Date.now() - Number(x.at) < CACHE_TTL);
  } catch { return false; }
}

function escapeHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

function randomNonce() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  for (const b of bytes) out += chars[b % chars.length];
  return out;
}

function base64(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

async function encryptAES(value, base64Key, nonce) {
  const keyBytes = Uint8Array.from(atob(base64Key), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt']);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: new TextEncoder().encode(nonce) },
    key,
    new TextEncoder().encode(String(value))
  );
  return base64(new Uint8Array(encrypted));
}

function cardModal() {
  const old = document.querySelector('#flw-v4-card-modal');
  if (old) old.remove();
  const wrap = document.createElement('div');
  wrap.id = 'flw-v4-card-modal';
  wrap.innerHTML = `<div style="position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.65);display:grid;place-items:center;padding:20px"><form id="flw-v4-card-form" style="width:min(420px,100%);background:#fff;color:#111;border-radius:18px;padding:22px;box-shadow:0 20px 60px rgba(0,0,0,.3)"><h2 style="margin:0 0 6px">Complete payment</h2><p style="margin:0 0 18px;color:#666">MedWord Pro — NGN 1,000</p><label style="display:block;margin:10px 0 5px">Card number</label><input required inputmode="numeric" autocomplete="cc-number" maxlength="19" name="number" placeholder="1234 5678 9012 3456" style="width:100%;padding:12px;border:1px solid #ccc;border-radius:10px;box-sizing:border-box"><div style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><div><label style="display:block;margin:10px 0 5px">Expiry</label><input required inputmode="numeric" autocomplete="cc-exp" maxlength="5" name="expiry" placeholder="MM/YY" style="width:100%;padding:12px;border:1px solid #ccc;border-radius:10px;box-sizing:border-box"></div><div><label style="display:block;margin:10px 0 5px">CVV</label><input required inputmode="numeric" autocomplete="cc-csc" maxlength="4" name="cvv" placeholder="123" style="width:100%;padding:12px;border:1px solid #ccc;border-radius:10px;box-sizing:border-box"></div></div><p id="flw-v4-error" style="color:#c62828;min-height:20px;margin:10px 0"></p><button id="flw-v4-pay" type="submit" style="width:100%;padding:13px;border:0;border-radius:10px;background:#111;color:#fff;font-weight:700">Pay NGN 1,000</button><button id="flw-v4-cancel" type="button" style="width:100%;padding:11px;border:0;background:transparent;color:#666">Cancel</button></form></div>`;
  document.body.appendChild(wrap);
  return new Promise(resolve => {
    wrap.querySelector('#flw-v4-cancel').onclick = () => { wrap.remove(); resolve(null); };
    wrap.querySelector('#flw-v4-card-form').onsubmit = e => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      resolve({ number: String(f.get('number') || '').replace(/\s+/g, ''), expiry: String(f.get('expiry') || ''), cvv: String(f.get('cvv') || '') });
    };
  });
}

export function peekCachedPro() { return cached(); }

export async function checkPro({ force = false } = {}) {
  if (!force && cached()) return true;
  const email = readLS(EMAIL_KEY);
  if (!email) return false;
  try {
    const r = await fetch('/api/check-pro', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
    if (!r.ok) return false;
    const data = await r.json();
    cachePro(!!data?.pro);
    return !!data?.pro;
  } catch { return false; }
}

export async function startPro(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return false;

  try {
    const prep = await fetch('/api/create-payment', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: normalized })
    });
    const setup = await prep.json();
    if (!prep.ok || !setup?.reference || !setup?.encryption_key) return false;

    const card = await cardModal();
    if (!card) return false;

    const number = card.number.replace(/\D/g, '');
    const cvv = card.cvv.replace(/\D/g, '');
    const match = card.expiry.match(/^(\d{2})\s*\/\s*(\d{2}|\d{4})$/);
    if (!/^\d{12,19}$/.test(number) || !/^\d{3,4}$/.test(cvv) || !match) return false;

    const month = match[1];
    const year = match[2].length === 2 ? `20${match[2]}` : match[2];
    const nonce = randomNonce();
    const encrypted = {
      encrypted_card_number: await encryptAES(number, setup.encryption_key, nonce),
      encrypted_expiry_month: await encryptAES(month, setup.encryption_key, nonce),
      encrypted_expiry_year: await encryptAES(year, setup.encryption_key, nonce),
      encrypted_cvv: await encryptAES(cvv, setup.encryption_key, nonce),
      nonce
    };

    const r = await fetch('/api/create-payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: normalized, reference: setup.reference, card: encrypted })
    });
    const data = await r.json();
    if (!r.ok || !data?.charge_id) return false;

    writeLS(EMAIL_KEY, normalized);
    if (data.redirect_url) {
      location.href = data.redirect_url;
      return true;
    }

    const verified = await verifyPaymentReturn(data.reference, data.charge_id);
    if (verified?.pro) { cachePro(true); return true; }
    return false;
  } catch (e) {
    console.error('Flutterwave v4 payment error:', e);
    return false;
  }
}

export async function verifyPaymentReturn(reference, chargeId) {
  const email = readLS(EMAIL_KEY);
  if (!email) return { pro: false };
  const params = new URLSearchParams(location.search);
  const txRef = reference || params.get('tx_ref');
  const transactionId = chargeId || params.get('transaction_id');
  if (!txRef && !transactionId) return { pro: false };

  try {
    const r = await fetch('/api/verify-payment', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, tx_ref: txRef, transaction_id: transactionId })
    });
    const data = await r.json();
    if (data?.pro) cachePro(true);
    return data;
  } catch { return { pro: false }; }
}
