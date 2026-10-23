import {createAdminClient,authenticateUser} from '../_shared/amazon/supabase.ts';
import {reconcileShipmentCreation} from '../_shared/shippingReconciliation.ts';
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,x-client-info,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS','Content-Type':'application/json'};
const reply=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers});
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers});
 if(req.method!=='POST')return reply({error:'Método no permitido.'},405);
 try{
  const admin=createAdminClient(),caller=await authenticateUser(req,admin);
  if(caller.role!=='admin'&&!caller.permissions?.includes('orders'))return reply({error:'No tienes permiso para gestionar pedidos.'},403);
  const body=await req.json().catch(()=>null),orderId=String(body?.orderId||'');
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(orderId))return reply({error:'Selecciona un pedido válido.'},400);
  return reply(await reconcileShipmentCreation(admin,caller.data_owner_id,orderId));
 }catch(error){
  const code=String((error as any)?.message||'');
  if(/Sesión no válida/.test(code))return reply({error:'Sesión no válida.'},401);
  if(/MFA|MULTIFACTOR|STEP_UP/i.test(code))return reply({error:'Verifica tu sesión para comprobar el envío.'},403);
  if(/permiso|suspendid|desactivad/i.test(code))return reply({error:'No tienes acceso a este pedido.'},403);
  if(/CREATION_ORDER_NOT_FOUND/.test(code))return reply({error:'Pedido no encontrado.'},404);
  if(/CREATION_.*BUSY/.test(code))return reply({error:'Hay otra operación de envío en curso. Espera un momento y vuelve a comprobar.'},409);
  if(/CREATION_LEGACY_ACCOUNT_AMBIGUOUS|CREATION_ACCOUNT_INVALID/.test(code))return reply({error:'No se puede identificar una única cuenta de transporte para este intento. Revisa la cuenta antes de repetir el envío.'},409);
  if(/CREATION_NO_OPEN_ATTEMPT|CREATION_NO_LEGACY_ATTEMPT|CREATION_SHIPMENT_CHANGED|CREATION_STALE_TOKEN/.test(code))return reply({error:'El estado del envío ha cambiado. Actualiza el pedido antes de continuar.'},409);
  if(/CREATION_ORDER_PURGED/.test(code))return reply({error:'Los datos personales del pedido se han eliminado por retención.'},410);
  return reply({error:'No se pudo completar la comprobación. El envío continúa protegido frente a duplicados.'},500);
 }
});
