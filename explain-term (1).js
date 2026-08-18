// POST /api/explain-term
// body: { word: string, email?: string }
// returns: { word, explanation } on success, 403 if the account isn't Pro.
//
// Pro status is re-checked server-side against the entitlement store (never
// trusts the client's local `pro` flag), so this can't be bypassed from the
// browser. Looks the term up in the curated bank first (instant, free);
// only calls Groq for terms the bank doesn't cover.

import { CATEGORY_WORDS } from './_lib/words-bank.js';
import { kvGet } from './_lib/store.js';

const GROQ_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-20b';

function findInBank(word) {
  for (const list of Object.values(CATEGORY_WORDS)) {
    const hit = list.find((w) => w.word === word);
    if (hit) return hit.definition;
  }
  return null;
}

async function explainWithGroq(word) {
  if (!GROQ_KEY) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROQ_KEY}` },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0.2,
        max_tokens: 220,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'medical_term_explanation',
            strict: true,
            schema: {
              type: 'object',
              properties: { explanation: { type: 'string' } },
              required: ['explanation'],
              additionalProperties: false
            }
          }
        },
        messages: [
          { role: 'system', content: 'You are a concise medical educator. Explain terms accurately for students in plain language. Do not diagnose, prescribe, or give medical advice.' },
          { role: 'user', content: `Explain the medical term "${word}" for a student in under 60 words.` }
        ]
      }),
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!r.ok) return null;
    const data = await r.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) return null;
    const parsed = typeof content === 'string' ? JSON.parse(content) : content;
    return String(parsed?.explanation || '').trim() || null;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { word, email } = req.body || {};
  const safe = String(word ?? '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 40);
  if (!safe) return res.status(400).json({ error: 'Invalid word' });

  const normalizedEmail = String(email ?? '').trim().toLowerCase();
  const entitlement = normalizedEmail ? await kvGet(`pro:${normalizedEmail}`) : null;
  const isPro = Boolean(entitlement?.pro && (!entitlement.expiresAt || entitlement.expiresAt > Date.now()));
  if (!isPro) return res.status(403).json({ error: 'Pro subscription required for explanations' });

  const explanation = findInBank(safe) || (await explainWithGroq(safe)) || 'No explanation is available for this term yet.';
  return res.status(200).json({ word: safe, explanation });
}
