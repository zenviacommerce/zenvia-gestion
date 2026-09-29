import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
};
const headers={...corsHeaders,'Content-Type':'application/json'};

function response(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers});}
function clean(value:unknown,max=1000){return typeof value==='string'?value.trim().slice(0,max):'';}
function getAdminKey(){
  const raw=Deno.env.get('SUPABASE_SECRET_KEYS');
  if(raw){try{const parsed=JSON.parse(raw);if(typeof parsed?.default==='string'&&parsed.default.trim())return parsed.default.trim()}catch{}}
  return clean(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  if(req.method!=='POST')return response({error:'Método no permitido.'},405);
  try{
    const supabaseUrl=clean(Deno.env.get('SUPABASE_URL'),500),adminKey=getAdminKey();
    if(!supabaseUrl||!adminKey)return response({error:'Configuración interna no disponible.'},503);
    const admin=createClient(supabaseUrl,adminKey,{auth:{persistSession:false,autoRefreshToken:false}});

    const token=clean(req.headers.get('Authorization'),4000).replace(/^Bearer\s+/i,'');
    if(!token)return response({error:'Sesión no válida.'},401);
    const {data:userData,error:userError}=await admin.auth.getUser(token);
    if(userError||!userData?.user)return response({error:'Sesión no válida.'},401);

    const {data:profile,error:profileError}=await admin.from('app_users')
      .select('user_id,data_owner_id,role,active,permissions,full_name,email')
      .eq('user_id',userData.user.id).maybeSingle();
    if(profileError)throw profileError;
    if(!profile?.active)return response({error:'Tu acceso está desactivado.'},403);

    const {data:workspace,error:workspaceError}=await admin.from('workspaces')
      .select('id,name,status').eq('id',profile.data_owner_id).maybeSingle();
    if(workspaceError)throw workspaceError;
    if(!workspace||!['active','trialing'].includes(String(workspace.status)))return response({error:'El acceso de tu empresa está suspendido.'},403);

    const body=await req.json().catch(()=>({}));
    const message=clean(body?.message,4000);
    if(!message)return response({error:'Escribe una pregunta para ZENVIA IA.'},400);

    const platformUrl=clean(Deno.env.get('PLATFORM_CONTROL_PLANE_URL'),500).replace(/\/$/,'');
    const bridgeToken=clean(Deno.env.get('PLATFORM_BRIDGE_TOKEN'),1000);
    if(!platformUrl||!bridgeToken)return response({error:'El agente IA no está conectado a ZENVIA Platform.',code:'agent_bridge_missing'},503);

    const upstream=await fetch(`${platformUrl}/functions/v1/platform-agent`,{
      method:'POST',
      headers:{'Content-Type':'application/json','x-platform-token':bridgeToken},
      body:JSON.stringify({
        workspaceId:String(profile.data_owner_id),
        message,
        history:Array.isArray(body?.history)?body.history.slice(-10):[],
        context:{
          ...(body?.context&&typeof body.context==='object'&&!Array.isArray(body.context)?body.context:{}),
          workspaceName:String(workspace.name||''),
          userName:String(profile.full_name||profile.email||''),
        },
        userRole:String(profile.role||'user'),
        allowedPages:Array.isArray(body?.allowedPages)?body.allowedPages:[],
      }),
    });
    const payload=await upstream.json().catch(()=>({}));
    if(!upstream.ok)return response({error:String(payload?.error||'No se pudo consultar ZENVIA IA.'),code:payload?.code||null},upstream.status);
    return response(payload);
  }catch(error){
    return response({error:error instanceof Error?error.message:'Error interno del agente.'},500);
  }
});
