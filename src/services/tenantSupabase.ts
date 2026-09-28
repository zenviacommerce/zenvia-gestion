import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { TenantConnection } from './tenant';

const clients=new Map<string,SupabaseClient>();

export function tenantAuthStorageKey(connection:Pick<TenantConnection,'workspaceId'>){
  return `zenvia-gestion-auth-${connection.workspaceId}`;
}

export function getTenantSupabase(connection:TenantConnection){
  const cacheKey=`${connection.workspaceId}|${connection.url}|${connection.publishableKey}`;
  const existing=clients.get(cacheKey);
  if(existing)return existing;
  const client=createClient(connection.url,connection.publishableKey,{
    auth:{
      storageKey:tenantAuthStorageKey(connection),
      persistSession:true,
      autoRefreshToken:true,
      detectSessionInUrl:true,
      experimental:{passkey:true},
    },
  });
  clients.set(cacheKey,client);
  return client;
}
