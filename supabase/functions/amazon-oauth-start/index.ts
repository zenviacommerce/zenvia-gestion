import {createClient} from 'npm:@supabase/supabase-js@2';
import {createAmazonOAuthHumanRpc} from '../_shared/amazon/oauth-auth.ts';
import {handleAmazonOAuthStart} from '../_shared/amazon/oauth-flow.ts';
const envGet=(key:string)=>Deno.env.get(key);
function adminKey(){const keys=envGet('SUPABASE_SECRET_KEYS');if(keys){try{const value=JSON.parse(keys)?.default;if(typeof value==='string'&&value.trim())return value.trim();}catch{/* Legacy service-role configuration below. */}}return envGet('SUPABASE_SERVICE_ROLE_KEY')||'';}
Deno.serve(async(req:Request)=>{
  // The GET launch has no JWT. POST always verifies Auth inside the handler.
  // Construct lazily so disabled/missing configuration never needs a credential.
  let admin:any;const lazyAdmin=new Proxy({}, {get(_target,key){admin??=createClient(envGet('SUPABASE_URL')||'',adminKey(),{auth:{persistSession:false,autoRefreshToken:false}});const value=admin[key];return typeof value==='function'?value.bind(admin):value;}});
  return await handleAmazonOAuthStart(req,{admin:lazyAdmin,humanRpc:createAmazonOAuthHumanRpc(createClient,envGet),fetch,now:Date.now,envGet,randomBytes:n=>crypto.getRandomValues(new Uint8Array(n))});
});
