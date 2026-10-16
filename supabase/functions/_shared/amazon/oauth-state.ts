export type StatePayload={v:1;nonce:string;iat:number;exp:number;app:'public_v1';purpose:'connect'};
const encoder=new TextEncoder();
const invalid=()=>new Error('Invalid Amazon authorization state.');
export function encodeOAuthBytes(bytes:Uint8Array):string{return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function decode(value:string):Uint8Array{
  if(!/^[A-Za-z0-9_-]+$/.test(value))throw invalid();
  const raw=atob(value.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-value.length%4)%4));
  const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
  if(encodeOAuthBytes(bytes)!==value)throw invalid();return bytes;
}
function checked(p:any):StatePayload{
  if(!p||Object.keys(p).sort().join(',')!=='app,exp,iat,nonce,purpose,v'||p.v!==1||p.app!=='public_v1'||p.purpose!=='connect'||!Number.isSafeInteger(p.iat)||p.iat<0||!Number.isSafeInteger(p.exp)||p.exp!==p.iat+600||typeof p.nonce!=='string'||p.nonce.length!==43||decode(p.nonce).length!==32)throw invalid();
  return {v:1,nonce:p.nonce,iat:p.iat,exp:p.exp,app:'public_v1',purpose:'connect'};
}
async function key(value:string){if(typeof value!=='string'||encoder.encode(value).length<32)throw invalid();return await crypto.subtle.importKey('raw',encoder.encode(value),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);}
export async function signAmazonState(payload:StatePayload,signingKey:string):Promise<string>{
  const body=encodeOAuthBytes(encoder.encode(JSON.stringify(checked(payload))));
  const signature=await crypto.subtle.sign('HMAC',await key(signingKey),encoder.encode('v1.'+body));
  return 'v1.'+body+'.'+encodeOAuthBytes(new Uint8Array(signature));
}
export async function verifyAmazonState(state:string,signingKey:string,nowMs:number):Promise<StatePayload>{
  try{
    if(typeof state!=='string'||state.length>2048)throw invalid();const parts=state.split('.');
    if(parts.length!==3||parts[0]!=='v1')throw invalid();const sig=decode(parts[2]);if(sig.length!==32)throw invalid();
    if(!await crypto.subtle.verify('HMAC',await key(signingKey),sig,encoder.encode('v1.'+parts[1])))throw invalid();
    const json=new TextDecoder('utf-8',{fatal:true}).decode(decode(parts[1]));const p=checked(JSON.parse(json));
    if(JSON.stringify(p)!==json||!Number.isFinite(nowMs)||p.iat>Math.floor(nowMs/1000)||Math.floor(nowMs/1000)>=p.exp)throw invalid();return p;
  }catch{throw invalid();}
}
export async function hashOAuthValue(value:string):Promise<string>{return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value))),v=>v.toString(16).padStart(2,'0')).join('');}
