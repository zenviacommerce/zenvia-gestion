// Capture Shopify's authorization code before React mounts, and immediately
// remove it from the browser URL/history. Exchange it only with authenticated
// ZENVIA Supabase Edge Function; never log it or persist it to localStorage.
let pendingQuery:string|null=null;
let denied=false;
if(typeof window!=='undefined'){
  const url=new URL(window.location.href);
  const params=url.searchParams;
  const fromShopify=Boolean(params.get('shop')&&params.get('state')&&(params.get('code')||params.get('error')));
  if(fromShopify){
    denied=Boolean(params.get('error'));
    pendingQuery=params.toString();
    for(const key of ['code','hmac','shop','state','timestamp','host','signature','error','error_description'])params.delete(key);
    window.history.replaceState(window.history.state,'',url.pathname+url.search+url.hash);
  }
}
export function getShopifyOAuthCallback(){return pendingQuery}
export function clearShopifyOAuthCallback(){pendingQuery=null;denied=false}
export function shopifyOAuthWasDenied(){return denied}
