Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:{
    'Access-Control-Allow-Origin':'*',
    'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods':'POST, OPTIONS',
  }});
  return new Response(JSON.stringify({
    error:'Este endpoint ha sido retirado. Usa ZENVIA Platform independiente.'
  }),{
    status:410,
    headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}
  });
});