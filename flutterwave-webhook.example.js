// Server-side only. Implement flutterwave-webhook using your provider/database. Never expose secrets to the frontend.
export default async function handler(req,res){return res.status(501).json({error:'Not implemented'})}
