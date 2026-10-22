import {createAdminClient,authenticateUser} from '../_shared/amazon/supabase.ts';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const response=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,'Content-Type':'application/json'}});
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});if(req.method!=='POST')return response({error:'Método no permitido.'},405);
 try{
  const admin=createAdminClient(),caller=await authenticateUser(req,admin);
  if(caller.role!=='admin'&&!caller.permissions?.includes('orders'))return response({error:'No tienes permiso para gestionar pedidos.'},403);
  const body=await req.json();
  const {data,error}=await admin.rpc('register_external_shipment',{p_order:body.orderId,p_owner:caller.data_owner_id,p_actor:caller.user_id,p_request:body.requestId,p_input:body.input});
  if(error)throw error;return response(data);
 }catch(error){const message=error instanceof Error?error.message:typeof (error as any)?.message==='string'?(error as any).message:'No se pudo registrar el envío.';return response({error:message},/Sesión no válida/.test(message)?401:/permiso|suspendido|desactivado/.test(message)?403:409)}
});
