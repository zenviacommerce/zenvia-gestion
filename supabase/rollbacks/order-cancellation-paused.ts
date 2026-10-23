// Temporary maintenance entrypoint for the existing order-cancellation function.
// Preserve CURRENT Auth/MFA dependencies; never use the v3 snapshot helpers.
import {createAdminClient,authenticateUser} from '../functions/_shared/amazon/supabase.ts';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const json=(data:unknown,status:number)=>new Response(JSON.stringify(data),{status,headers:{...cors,'Content-Type':'application/json'}});
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(req.method!=='POST')return json({error:'Método no permitido.'},405);
 try{
  const caller=await authenticateUser(req,createAdminClient());
  if(caller.role!=='admin'&&!caller.permissions?.includes('orders'))return json({error:'No tienes permiso para gestionar pedidos.'},403);
  return json({error:'Las solicitudes de cancelación están temporalmente pausadas. No se ha enviado ninguna operación.',code:'CANCELLATION_PAUSED'},503);
 }catch(error){const message=error instanceof Error?error.message:'';return json({error:'Verifica tu sesión antes de continuar.'},message.startsWith('MFA_')?403:401)}
});
