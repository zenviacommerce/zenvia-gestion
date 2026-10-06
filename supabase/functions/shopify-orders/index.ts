import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
};
const headers={...corsHeaders,'Content-Type':'application/json'};
function response(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers});}
function clean(value:unknown){return String(value??'').trim();}
function getAdminKey(){
  const secretKeys=Deno.env.get('SUPABASE_SECRET_KEYS');
  if(secretKeys){try{const parsed=JSON.parse(secretKeys);if(parsed?.default)return String(parsed.default)}catch{}}
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
  if(caller.role!=='admin'&&!permissions.includes('orders'))throw new Error('No tienes permiso para sincronizar pedidos.');
  return caller;
}
import {enqueueOrderImport} from '../_shared/imports/orderAdapters.ts';
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
 if(req.method!=='POST')return response({error:'Método no permitido.'},405);
 try{const admin=createClient(clean(Deno.env.get('SUPABASE_URL')),getAdminKey(),{auth:{persistSession:false,autoRefreshToken:false}});const caller=await authenticate(req,admin),body=await req.json();const job=await enqueueOrderImport(admin,caller,'shopify_orders',{history:Boolean(body.history)},body.integrationAccountId);return response({ok:true,configured:true,synced:0,queued:true,jobId:job.id,history:Boolean(body.history)});}
 catch(error){return response({error:error instanceof Error?error.message:'Error de importación'},400);}
});
