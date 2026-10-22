import {getActiveSupabase,getActiveTenant} from './supabase';

// One visible fallback per page. Events invalidate persisted data; they never
// trigger carrier requests. Hidden tabs release their WAL subscription entirely.
export function watchFulfillmentOrders(refresh:()=>unknown|Promise<unknown>,refreshMs=60000){
 let alive=true,timer:number|undefined,busy=false,pending=false,unbind=()=>{};
 const visible=()=>document.visibilityState==='visible';
 const schedule=()=>{
  if(!alive||!visible())return;
  if(timer!==undefined)window.clearTimeout(timer);
  timer=window.setTimeout(()=>{timer=undefined;void run();},250);
 };
 const run=async()=>{
  if(!alive||!visible())return;
  if(busy){pending=true;return;}
  busy=true;
  try{await refresh();}catch{/* Keep persisted data; the next invalidation retries. */}
  finally{busy=false;if(pending){pending=false;schedule();}}
 };
 const bind=()=>{
  unbind();if(timer!==undefined){window.clearTimeout(timer);timer=undefined;}pending=false;
  const workspace=getActiveTenant()?.workspace_id;
  if(!alive||!visible()||!workspace)return;
  const client=getActiveSupabase();let current=true;
  const changed=()=>{if(current&&getActiveTenant()?.workspace_id===workspace&&getActiveSupabase()===client)schedule();};
  const channel=client.channel('fulfillment-orders-'+crypto.randomUUID())
   .on('postgres_changes',{event:'*',schema:'public',table:'fulfillment_orders',filter:`owner_id=eq.${workspace}`},changed)
   .subscribe();
  unbind=()=>{current=false;void client.removeChannel(channel);unbind=()=>{};};
 };
 const visibilityChanged=()=>{bind();schedule();};
 bind();
 for(const event of ['zenvia:orders-refresh','focus'])window.addEventListener(event,schedule);
 document.addEventListener('visibilitychange',visibilityChanged);
 window.addEventListener('zenvia:tenant-changed',bind);
 const fallback=window.setInterval(schedule,Math.max(60000,Number.isFinite(refreshMs)?refreshMs:60000));
 return()=>{alive=false;unbind();if(timer!==undefined)window.clearTimeout(timer);window.clearInterval(fallback);for(const event of ['zenvia:orders-refresh','focus'])window.removeEventListener(event,schedule);document.removeEventListener('visibilitychange',visibilityChanged);window.removeEventListener('zenvia:tenant-changed',bind);};
}
