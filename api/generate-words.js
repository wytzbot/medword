// POST /api/generate-words
// body: { category: string, level: number, count?: number }
// returns: { words: [{ word, definition, category }], source: 'ai'|'bank' }
//
// Tries Groq (server-side, key never exposed to the frontend) first for
// variety; always has a curated local word bank as a reliable fallback so
// the game never breaks if the AI call fails, times out, or GROQ_API_KEY
// isn't configured yet.

import { CATEGORY_WORDS, CATEGORY_NAMES } from './_lib/words-bank.js';

const GROQ_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-20b';

function cleanTerms(items) {
  const seen = new Set();
  const out = [];
  for (const x of Array.isArray(items) ? items : []) {
    const word = String(x?.word ?? '').toUpperCase().replace(/[^A-Z]/g, '');
    if (word.length < 3 || word.length > 16 || seen.has(word)) continue;
    seen.add(word);
    const definition = String(x?.definition ?? '').trim().slice(0, 220);
    out.push({ word, definition: definition || 'Medical learning term.' });
  }
  return out;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function fromBank(category, level, count) {
  const list = CATEGORY_WORDS[category] || [];
  const sorted = [...list].sort((a, b) => a.word.length - b.word.length);
  // Early levels draw mostly from the shorter/simpler end of the list.
  const tierEnd =
    level < 10 ? Math.ceil(sorted.length * 0.55) : level < 25 ? Math.ceil(sorted.length * 0.8) : sorted.length;
  const pool = sorted.slice(0, Math.max(8, tierEnd));
  return shuffle(pool)
    .slice(0, count)
    .map((w) => ({ ...w, category }));
}

async function fromGroq(category, level, count) {
  if (!GROQ_KEY) return null;
  const requested = Math.max(10, Math.min(60, Number(count) || 40));
  const difficulty = level < 10 ? 'common, foundational' : level < 25 ? 'intermediate' : 'advanced, specialised';
  const prompt = `Generate ${requested} ${difficulty} single-word medical terms for the field "${category}" for a word-search puzzle at difficulty level ${level}. Use real English medical terminology appropriate to the field. Every word must contain letters A-Z only, be 3-14 characters long, contain no spaces, hyphens, punctuation, abbreviations, or duplicates. Give each word a short, accurate student-friendly definition under 18 words.`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROQ_KEY}` },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0.4,
        max_tokens: 4096,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'medical_word_list',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                words: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      word: { type: 'string' },
                      definition: { type: 'string' }
                    },
                    required: ['word', 'definition'],
                    additionalProperties: false
                  }
                }
              },
              required: ['words'],
              additionalProperties: false
            }
          }
        },
        messages: [
          { role: 'system', content: 'You are a medical education word-list generator. Return only the requested structured data. Never invent medical terms.' },
          { role: 'user', content: prompt }
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
    const cleaned = cleanTerms(parsed?.words).map((w) => ({ ...w, category }));
    return cleaned.length >= 6 ? cleaned : null;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { category, level, count } = req.body || {};
  if (!CATEGORY_NAMES.includes(category)) return res.status(400).json({ error: 'Unknown category' });

  const lvl = Math.max(1, Math.min(500, Number(level) || 1));
  const cnt = Math.max(10, Math.min(80, Number(count) || 40));

  const aiWords = await fromGroq(category, lvl, cnt);
  const words = aiWords && aiWords.length >= 6 ? aiWords : fromBank(category, lvl, cnt);

  return res.status(200).json({ words, source: aiWords ? 'ai' : 'bank' });
}
