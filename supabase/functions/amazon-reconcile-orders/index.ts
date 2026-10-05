import { authenticateUser,createAdminClient,requireInternalSecret } from '../_shared/amazon/supabase.ts';
import { loadAmazonSpApiCredentials } from '../_shared/amazon/config.ts';
import { spApiRequest } from '../_shared/amazon/sp-api.ts';
import { reconcileOperationalAmazonStates } from '../_shared/amazon/orders.ts';
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Content-Type':'application/json'};
const response=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers});
 if(req.method!=='POST')return response({error:'Método no permitido.'},405);
 try{
  const admin=createAdminClient(),body=await req.json().catch(()=>({}));
  let ownerId='';
  try{requireInternalSecret(req);ownerId=String(body.ownerId||'')}catch{
   const caller=await authenticateUser(req,admin);
   if(caller.role!=='admin'&&!caller.permissions?.includes('orders'))return response({error:'No tienes permiso para gestionar pedidos.'},403);
   ownerId=caller.data_owner_id;
  }
  if(!ownerId)return response({error:'Falta el workspace.'},400);
  const {data:accounts,error:accountError}=await admin.from('integration_accounts').select('id,linked_resource_id').eq('owner_id',ownerId).eq('provider','amazon').eq('enabled',true).neq('status','disabled');
  if(accountError)throw accountError;
  const {data:rows,error}=await admin.from('fulfillment_orders').select('order_number,source_integration_account_id').eq('owner_id',ownerId).eq('source_channel','amazon').is('fulfilled_at',null).in('source_status',['Pending','PENDING','UNSHIPPED','unshipped','Unshipped','PARTIALLY_SHIPPED']).order('order_created_at',{ascending:false}).limit(100);
  if(error)throw error;
  const byOrder=new Map((rows||[]).filter((r:any)=>r.order_number).map((r:any)=>[r.order_number,r]));
  const credentialsByAccount=new Map<string,any>(),results:any[]=[],failures:any[]=[];
  for(const row of [...byOrder.values()].slice(0,30) as any[]){
   try{
    const account=(accounts||[]).find((a:any)=>a.id===row.source_integration_account_id)||((accounts||[]).length===1?accounts[0]:null);
    if(!account?.linked_resource_id)throw new Error('No se ha identificado la cuenta Amazon del pedido.');
    if(!credentialsByAccount.has(account.id))credentialsByAccount.set(account.id,await loadAmazonSpApiCredentials(admin,{amazonAccountId:account.linked_resource_id,ownerId}));
    const data=await spApiRequest('/orders/2026-01-01/orders/'+encodeURIComponent(row.order_number),{query:{includedData:['FULFILLMENT','PACKAGES']}},credentialsByAccount.get(account.id));
    const order=data.order||data;
    if(!order.orderId)throw new Error('Amazon no devolvió el pedido.');
    await reconcileOperationalAmazonStates(admin,[order],ownerId);
    results.push({orderId:order.orderId,status:order.fulfillment?.fulfillmentStatus,tracking:order.packages?.map((p:any)=>p.trackingNumber).filter(Boolean)||[]});
   }catch(e){failures.push({orderId:row.order_number,error:e instanceof Error?e.message:String(e)})}
  }
  return response({ok:failures.length===0,processed:results.length,results,failures});
 }catch(e){return response({error:e instanceof Error?e.message:String(e)},500)}
});