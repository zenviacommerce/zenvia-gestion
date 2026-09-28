import { safeStorageGet, safeStorageSet } from './browserStorage';

export type TenantConnection={
  workspaceId:string;
  slug:string;
  url:string;
  publishableKey:string;
};

export type TenantResolution=
  |{status:'resolved';connection:TenantConnection}
  |{status:'multiple'}
  |{status:'unresolved'};

const TENANT_STORAGE_KEY='zenvia-gestion-active-tenant';
const routerUrl=import.meta.env.VITE_PLATFORM_TENANT_ROUTER_URL
  ||'https://ucokhtztxozxcikrmidv.supabase.co/functions/v1/tenant-router';

function clean(value:unknown,max=500){
  return typeof value==='string'?value.trim().slice(0,max):'';
}

function validConnection(value:unknown):value is TenantConnection{
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const item=value as Record<string,unknown>;
  const workspaceId=clean(item.workspaceId,80),slug=clean(item.slug,80).toLowerCase();
  const url=clean(item.url,300),publishableKey=clean(item.publishableKey,500);
  if(!workspaceId||!slug||!publishableKey)return false;
  if(!/^[a-z0-9][a-z0-9-]{0,79}$/.test(slug))return false;
  try{
    const parsed=new URL(url);
    if(parsed.protocol!=='https:')return false;
  }catch{return false}
  return true;
}

export function normalizeTenantConnection(value:unknown):TenantConnection|null{
  if(!validConnection(value))return null;
  return {
    workspaceId:clean(value.workspaceId,80),
    slug:clean(value.slug,80).toLowerCase(),
    url:clean(value.url,300).replace(/\/$/,''),
    publishableKey:clean(value.publishableKey,500),
  };
}

export function readRememberedTenantConnection():TenantConnection|null{
  const raw=safeStorageGet('local',TENANT_STORAGE_KEY);
  if(!raw)return null;
  try{return normalizeTenantConnection(JSON.parse(raw))}
  catch{return null}
}

export function rememberTenantConnection(connection:TenantConnection){
  const normalized=normalizeTenantConnection(connection);
  if(!normalized)throw new Error('La configuración de empresa no es válida.');
  safeStorageSet('local',TENANT_STORAGE_KEY,JSON.stringify(normalized));
}

export function clearRememberedTenantConnection(){
  try{window.localStorage.removeItem(TENANT_STORAGE_KEY)}catch{/* best effort */}
}

export function tenantSlugFromUrl(){
  try{
    const value=new URL(window.location.href).searchParams.get('tenant');
    const slug=clean(value,80).toLowerCase();
    return /^[a-z0-9][a-z0-9-]{0,79}$/.test(slug)?slug:null;
  }catch{return null}
}

export async function resolveTenant(input:{tenant?:string|null;email?:string|null}):Promise<TenantResolution>{
  const tenant=clean(input.tenant,80).toLowerCase(),email=clean(input.email,254).toLowerCase();
  const body=tenant?{tenant}:email?{email}:null;
  if(!body)return {status:'unresolved'};
  let response:Response;
  try{
    response=await fetch(routerUrl,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(body),
    });
  }catch{
    throw new Error('No se pudo conectar con el servicio de acceso de ZENVIA. Inténtalo de nuevo.');
  }
  if(response.status===429)throw new Error('Demasiados intentos de acceso. Espera unos minutos e inténtalo de nuevo.');
  if(!response.ok)throw new Error('No se pudo resolver la empresa de acceso. Inténtalo de nuevo.');
  const payload=await response.json().catch(()=>({}));
  if(payload?.status==='resolved'){
    const connection=normalizeTenantConnection(payload.connection);
    return connection?{status:'resolved',connection}:{status:'unresolved'};
  }
  if(payload?.status==='multiple')return {status:'multiple'};
  return {status:'unresolved'};
}
