import type { SupabaseClient } from '@supabase/supabase-js';
import {
  clearRememberedTenantConnection,
  normalizeTenantConnection,
  readRememberedTenantConnection,
  rememberTenantConnection,
  type TenantConnection,
} from './tenant';
import { getTenantSupabase } from './tenantSupabase';

let activeConnection:TenantConnection|null=readRememberedTenantConnection();
let activeClient:SupabaseClient|null=activeConnection?getTenantSupabase(activeConnection):null;

export function getActiveTenantConnection(){
  return activeConnection;
}

export function hasActiveTenant(){
  return Boolean(activeConnection&&activeClient);
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
  return activeClient!;
}

export function clearActiveTenant({forget=false}:{forget?:boolean}={}){
  try{activeClient?.auth.stopAutoRefresh()}catch{/* best effort */}
  activeConnection=null;
  activeClient=null;
  if(forget)clearRememberedTenantConnection();
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
