import { getActiveTenant, supabase } from './supabase';

export type OAuthContinuation={amazonCallbackUri:string;amazonState:string;sellingPartnerId:string};
export type OAuthStartInput={workspaceId?:string;integrationAccountId?:string;continuation?:OAuthContinuation};
const UNAVAILABLE='No se pudo iniciar la autorización de Amazon. Vuelve a intentarlo.';

export function validateAmazonLaunchUrl(value:unknown,backendUrl:string):string{
  try{
    if(typeof value!=='string'||value.length>8192||/[\r\n]/.test(value))throw new Error();
    const backend=new URL(backendUrl),url=new URL(value);
    if(url.protocol!=='https:'||url.origin!==backend.origin||url.username||url.password||url.hash||url.pathname!=='/functions/v1/amazon-oauth-start')throw new Error();
    const keys=[...url.searchParams.keys()];
    if(keys.length!==2||url.searchParams.getAll('ticket').length!==1||url.searchParams.getAll('state').length!==1||!url.searchParams.get('ticket')||!url.searchParams.get('state'))throw new Error();
    return url.href;
  }catch{throw new Error(UNAVAILABLE)}
}

export async function loadAmazonOAuthCapability():Promise<{enabled:boolean}>{
  const abort=new AbortController();
  const timer=setTimeout(()=>abort.abort(),5000);
  try{
    const {data,error}=await supabase.functions.invoke('integration-accounts',{body:{action:'amazon_oauth_capability'},signal:abort.signal});
    return {enabled:!error&&data?.enabled===true};
  }catch{return {enabled:false}}
  finally{clearTimeout(timer)}
}

export async function beginAmazonAuthorization(input:OAuthStartInput={}):Promise<string>{
  // Capture the tenant before awaiting: a tenant switch must not validate a launch from another backend.
  const backend=getActiveTenant()?.supabase_url;
  if(!backend)throw new Error(UNAVAILABLE);
  try{
    const {data,error}=await supabase.functions.invoke('amazon-oauth-start',{body:input});
    if(error||getActiveTenant()?.supabase_url!==backend)throw new Error();
    return validateAmazonLaunchUrl(data?.launchUrl,backend);
  }catch{throw new Error(UNAVAILABLE)}
}
