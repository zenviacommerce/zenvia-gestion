import { createClient } from 'npm:@supabase/supabase-js@2';
import { validateToolCall } from '../_shared/agentTools.ts';
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json'};
const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
const actionTools:Record<string,string>={sync_orders:'orders.sync',create_client:'clients.create',create_product:'products.create',create_supplier:'suppliers.create',set_expense_status:'expenses.set_status',set_expense_payment:'expenses.set_payment',create_support_ticket:'support.create',sync_amazon:'amazon.sync'};
function adminKey(){try{const raw=Deno.env.get('SUPABASE_SECRET_KEYS');if(raw)return JSON.parse(raw).default||''}catch{}return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';}
Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers});
  if(req.method!=='POST')return reply({error:'Método no permitido.'},405);
  try{
    const url=Deno.env.get('SUPABASE_URL')||'',key=adminKey(),token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'');
    if(!url||!key||!token)return reply({error:'Sesión no válida.'},401);
    const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:auth,error:authError}=await admin.auth.getUser(token);
    if(authError||!auth?.user)return reply({error:'Sesión no válida.'},401);
    const {data:profile,error:profileError}=await admin.from('app_users').select('user_id,active,role,permissions,data_owner_id').eq('user_id',auth.user.id).maybeSingle();
    if(profileError)throw profileError;
    if(!profile?.active)return reply({error:'Acceso desactivado.'},403);
    const {data:workspace,error:workspaceError}=await admin.from('workspaces').select('status').eq('id',profile.data_owner_id).maybeSingle();
    if(workspaceError)throw workspaceError;
    if(!workspace||!['active','trialing'].includes(workspace.status))return reply({error:'Empresa suspendida.'},403);
    const body=await req.json().catch(()=>({})),toolKey=actionTools[String(body.type)];
    if(!toolKey)return reply({error:'Acción no válida.'},400);
    const {data:tool,error:toolError}=await admin.from('agent_tool_registry').select('tool_key,enabled,permission,action_type,requires_confirmation,destructive,args_schema').eq('app','gestion').eq('tool_key',toolKey).maybeSingle();
    if(toolError)throw toolError;
    const permissions=profile.role==='admin'&&tool?.permission?[tool.permission]:Array.isArray(profile.permissions)?profile.permissions:[];
    const validation=validateToolCall(tool,body.args,permissions,body.confirmed===true);
    if(validation)return reply({error:validation.error,code:validation.code},validation.status);
    if(body.args?.invoiceId){
      const {data:invoice,error}=await admin.from('invoices').select('id').eq('id',body.args.invoiceId).eq('owner_id',profile.data_owner_id).maybeSingle();
      if(error)throw error;
      if(!invoice)return reply({error:'Factura no disponible en tu empresa.'},404);
    }
    // Execution remains in the authenticated application services, with their
    // RLS and audit triggers. This gate does not claim a mutation has happened.
    return reply({ok:true,authorized:true,toolKey});
  }catch(error){return reply({error:error instanceof Error?error.message:'No se pudo validar la acción.'},500)}
});
