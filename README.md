# MedWord backend contract

All `/api/*` routes run server-side. Never put Groq secrets, Flutterwave Client Secret, or encryption keys in frontend code.

## Endpoints
- `POST /api/generate-words` — validate category/level/count; call Groq server-side; return `{ "words": [{ "word": "...", "definition": "...", "category": "..." }] }`.
- `POST /api/explain-term` — require active Pro server-side; validate/sanitize `word`; call Groq; return `{ "word": "...", "explanation": "..." }`.
- `POST /api/create-payment` — validate email; server-side set amount `1000`, currency `NGN`, plan/monthly and unique `tx_ref`; create Flutterwave hosted checkout with a configured redirect URL.
- `POST /api/verify-payment` — accept `tx_ref` and/or `transaction_id`; re-query Flutterwave server-side; require successful status, exact amount/currency and matching transaction reference; activate subscription only after verification.
- `POST /api/flutterwave-webhook` — validate webhook authenticity according to current Flutterwave docs, re-query the transaction, then idempotently update subscription state.
- `POST /api/check-pro` — validate email and return `{ "pro": true|false }` based on server-side subscription state.

## Payment return
The frontend expects Flutterwave to redirect to the app with `tx_ref`, `transaction_id` and `status` query parameters. The frontend calls `/api/verify-payment`; the backend must NOT trust the browser's `status` and must verify the transaction directly with Flutterwave.

## Environment variables
Store secrets in Vercel Environment Variables or your server platform's secret manager. Typical values:
`GROQ_API_KEY`, `FLW_CLIENT_ID`, `FLW_CLIENT_SECRET`, `FLW_ENCRYPTION_KEY`, plus any database credentials.

## Important subscription note
The frontend calls the plan `monthly`, but a one-time NGN 1000 checkout is not automatically a recurring subscription. If Pro is intended to renew monthly, create/use a Flutterwave recurring plan/subscription server-side and process renewal/cancellation webhooks. Do not grant indefinite Pro from a single successful transaction unless that is the intended product model.
