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
    const {data:order,error}=await admin.from('fulfillment_orders').select('*').eq('owner_id',caller.data_owner_id).eq('id',orderId).maybeSingle();
    if(error)throw error;
    if(!order)return response({error:'Pedido no encontrado.'},404);

    if(action==='mark_label_printed'){
      if(!order.label_created_at&&!order.sendcloud_parcel_id&&!order.shipping_remote_id)return response({error:'Este pedido todavía no tiene una etiqueta creada.'},409);
      const now=new Date().toISOString(),nextCount=Number(order.label_print_count||0)+1;
      const {error:updateError}=await admin.from('fulfillment_orders').update({label_printed_at:now,label_print_count:nextCount,label_print_state_known:true}).eq('owner_id',caller.data_owner_id).eq('id',orderId);
      if(updateError)throw updateError;
      return response({ok:true,printedAt:now,printCount:nextCount});
    }

    if(action==='update_order'||action==='update_native_order'){
      if(order.label_created_at||order.sendcloud_parcel_id||order.shipping_remote_id)return response({error:'Solo puedes editar pedidos antes de crear la etiqueta.'},409);
      const input=body?.order||{};
      const name=clean(input.customerName),email=clean(input.email),phone=clean(input.phone),address1=clean(input.address??input.address1),houseNumber=clean(input.houseNumber),address2=clean(input.address2),postalCode=clean(input.postalCode),city=clean(input.city),stateProvince=clean(input.stateProvince),countryCode=clean(input.countryCode).toUpperCase();
      const weightKg=Number(input.weightKg),lengthCm=Number(input.packageLengthCm),widthCm=Number(input.packageWidthCm),heightCm=Number(input.packageHeightCm);
      if(!name||!address1||!postalCode||!city||countryCode.length!==2)return response({error:'Completa nombre, dirección, código postal, ciudad y país.'},409);
      if(!Number.isFinite(weightKg)||weightKg<=0)return response({error:'El peso debe ser mayor que 0.'},409);
      const hasDimensions=[lengthCm,widthCm,heightCm].every(value=>Number.isFinite(value)&&value>0);
      const shippingAddress={...(order.shipping_address||{}),name,company_name:clean(input.companyName)||null,address_line_1:address1,house_number:houseNumber||null,address_line_2:address2||null,postal_code:postalCode,city,state_province_code:stateProvince||null,country_code:countryCode,email:email||null,phone_number:phone||null};
      const rawPayload=order.raw_payload&&typeof order.raw_payload==='object'?order.raw_payload:{};
      const nextRaw={...rawPayload,shipping_details:{...(rawPayload.shipping_details||{}),measurement:{...(rawPayload.shipping_details?.measurement||{}),weight:{value:Number(weightKg.toFixed(3)),unit:'kg'},...(hasDimensions?{dimension:{length:Number(lengthCm.toFixed(1)),width:Number(widthCm.toFixed(1)),height:Number(heightCm.toFixed(1)),unit:'cm'}}:{})}}};
      const {error:updateError}=await admin.from('fulfillment_orders').update({
        customer_name:name,customer_email:email||null,customer_phone:phone||null,shipping_address:shippingAddress,raw_payload:nextRaw,
        package_length_cm:hasDimensions?lengthCm:null,package_width_cm:hasDimensions?widthCm:null,package_height_cm:hasDimensions?heightCm:null,
        order_updated_at:new Date().toISOString(),last_synced_at:new Date().toISOString(),
      }).eq('owner_id',caller.data_owner_id).eq('id',orderId);
      if(updateError)throw updateError;
      return response({ok:true,weightKg,dimensions:hasDimensions?{lengthCm,widthCm,heightCm}:null});
    }

    return response({error:'Acción no válida.'},400);
  }catch(error){
    const message=error instanceof Error?error.message:'Error interno.';
    return response({error:message},/Sesión no válida/.test(message)?401:/permiso/.test(message)?403:500);
  }
});