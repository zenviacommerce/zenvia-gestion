import {readAmazonLwaApplication} from './apps.ts';
export type OAuthContinuation={amazonCallbackUri:string;amazonState:string;sellingPartnerId:string};
export type AmazonOAuthConfig={enabled:false}|{enabled:true;applicationId:string;redirectUri:string;uiOrigin:string;uiReturnUrl:string;mode:'draft'|'published';signingKey:string;clientId:string;clientSecret:string};
export type EnabledAmazonOAuthConfig=Extract<AmazonOAuthConfig,{enabled:true}>;
const host='sellercentral-europe.amazon.com';
export function validAmazonSeller(value:unknown):value is string{return typeof value==='string'&&/^[A-Z0-9]{1,64}$/.test(value);}
function safeHttps(value:string):URL{if(/[\s\x00-\x1f\x7f]/.test(value))throw Error();const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.hash||u.port)throw Error();return u;}
export function readAmazonOAuthConfig(envGet:(name:string)=>string|undefined):AmazonOAuthConfig{
  try{
    if(envGet('AMAZON_PUBLIC_OAUTH_ENABLED')!=='true')return {enabled:false};
    const read=(k:string)=>{const v=envGet(k);if(!v||v!==v.trim())throw Error();return v;};
    const applicationId=read('AMAZON_PUBLIC_APPLICATION_ID');if(!/^amzn1\.sellerapps\.app\.[A-Za-z0-9-]{1,100}$/.test(applicationId))throw Error();
    const redirectUri=read('AMAZON_PUBLIC_OAUTH_REDIRECT_URI');const redirect=safeHttps(redirectUri);if(redirect.pathname!=='/functions/v1/amazon-oauth-callback'||redirect.search)throw Error();
    const uiOrigin=read('AMAZON_PUBLIC_OAUTH_UI_ORIGIN');if(safeHttps(uiOrigin).origin!==uiOrigin)throw Error();
    const mode=read('AMAZON_PUBLIC_OAUTH_MODE');if(mode!=='draft'&&mode!=='published')throw Error();
    const signingKey=read('AMAZON_OAUTH_STATE_SIGNING_KEY');if(new TextEncoder().encode(signingKey).length<32)throw Error();
    const {clientId,clientSecret}=readAmazonLwaApplication('public_v1',envGet);
    return {enabled:true,applicationId,redirectUri,uiOrigin,uiReturnUrl:uiOrigin+'/?page=settings&section=integrations',mode,signingKey,clientId,clientSecret};
  }catch{return {enabled:false};}
}
export function validateAmazonContinuation(input:unknown,applicationId:string):OAuthContinuation{
  try{
    if(!input||typeof input!=='object'||Array.isArray(input))throw Error();const p=input as OAuthContinuation;
    if(Object.keys(p).sort().join(',')!=='amazonCallbackUri,amazonState,sellingPartnerId'||typeof p.amazonCallbackUri!=='string'||p.amazonCallbackUri.length>8192||typeof p.amazonState!=='string'||!p.amazonState||p.amazonState.length>2048||/[\x00-\x1f\x7f]/.test(p.amazonState)||!validAmazonSeller(p.sellingPartnerId))throw Error();
    const u=safeHttps(p.amazonCallbackUri);if(u.hostname!==host||u.pathname!=='/apps/authorize/confirm/'+applicationId||u.search||u.href!==p.amazonCallbackUri)throw Error();
    return {amazonCallbackUri:p.amazonCallbackUri,amazonState:p.amazonState,sellingPartnerId:p.sellingPartnerId};
  }catch{throw new Error('Invalid Amazon authorization continuation.');}
}
export function buildAmazonConsentUrl(config:EnabledAmazonOAuthConfig,state:string,continuation?:OAuthContinuation):string{
  const c=continuation?validateAmazonContinuation(continuation,config.applicationId):null;
  const url=new URL(c?c.amazonCallbackUri:'https://'+host+'/apps/authorize/consent');
  if(c){url.searchParams.set('amazon_state',c.amazonState);url.searchParams.set('redirect_uri',config.redirectUri);}else url.searchParams.set('application_id',config.applicationId);
  url.searchParams.set('state',state);if(config.mode==='draft')url.searchParams.set('version','beta');return url.href;
}
