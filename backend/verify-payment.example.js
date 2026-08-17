// Server-side only. This example intentionally does not contain Flutterwave secrets.
// Implement using your server's Flutterwave SDK/API and a persistent database.
//
// Contract:
// 1. POST only.
// 2. Validate email and tx_ref/transaction_id.
// 3. Re-query Flutterwave using server credentials.
// 4. Require successful transaction, exact NGN 1000 amount, and expected tx_ref.
// 5. Make subscription activation idempotent (same transaction cannot activate twice).
// 6. Store the verified entitlement server-side.
// 7. Return { pro: true } only after successful verification.
export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  return res.status(501).json({error:'Implement server-side Flutterwave verification before production.'});
}
