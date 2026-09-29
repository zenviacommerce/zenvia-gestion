import { adminClient } from '../_shared/support/supabase.ts';

const corsHeaders={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'content-type, x-platform-token',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
};
const DEFAULT_FROM='ZENVIA <soporte@zenviacommerce.com>';
const DEFAULT_REPLY_TO='soporte@zenviacommerce.com';

function response(data:unknown,status=200){
  return new Response(JSON.stringify(data),{status,headers:{...corsHeaders,'Content-Type':'application/json'}});
}
function text(value:unknown,max=500){
  return typeof value==='string'?value.trim().slice(0,max):'';
}
function esc(value:unknown){
  return String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]||ch));
}
async function sha256(value:string){
  const encoded=new TextEncoder().encode(value);
  const digest=await crypto.subtle.digest('SHA-256',encoded);
  return [...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('');
}
async function requirePlatformToken(req:Request,admin:any){
  const supplied=(req.headers.get('x-platform-token')||'').trim();
  if(!supplied)return false;
  const {data,error}=await admin.from('platform_bridge_secrets')
    .select('token_sha256,active').eq('secret_id','primary').maybeSingle();
  if(error)throw error;
  return Boolean(data?.active)&&await sha256(supplied)===String(data?.token_sha256||'');
}
async function sendEmail(input:{to:string;subject:string;html:string;textBody:string}){
  const apiKey=(Deno.env.get('RESEND_API_KEY')||'').trim();
  if(!apiKey)throw new Error('RESEND_API_KEY no está configurada en el servicio central de correo.');
  const from=(Deno.env.get('AUTH_EMAIL_FROM')||Deno.env.get('SUPPORT_EMAIL_FROM')||DEFAULT_FROM).trim();
  const replyTo=(Deno.env.get('AUTH_EMAIL_REPLY_TO')||Deno.env.get('SUPPORT_EMAIL_TO')||DEFAULT_REPLY_TO).trim();
  const result=await fetch('https://api.resend.com/emails',{
    method:'POST',
    headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},
    body:JSON.stringify({from,to:[input.to],reply_to:replyTo,subject:input.subject,html:input.html,text:input.textBody}),
  });
  if(!result.ok){
    const detail=await result.text();
    throw new Error(`Resend ${result.status}: ${detail.slice(0,400)}`);
  }
  const payload=await result.json().catch(()=>({}));
  return {provider:'resend',id:String(payload?.id||'')};
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  if(req.method!=='POST')return response({error:'Método no permitido.'},405);
  const admin=adminClient();
  try{
    if(!await requirePlatformToken(req,admin))return response({error:'Servicio de correo no autorizado.'},401);
    const body=await req.json().catch(()=>({}));
    if(text(body?.event,40)!=='invite')return response({error:'Evento de correo no válido.'},400);

    const to=text(body?.to,254).toLowerCase();
    const fullName=text(body?.fullName,160);
    const workspaceName=text(body?.workspaceName,160);
    const roleLabel=text(body?.roleLabel,120)||'Usuario';
    const inviteUrl=text(body?.inviteUrl,2000);
    const app=body?.app==='platform'?'platform':'gestion';
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(to))return response({error:'Destinatario no válido.'},400);
    if(!fullName||!workspaceName)return response({error:'Faltan los datos de la invitación.'},400);
    if(!/^https:\/\//i.test(inviteUrl))return response({error:'El enlace de invitación no es válido.'},400);

    const product=app==='platform'?'ZENVIA Platform':'ZENVIA Gestión';
    const destination=app==='platform'?'el panel interno de ZENVIA':'ZENVIA Gestión';
    const subject=app==='platform'
      ?'Tu acceso a ZENVIA Platform está preparado'
      :`Te han invitado a ${workspaceName} en ZENVIA Gestión`;
    const textBody=[
      `Hola ${fullName},`,
      '',
      app==='platform'
        ?`Te han dado acceso a ZENVIA Platform con el perfil ${roleLabel}.`
        :`Te han dado acceso a ${workspaceName} en ZENVIA Gestión como ${roleLabel}.`,
      'Activa tu cuenta y crea tu contraseña desde este enlace:',
      inviteUrl,
      '',
      'Este enlace es personal y no debes compartirlo.',
      'Si no esperabas esta invitación, puedes ignorar este correo.',
      '',
      product,
    ].join('\n');

    const html=`
      <div style="margin:0;padding:36px 16px;background:#f4f7fb;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#172033">
        <table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;max-width:620px;margin:0 auto;border-collapse:separate;background:#ffffff;border:1px solid #e2e8f0;border-radius:18px;overflow:hidden;box-shadow:0 16px 42px rgba(15,23,42,.09)">
          <tr><td style="height:6px;background:#0f766e"></td></tr>
          <tr><td style="padding:30px 34px 12px">
            <div style="font-size:22px;font-weight:900;letter-spacing:.08em;color:#0f172a">ZENVIA</div>
            <div style="margin-top:4px;font-size:11px;font-weight:800;letter-spacing:.15em;text-transform:uppercase;color:#0f766e">${app==='platform'?'Platform':'Gestión'}</div>
          </td></tr>
          <tr><td style="padding:10px 34px 34px">
            <h1 style="margin:0 0 14px;font-size:26px;line-height:1.2;color:#101828">Tu acceso está preparado</h1>
            <p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:#475467">
              Hola <strong>${esc(fullName)}</strong>,
              ${app==='platform'
                ?'te han dado acceso al panel interno de <strong>ZENVIA Platform</strong>.'
                :`te han invitado a trabajar en <strong>${esc(workspaceName)}</strong> dentro de ZENVIA Gestión.`}
            </p>
            <div style="margin:20px 0;padding:15px 17px;border-radius:12px;background:#f8fafc;border:1px solid #e2e8f0">
              <div style="font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:#667085;font-weight:800">Perfil asignado</div>
              <div style="margin-top:6px;font-size:14px;font-weight:800;color:#172033">${esc(roleLabel)}</div>
              ${app==='gestion'? `<div style="margin-top:8px;font-size:12px;color:#667085">${esc(workspaceName)}</div>` : ''}
            </div>
            <p style="margin:0 0 22px;font-size:14px;line-height:1.65;color:#667085">Pulsa el botón para activar tu cuenta y crear tu contraseña para ${esc(destination)}.</p>
            <a href="${esc(inviteUrl)}" style="display:inline-block;padding:13px 20px;border-radius:10px;background:#0f766e;color:#ffffff;text-decoration:none;font-size:14px;font-weight:800">Activar mi cuenta</a>
            <div style="margin-top:26px;padding-top:18px;border-top:1px solid #eef2f6">
              <p style="margin:0;font-size:12px;line-height:1.6;color:#98a2b3">Este enlace es personal. Si no esperabas esta invitación, puedes ignorar el correo. Para cualquier duda, responde a este mensaje o contacta con soporte@zenviacommerce.com.</p>
            </div>
          </td></tr>
        </table>
      </div>`;

    const sent=await sendEmail({to,subject,html,textBody});
    return response({ok:true,delivered:true,provider:sent.provider,id:sent.id});
  }catch(error){
    console.error(error);
    return response({error:error instanceof Error?error.message:'No se pudo enviar el correo.',delivered:false},500);
  }
});
