import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.105.0';
import {validateInquiry} from './validation.ts';
const allowed=['https://gestion.zenviacommerce.com','https://gestionzenvia.vercel.app'];
const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
Deno.serve(async(req:Request)=>{
 const origin=req.headers.get('origin')||'';
 const headers={'Content-Type':'application/json','Access-Control-Allow-Origin':allowed.includes(origin)?origin:allowed[0],'Vary':'Origin','Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Cache-Control':'no-store'};
 const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
 if(!allowed.includes(origin))return reply({error:'Origen no permitido.'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
 if(req.method==='GET'){
  const {data,error}=await admin.from('billing_plans').select('plan_key,name,description,monthly_price_cents,yearly_price_cents').eq('active',true).eq('is_public',true).order('sort_order');
  return error?reply({error:'No se pudieron consultar los planes.'},503):reply({plans:data,vatIncluded:true});
 }
 if(req.method!=='POST')return reply({error:'Método no permitido.'},405);
 try{
  const raw=await req.text();if(raw.length>10000)return reply({error:'Solicitud demasiado grande.'},413);
  let body:Record<string,unknown>;try{body=JSON.parse(raw)}catch{return reply({error:'Solicitud no válida.'},400)}
  if(!body||typeof body!=='object'||Array.isArray(body))return reply({error:'Solicitud no válida.'},400);
  if(String(body.website||'').trim())return reply({ok:true});
  let input:ReturnType<typeof validateInquiry>;try{input=validateInquiry(body)}catch(e){return reply({error:(e as Error).message},422)}
  const ip=(req.headers.get('cf-connecting-ip')||req.headers.get('x-forwarded-for')?.split(',')[0]||'unknown').trim();
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const digest=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(ip==='unknown'?input.email:ip));
  const rateHash=Array.from(new Uint8Array(digest)).map(v=>v.toString(16).padStart(2,'0')).join('');
  const {data,error}=await admin.rpc('submit_website_inquiry',{p_request_id:input.requestId,p_name:input.name,p_email:input.email,p_company:input.company,p_message:input.message,p_plan:input.plan,p_rate_hash:rateHash});
  if(error)return reply({error:error.message.includes('rate_limited')?'Has enviado varias solicitudes. Inténtalo más tarde.':'No se pudo guardar la solicitud. Vuelve a intentarlo.'},error.message.includes('rate_limited')?429:503);
  // Read the saved request on every attempt, including retries, so notifications use the original data.
  const {data:inquiry,error:readError}=await admin.from('website_inquiries').select('name,email,company,message,plan_key,notification_sent').eq('id',data.id).single();
  if(readError||!inquiry)return reply({error:'No se pudo comprobar la solicitud. Vuelve a intentarlo.'},503);
  if(!inquiry.notification_sent){
   const apiKey=Deno.env.get('RESEND_API_KEY')?.trim();
   if(!apiKey){console.error('website-contact notification failed: RESEND_API_KEY missing',data.id);return reply({error:'Tu solicitud está guardada, pero no hemos podido notificarla al equipo. Inténtalo de nuevo más tarde.',reference:data.id},503);}
   try{
    const mail=await fetch('https://api.resend.com/emails',{method:'POST',signal:AbortSignal.timeout(10000),headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json','Idempotency-Key':`website-inquiry-${data.id}`},body:JSON.stringify({from:(Deno.env.get('AUTH_EMAIL_FROM')||Deno.env.get('SUPPORT_EMAIL_FROM')||'ZENVIA Gestión <soporte@zenviacommerce.com>').trim(),to:['info@zenviacommerce.com'],reply_to:inquiry.email,subject:'Nueva solicitud de información · Zenvia Gestión',html:`<h2>Solicitud de información</h2><p><b>Nombre:</b> ${esc(inquiry.name)}<br><b>Empresa:</b> ${esc(inquiry.company)}<br><b>Email:</b> ${esc(inquiry.email)}<br><b>Plan:</b> ${esc(inquiry.plan_key||'Sin preferencia')}</p><p>${esc(inquiry.message).replace(/\n/g,'<br>')}</p>`})});
    if(!mail.ok){console.error('website-contact notification rejected',data.id,mail.status,(await mail.text()).slice(0,400));return reply({error:'Tu solicitud está guardada, pero no hemos podido notificarla al equipo. Inténtalo de nuevo más tarde.',reference:data.id},503);}
    const {error:updateError}=await admin.from('website_inquiries').update({notification_sent:true}).eq('id',data.id);
    if(updateError)throw updateError;
   }catch(error){console.error('website-contact notification failed',data.id,error instanceof Error?error.message:'unknown');return reply({error:'Tu solicitud está guardada, pero no hemos podido notificarla al equipo. Inténtalo de nuevo más tarde.',reference:data.id},503);}
  }
  return reply({ok:true,reference:data.id});
 }catch{return reply({error:'No se pudo completar la solicitud. Vuelve a intentarlo.'},503)}
});
