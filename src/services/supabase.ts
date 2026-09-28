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

export class TenantResolutionError extends Error{
  constructor(message:string){super(message);this.name='TenantResolutionError'}
}

const ACTIVE_TENANT_KEY='zenvia-gestion-active-tenant';
const PLATFORM_URL=(import.meta.env.VITE_PLATFORM_SUPABASE_URL||'https://ucokhtztxozxcikrmidv.supabase.co').replace(/\/$/,'');

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

function cacheTenant(tenant:TenantPublicConfig|null){
  if(typeof window==='undefined')return;
  try{
    if(tenant)window.localStorage.setItem(ACTIVE_TENANT_KEY,JSON.stringify(tenant));
    else window.localStorage.removeItem(ACTIVE_TENANT_KEY);
  }catch{/* best effort */}
}

function tenantStorageKey(tenant:TenantPublicConfig){
  return `zenvia-gestion-auth-${tenant.workspace_id}`;
}

function createTenantClient(tenant:TenantPublicConfig,detectSessionInUrl:boolean):SupabaseClient{
  return createClient(tenant.supabase_url,tenant.publishable_key,{
    auth:{
      persistSession:true,
      autoRefreshToken:true,
      detectSessionInUrl,
      storageKey:tenantStorageKey(tenant),
      experimental:{passkey:true},
    },
  });
}

let activeTenant:TenantPublicConfig|null=readCachedTenant();
let activeClient:SupabaseClient|null=activeTenant?createTenantClient(activeTenant,true):null;

function emitTenantChanged(){
  if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('zenvia:tenant-changed'));
}

export function hasActiveTenant(){return Boolean(activeTenant&&activeClient)}
export function getActiveTenant(){return activeTenant}
export function getActiveSupabase():SupabaseClient{
  if(!activeClient)throw new TenantResolutionError('Selecciona tu empresa antes de continuar.');
  return activeClient;
}

export let supabase=new Proxy({} as SupabaseClient,{
  get(_target,property){
    const client=getActiveSupabase() as any;
    const value=client[property as keyof SupabaseClient];
    return typeof value==='function'?value.bind(client):value;
  },
});

export async function clearActiveTenant(options:{forget?:boolean;signOut?:boolean}={}){
  const previous=activeClient;
  if(options.signOut!==false&&previous){
    try{await previous.auth.signOut({scope:'local'})}catch{/* local cleanup still continues */}
    try{previous.auth.stopAutoRefresh()}catch{/* optional */}
  }
  activeClient=null;
  if(options.forget!==false){
    activeTenant=null;
    cacheTenant(null);
  }
  emitTenantChanged();
}

export async function activateTenant(tenant:TenantPublicConfig,detectSessionInUrl=true){
  if(!validTenant(tenant))throw new TenantResolutionError('Configuración de empresa no válida.');
  if(activeTenant&&activeClient&&activeTenant.workspace_id===tenant.workspace_id&&activeTenant.supabase_url===tenant.supabase_url){
    activeTenant=tenant;
    cacheTenant(tenant);
    return activeClient;
  }
  if(activeTenant&&activeClient&&activeTenant.workspace_id!==tenant.workspace_id){
    try{await activeClient.auth.signOut({scope:'local'})}catch{/* switching still proceeds */}
    try{activeClient.auth.stopAutoRefresh()}catch{/* optional */}
  }
  activeTenant=tenant;
  cacheTenant(tenant);
  activeClient=createTenantClient(tenant,detectSessionInUrl);
  emitTenantChanged();
  return activeClient;
}

async function tenantRouter(payload:{email?:string;tenant?:string}):Promise<TenantResolution>{
  let response:Response;
  try{
    response=await fetch(`${PLATFORM_URL}/functions/v1/tenant-router`,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(payload),
    });
  }catch{
    throw new TenantResolutionError('No se puede contactar con ZENVIA Platform para localizar tu empresa. Inténtalo de nuevo.');
  }
  if(response.status===429)throw new TenantResolutionError('Demasiados intentos. Espera unos minutos y vuelve a probar.');
  if(!response.ok)throw new TenantResolutionError('No se pudo localizar tu empresa.');
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
  if(result.status==='resolved')await activateTenant(result.tenant,true);
  return result;
}

export function tenantFromUrl(){
  if(typeof window==='undefined')return '';
  try{return new URLSearchParams(window.location.search).get('tenant')?.trim()||''}
  catch{return ''}
}

export async function bootstrapTenantFromLocation():Promise<TenantResolution>{
  const explicitTenant=tenantFromUrl();
  if(explicitTenant){
    const result=await resolveAndActivateTenant({tenant:explicitTenant});
    if(result.status!=='resolved')throw new TenantResolutionError('No se ha encontrado la empresa indicada en la invitación.');
    return result;
  }
  if(activeTenant&&activeClient)return {status:'resolved',tenant:activeTenant};
  return {status:'unresolved'};
}

export const INVOICE_BUCKET='invoices';
