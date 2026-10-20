import {getActiveSupabase,getActiveTenant} from './supabase';

// Realtime is an acceleration; visible polling recovers missed ingestion events.
// refresh reads the tenant database only, never the external Shopify API.
export function watchShopifyAnalytics(refresh:()=>void|Promise<void>){
 let alive=true,timer:number|undefined,busy=false,pending=false,unbind=()=>{};
 const visible=()=>document.visibilityState!=='hidden';
 const schedule=()=>{
  if(!alive||!visible())return;
  if(timer!==undefined)window.clearTimeout(timer);
  timer=window.setTimeout(()=>{timer=undefined;void run();},250);
 };
 const run=async()=>{
  if(!alive||!visible())return;
  if(busy){pending=true;return;}
  busy=true;
  try{await refresh();}catch{/* retained data remains visible; next event/poll retries */}
  finally{busy=false;if(pending){pending=false;schedule();}}
 };
 const bind=()=>{
  unbind();if(timer!==undefined){window.clearTimeout(timer);timer=undefined;}pending=false;
  const workspace=getActiveTenant()?.workspace_id;
  if(!workspace)return;
  const client=getActiveSupabase();let current=true;
  const changed=()=>{if(current&&getActiveTenant()?.workspace_id===workspace&&getActiveSupabase()===client)schedule();};
  const channel=client.channel('shopify-analytics-'+crypto.randomUUID());
  for(const table of ['fulfillment_orders','shopify_analytics_orders'])channel.on('postgres_changes',{event:'*',schema:'public',table,filter:`owner_id=eq.${workspace}`},changed);
  channel.subscribe(status=>{if(status==='SUBSCRIBED')changed();});
  unbind=()=>{current=false;void client.removeChannel(channel);};
 };
 bind();
 const events=['zenvia:orders-refresh','zenvia:shopify-analytics-updated','zenvia:analytics-update','focus'];
 for(const event of events)window.addEventListener(event,schedule);
 document.addEventListener('visibilitychange',schedule);
 window.addEventListener('zenvia:tenant-changed',bind);
 const fallback=window.setInterval(schedule,25000);
 return()=>{alive=false;unbind();if(timer!==undefined)window.clearTimeout(timer);window.clearInterval(fallback);for(const event of events)window.removeEventListener(event,schedule);document.removeEventListener('visibilitychange',schedule);window.removeEventListener('zenvia:tenant-changed',bind);};
}
