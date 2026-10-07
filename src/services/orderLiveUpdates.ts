import {supabase} from './supabase';

// Realtime respects the workspace SELECT policies; polling recovers missed events.
export function watchFulfillmentOrders(refresh:()=>void){
  let timer:number|undefined;
  let alive=true;
  const schedule=()=>{
    if(!alive)return;
    if(timer!==undefined)window.clearTimeout(timer);
    timer=window.setTimeout(()=>{timer=undefined;if(alive)refresh();},250);
  };
  const channel=supabase.channel('fulfillment-orders-'+crypto.randomUUID())
    .on('postgres_changes',{event:'*',schema:'public',table:'fulfillment_orders'},schedule)
    .subscribe(status=>{if(status==='SUBSCRIBED')schedule();});
  window.addEventListener('zenvia:orders-refresh',schedule);
  window.addEventListener('focus',schedule);
  const fallback=window.setInterval(schedule,15000);
  return()=>{
    alive=false;
    if(timer!==undefined)window.clearTimeout(timer);
    window.clearInterval(fallback);
    window.removeEventListener('zenvia:orders-refresh',schedule);
    window.removeEventListener('focus',schedule);
    void supabase.removeChannel(channel);
  };
}
