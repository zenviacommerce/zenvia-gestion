import {createClient} from 'npm:@supabase/supabase-js@2.105.0';
import {handleTrackingWebhook} from '../_shared/tracking/webhook.ts';
function key(){try{const keys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}');if(keys.default)return keys.default}catch{}return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||''}
Deno.serve(async(req:Request)=>{
 const admin=createClient(Deno.env.get('SUPABASE_URL')||'',key(),{auth:{persistSession:false,autoRefreshToken:false}});
 try{return await handleTrackingWebhook(req,admin,{secretKey:Deno.env.get('SENDCLOUD_SECRET_KEY')||Deno.env.get('SENDCLOUD_API_SECRET')})}catch{return Response.json({error:'TRACKING_WEBHOOK_FAILED'},{status:503})}
});
