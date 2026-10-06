// Compatibility entry point. All extraction runs in the single Vercel InvoiceEngine.
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS'};
Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
  if(req.method!=='POST')return new Response('Method not allowed',{status:405,headers:cors});
  const auth=req.headers.get('authorization')||'';
  if(!auth.startsWith('Bearer '))return new Response('Unauthorized',{status:401,headers:cors});
  const target=Deno.env.get('INVOICE_ENGINE_API_URL');
  if(!target)return Response.json({error:'Configura INVOICE_ENGINE_API_URL para usar el motor único.'},{status:503,headers:cors});
  try{
    const url=new URL(target);if(url.protocol!=='https:')throw new Error('HTTPS requerido.');
    const payload=await req.json();
    // URL comes from the function's project, never from untrusted document input.
    const upstream=await fetch(url,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',Authorization:auth},signal:AbortSignal.timeout(270000),body:JSON.stringify({...payload,tenantUrl:Deno.env.get('SUPABASE_URL')})});
    return new Response(await upstream.text(),{status:upstream.status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
  }catch{return Response.json({error:'El motor de importación no está disponible.'},{status:502,headers:cors});}
});
