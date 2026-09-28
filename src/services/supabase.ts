import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type TenantPublicConfig={
  workspace_id:string;
  slug:string;
  name:string;
  supabase_url:string;
  publishable_key:string;
};

export type TenantResolution=
  |{status:'resolved';tenant:TenantPublicConfig}
  |{status:'multiple';tenants:Array<Pick<TenantPublicConfig,'workspace_id'|'slug'|'name'>>}
  |{status:'unresolved';error?:string};

const ACTIVE_TENANT_KEY='zenvia-gestion-active-tenant';
const PLATFORM_URL=(import.meta.env.VITE_PLATFORM_SUPABASE_URL||'https://ucokhtztxozxcikrmidv.supabase.co').replace(/\/$/,'');
const legacyTenant:TenantPublicConfig={
  workspace_id:'7461b2b7-f383-460d-b1c7-6ccbb52e42b2',
  slug:'zenvia',
  name:'ZENVIA',
  supabase_url:'https://sjkxxbedkkmgmqnvaqjh.supabase.co',
  publishable_key:'sb_publishable_rlMfpeedWWvOnu70ZjPdjA_ydz4QFYI',
};

function hasTenantQuery(){
  if(typeof window==='undefined')return false;
  try{return Boolean(new URLSearchParams(window.location.search).get('tenant'))}catch{return false}
}

function validTenant(value:unknown):value is TenantPublicConfig{
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const item=value as Record<string,unknown>;
  return ['workspace_id','slug','name','supabase_url','publishable_key'].every(key=>typeof item[key]==='string'&&String(item[key]).trim().length>0)
    &&/^https:\/\//.test(String(item.supabase_url));
}

function readCachedTenant():TenantPublicConfig|null{
  if(typeof window==='undefined')return null;
  try{
    const raw=window.localStorage.getItem(ACTIVE_TENANT_KEY);
    if(!raw)return null;
    const parsed=JSON.parse(raw);
    return validTenant(parsed)?parsed:null;
  }catch{return null}
}

function cacheTenant(tenant:TenantPublicConfig){
  if(typeof window==='undefined')return;
  try{window.localStorage.setItem(ACTIVE_TENANT_KEY,JSON.stringify(tenant))}catch{/* best effort */}
}

function createTenantClient(tenant:TenantPublicConfig,detectSessionInUrl:boolean):SupabaseClient{
  return createClient(tenant.supabase_url,tenant.publishable_key,{
    auth:{
      persistSession:true,
      autoRefreshToken:true,
      detectSessionInUrl,
      experimental:{passkey:true},
    },
  });
}

const cachedTenant=readCachedTenant();
let activeTenant:TenantPublicConfig=cachedTenant||legacyTenant;
export let supabase=createTenantClient(activeTenant,!hasTenantQuery());

export function getActiveTenant(){return activeTenant}

export function activateTenant(tenant:TenantPublicConfig,detectSessionInUrl=true){
  if(!validTenant(tenant))throw new Error('Configuración de empresa no válida.');
  if(activeTenant.workspace_id===tenant.workspace_id&&activeTenant.supabase_url===tenant.supabase_url){
    activeTenant=tenant;cacheTenant(tenant);return supabase;
  }
  try{supabase.auth.stopAutoRefresh()}catch{/* previous client can expire naturally */}
  activeTenant=tenant;
  cacheTenant(tenant);
  supabase=createTenantClient(tenant,detectSessionInUrl);
  return supabase;
}

async function tenantRouter(payload:{email?:string;tenant?:string}):Promise<TenantResolution>{
  const response=await fetch(`${PLATFORM_URL}/functions/v1/tenant-router`,{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(payload),
  });
  if(response.status===429)throw new Error('Demasiados intentos. Espera unos minutos y vuelve a probar.');
  if(!response.ok)throw new Error('No se pudo localizar tu empresa.');
  const data=await response.json().catch(()=>({status:'unresolved'}));
  if(data?.status==='resolved'&&validTenant(data.tenant))return {status:'resolved',tenant:data.tenant};
  if(data?.status==='multiple'&&Array.isArray(data.tenants)){
    return {
      status:'multiple',
      tenants:data.tenants.filter((item:unknown)=>{
        if(!item||typeof item!=='object')return false;
        const row=item as Record<string,unknown>;
        return typeof row.workspace_id==='string'&&typeof row.slug==='string'&&typeof row.name==='string';
      }),
    };
  }
  return {status:'unresolved',error:typeof data?.error==='string'?data.error:undefined};
}

export async function resolveAndActivateTenant(input:{email?:string;tenant?:string}):Promise<TenantResolution>{
  const result=await tenantRouter(input);
  if(result.status==='resolved')activateTenant(result.tenant,true);
  return result;
}

export async function bootstrapTenantFromLocation():Promise<TenantResolution>{
  if(typeof window!=='undefined'){
    const tenant=new URLSearchParams(window.location.search).get('tenant')?.trim();
    if(tenant)return await resolveAndActivateTenant({tenant});
  }
  return {status:'resolved',tenant:activeTenant};
}

export const INVOICE_BUCKET='invoices';
