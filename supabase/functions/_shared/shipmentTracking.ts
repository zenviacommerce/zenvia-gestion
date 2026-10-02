// Provider domains identify branded pages, never individual carriers. Carrier
// destinations come exclusively from shipment metadata or provider redirects.
const providerDomains=['envia.com','sendcloud.sc','sendcloud.com'];
export function isProviderTrackingUrl(value:string){
  try{const host=new URL(value).hostname.toLowerCase();return providerDomains.some(domain=>host===domain||host.endsWith(`.${domain}`))}catch{return false}
}
export function publicTrackingUrl(value:unknown):string|null{
  if(typeof value!=='string')return null;
  try{
    const url=new URL(value.trim().replace(/&amp;/g,'&').replace(/\\\//g,'/'));
    const host=url.hostname.toLowerCase();
    if(!['https:','http:'].includes(url.protocol)||url.username||url.password)return null;
    if(!host.includes('.')||host.endsWith('.local')||host.endsWith('.internal')||/^\[|^\d+\.\d+\.\d+\.\d+$/.test(host))return null;
    return url.href;
  }catch{return null}
}
export function trackingCandidates(payload:unknown,expectedTrackingNumber=''):string[]{
  const results:string[]=[],seen=new Set<object>();
  function visit(value:unknown,depth:number){
    if(!value||typeof value!=='object'||depth>5||seen.has(value))return;
    seen.add(value);
    if(Array.isArray(value)){for(const item of value.slice(0,10))visit(item,depth+1);return}
    const record=value as Record<string,unknown>;
    const number=record.tracking_number??record.trackingNumber;
    if(expectedTrackingNumber&&number!=null&&String(number)!==expectedTrackingNumber)return;
    for(const [key,item] of Object.entries(value)){
      const normalized=key.replace(/[^a-z]/gi,'').toLowerCase();
      if(/^(?:carrier)?(?:tracking|track|trackandtrace)(?:url|link)$/.test(normalized)){
        const url=publicTrackingUrl(item);if(url)results.push(url);
      }
      if(['data','shipment','parcel','parcels','tracking','links','carrier','rawpayload'].includes(normalized))visit(item,depth+1);
    }
  }
  visit(payload,0);
  return [...new Set(results)].sort((a,b)=>Number(isProviderTrackingUrl(a))-Number(isProviderTrackingUrl(b)));
}
async function smallText(response:Response){
  if(!response.body)return '';
  const reader=response.body.getReader(),decoder=new TextDecoder();let total=0,result='';
  try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>262144)break;result+=decoder.decode(value,{stream:true})}}finally{await reader.cancel().catch(()=>{})}
  return result;
}
export async function resolveShipmentTrackingLink(payload:unknown,request:typeof fetch=fetch,expectedTrackingNumber=''):Promise<{url:string|null;status:'ready'|'unavailable'}>{
  let requests=0;
  let forwardingFallback:string|null=null;
  for(const initial of trackingCandidates(payload,expectedTrackingNumber)){
    const initialUrl=new URL(initial);
    if(initialUrl.protocol==='https:'&&initialUrl.pathname==='/forward'&&['sendcloud.com','sendcloud.sc'].some(domain=>initialUrl.hostname===domain||initialUrl.hostname.endsWith(`.${domain}`)))forwardingFallback??=initial;
    let current:string|null=initial;
    const seen=new Set<string>();
    for(let hop=0;current&&hop<5&&!seen.has(current);hop++){
      seen.add(current);
      if(!isProviderTrackingUrl(current))return {url:current,status:'ready'};
      if(new URL(current).protocol!=='https:')break;
      try{
        // Only fetch known provider origins. A carrier redirect is returned to
        // the browser intact; the server never fetches arbitrary carrier hosts.
        if(requests++>=5)break;
        const response=await request(current,{redirect:'manual',signal:AbortSignal.timeout(5000),headers:{Accept:'text/html,application/json'}});
        const location=response.headers.get('location');
        if(response.status>=300&&response.status<400&&location){current=publicTrackingUrl(new URL(location,current).href);continue}
        if(!response.ok)break;
        const body=await smallText(response);
        try{const candidates=trackingCandidates(JSON.parse(body),expectedTrackingNumber);current=candidates.find(url=>!seen.has(url))||null;if(current)continue}catch{/* Provider returned HTML. */}
        const meta=body.match(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/i)?.[0];
        const refresh=meta?.match(/content\s*=\s*["']([^"']+)["']/i)?.[1]?.match(/url\s*=\s*(.+)$/i)?.[1];
        current=refresh?publicTrackingUrl(new URL(refresh.trim(),current).href):null;
      }catch{current=null}
    }
  }
  return forwardingFallback?{url:forwardingFallback,status:'ready'}:{url:null,status:'unavailable'};
}
