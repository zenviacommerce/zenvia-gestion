import {createClient} from 'npm:@supabase/supabase-js@2';
import {assertMfaWithClient} from './mfa-policy.ts';
export {assertBridgeMfaAllowed} from './mfa-policy.ts';

function getAdminKey(){
  try{const keys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}');if(typeof keys.default==='string'&&keys.default.trim())return keys.default.trim();}catch{/* legacy fallback */}
  return (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'').trim();
}
export async function assertHumanMfa(req:Request,recent=false){
  return assertMfaWithClient(req,recent,(token)=>{
    const url=(Deno.env.get('SUPABASE_URL')||'').trim();
    const key=(Deno.env.get('SUPABASE_ANON_KEY')||'').trim()||getAdminKey();
    if(!url||!key)throw new Error('MFA_UNAVAILABLE');
    // PostgREST must receive the human token even when the API key is privileged.
    return createClient(url,key,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false,autoRefreshToken:false}});
  });
}
