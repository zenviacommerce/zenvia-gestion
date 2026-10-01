import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
};
const headers={...corsHeaders,'Content-Type':'application/json'};
const clean=(value:unknown)=>String(value??'').trim();
const response=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
function getAdminKey(){
  const raw=Deno.env.get('SUPABASE_SECRET_KEYS');
  if(raw){try{const parsed=JSON.parse(raw);if(typeof parsed?.default==='string'&&parsed.default.trim())return parsed.default.trim()}catch{}}
  return clean(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
}
async function authenticate(req:Request,admin:any){
  const token=clean(req.headers.get('Authorization')).replace(/^Bearer\s+/i,'');
  if(!token)throw new Error('Sesión no válida.');
  const {data:userData,error:userError}=await admin.auth.getUser(token);
  if(userError||!userData?.user)throw new Error('Sesión no válida.');
  const {data:caller,error}=await admin.from('app_users').select('user_id,data_owner_id,role,active,permissions').eq('user_id',userData.user.id).maybeSingle();
  if(error)throw error;
  if(!caller?.active)throw new Error('Tu acceso está desactivado.');
  const permissions=Array.isArray(caller.permissions)?caller.permissions:[];
  if(caller.role!=='admin'&&!permissions.includes('orders'))throw new Error('No tienes permiso para gestionar pedidos.');
  return caller;
}
Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  if(req.method!=='POST')return response({error:'Método no permitido.'},405);
  const url=clean(Deno.env.get('SUPABASE_URL')),key=getAdminKey();
  if(!url||!key)return response({error:'Configuración interna no disponible.'},500);
  const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  try{
    const caller=await authenticate(req,admin),body=await req.json().catch(()=>({}));
    const action=clean(body?.action),orderId=clean(body?.orderId);
    if(!orderId)return response({error:'Falta el pedido.'},400);
    const {data:order,error}=await admin.from('fulfillment_orders').select('id,label_created_at,sendcloud_parcel_id,shipping_remote_id,label_print_count').eq('owner_id',caller.data_owner_id).eq('id',orderId).maybeSingle();
    if(error)throw error;
    if(!order)return response({error:'Pedido no encontrado.'},404);

    if(action==='mark_label_printed'){
      if(!order.label_created_at&&!order.sendcloud_parcel_id&&!order.shipping_remote_id)return response({error:'Este pedido todavía no tiene una etiqueta creada.'},409);
      const now=new Date().toISOString(),nextCount=Number(order.label_print_count||0)+1;
      const {error:updateError}=await admin.from('fulfillment_orders').update({label_printed_at:now,label_print_count:nextCount,label_print_state_known:true}).eq('owner_id',caller.data_owner_id).eq('id',orderId);
      if(updateError)throw updateError;
      return response({ok:true,printedAt:now,printCount:nextCount});
    }

    return response({error:'Acción no válida.'},400);
  }catch(error){
    const message=error instanceof Error?error.message:'Error interno.';
    return response({error:message},/Sesión no válida/.test(message)?401:/permiso/.test(message)?403:500);
  }
});