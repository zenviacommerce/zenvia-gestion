// @vitest-environment jsdom
// Offline reproduction with real supabase-js; synthetic server, no live tokens.
import {it,expect} from 'vitest';
import {createClient} from '@supabase/supabase-js';
for(const scope of [undefined,'local'] as const){
 it(`real SDK ${scope??'default global'} logout ${scope?'preserves':'revokes'} the other device`,async()=>{
  const valid=new Set(['desktop','phone']);const requests:string[]=[];const keys={desktop:`${scope??'default'}-desktop`,phone:`${scope??'default'}-phone`};
  const storage=()=>{const m=new Map<string,string>();return {getItem:(k:string)=>m.get(k)??null,setItem:(k:string,v:string)=>{m.set(k,v)},removeItem:(k:string)=>{m.delete(k)}}};
  const stores={desktop:storage(),phone:storage()};
  const user={id:'00000000-0000-4000-8000-000000000001',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-10-19T00:00:00Z'};
  const session=(id:string)=>({access_token:id,refresh_token:id,token_type:'bearer',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,user});
  const clients=Object.fromEntries((['desktop','phone'] as const).map(id=>{
   stores[id].setItem(keys[id],JSON.stringify(session(id)));
   return [id,createClient('https://offline.invalid','synthetic-key',{auth:{storage:stores[id],storageKey:keys[id],persistSession:true,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:async(input,init)=>{
    const url=new URL(String(input));requests.push(url.pathname+url.search);
    if(url.pathname.endsWith('/logout')){if(url.searchParams.get('scope')==='global')valid.clear();else valid.delete(id);return new Response(null,{status:204});}
    if(url.pathname.endsWith('/token')){const token=JSON.parse(String(init?.body)).refresh_token;return new Response(JSON.stringify(valid.has(token)?session(token):{code:'refresh_token_not_found',msg:'Invalid Refresh Token: Refresh Token Not Found'}),{status:valid.has(token)?200:400,headers:{'content-type':'application/json','x-supabase-api-version':'2024-01-01'}});}
    throw new Error('Unexpected offline request '+url.pathname);
   }}})];
  }));
  try{
   await Promise.all(Object.values(clients).map(c=>c.auth.getSession()));
   await clients.phone.auth.signOut(scope?{scope}:undefined);
   expect(requests[0]).toBe('/auth/v1/logout?scope='+(scope??'global'));
   const refreshed=await clients.desktop.auth.refreshSession();
   if(scope){expect(refreshed.error).toBeNull();expect(stores.desktop.getItem(keys.desktop)).not.toBeNull();}
   else{expect(refreshed.error?.code).toBe('refresh_token_not_found');expect(stores.desktop.getItem(keys.desktop)).toBeNull();}
  }finally{for(const c of Object.values(clients)){await c.auth.stopAutoRefresh();}}
 });
}
