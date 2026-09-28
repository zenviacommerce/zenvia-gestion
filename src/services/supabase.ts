import type { SupabaseClient } from '@supabase/supabase-js';
import {
  clearRememberedTenantConnection,
  hasExplicitTenantParameter,
  normalizeTenantConnection,
  readRememberedTenantConnection,
  rememberTenantConnection,
  type TenantConnection,
} from './tenant';
import { getTenantSupabase } from './tenantSupabase';

let activeConnection:TenantConnection|null=hasExplicitTenantParameter()?null:readRememberedTenantConnection();
let activeClient:SupabaseClient|null=activeConnection?getTenantSupabase(activeConnection):null;

export function getActiveTenantConnection(){
  return activeConnection;
}

export function hasActiveTenant(){
  return Boolean(activeConnection&&activeClient);
}

export const TENANT_CHANGED_EVENT='zenvia:tenant-changed';

function notifyTenantChanged(){
  try{window.dispatchEvent(new CustomEvent(TENANT_CHANGED_EVENT))}catch{/* non-browser */}
}

export function setActiveTenant(connection:TenantConnection,{remember=true}:{remember?:boolean}={}){
  const normalized=normalizeTenantConnection(connection);
  if(!normalized)throw new Error('La configuración de empresa no es válida.');
  const same=activeConnection?.workspaceId===normalized.workspaceId
    &&activeConnection.url===normalized.url
    &&activeConnection.publishableKey===normalized.publishableKey;
  if(!same){
    try{activeClient?.auth.stopAutoRefresh()}catch{/* best effort */}
    activeConnection=normalized;
    activeClient=getTenantSupabase(normalized);
  }
  if(remember)rememberTenantConnection(normalized);
  if(!same)notifyTenantChanged();
  return activeClient!;
}

export function clearActiveTenant({forget=false}:{forget?:boolean}={}){
  const hadTenant=Boolean(activeClient||activeConnection);
  try{activeClient?.auth.stopAutoRefresh()}catch{/* best effort */}
  activeConnection=null;
  activeClient=null;
  if(forget)clearRememberedTenantConnection();
  if(hadTenant)notifyTenantChanged();
}

export async function activateTenant(connection:TenantConnection,{remember=true}:{remember?:boolean}={}){
  const normalized=normalizeTenantConnection(connection);
  if(!normalized)throw new Error('La configuración de empresa no es válida.');
  const changing=Boolean(activeClient&&activeConnection?.workspaceId!==normalized.workspaceId);
  if(changing){
    const previous=activeClient!;
    try{await previous.auth.signOut({scope:'local'})}catch{/* local cleanup is best effort */}
  }
  return setActiveTenant(normalized,{remember});
}

export async function deactivateTenant({forget=true}:{forget?:boolean}={}){
  const previous=activeClient;
  if(previous){
    try{await previous.auth.signOut({scope:'local'})}catch{/* local cleanup is best effort */}
  }
  clearActiveTenant({forget});
}

export function getActiveSupabase():SupabaseClient{
  if(!activeClient)throw new Error('Selecciona primero la empresa de ZENVIA Gestión.');
  return activeClient;
}

export const supabase=new Proxy({} as SupabaseClient,{
  get(_target,property){
    const client=getActiveSupabase() as any;
    const value=Reflect.get(client,property,client);
    return typeof value==='function'?value.bind(client):value;
  },
});

export const INVOICE_BUCKET='invoices';
