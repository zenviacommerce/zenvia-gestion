const encoder=new TextEncoder();
const hex=(bytes:ArrayBuffer)=>Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,'0')).join('');
const key=(secret:string)=>crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
const canonical=async(raw:string,keyId:string,time:string,nonce:string)=>`${keyId}\n${time}\n${nonce}\n${hex(await crypto.subtle.digest('SHA-256',encoder.encode(raw)))}`;
export async function signShadow(raw:string,keyId:string,secret:string,now=Date.now(),nonce=crypto.randomUUID()){
 const time=String(now);const data=await canonical(raw,keyId,time,nonce);
 return {'Content-Type':'application/json','x-shadow-key-id':keyId,'x-shadow-time':time,'x-shadow-nonce':nonce,'x-shadow-signature':hex(await crypto.subtle.sign('HMAC',await key(secret),encoder.encode(data)))};
}
export async function verifyShadow(req:Request,raw:string,keyId:string,secret:string,now=Date.now()):Promise<string|null>{
 const time=req.headers.get('x-shadow-time')||'',nonce=req.headers.get('x-shadow-nonce')||'',signature=req.headers.get('x-shadow-signature')||'';
 if(!secret||req.headers.get('x-shadow-key-id')!==keyId||!/^[0-9]{13}$/.test(time)||Math.abs(now-Number(time))>300000
 ||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(nonce)||!/^[0-9a-f]{64}$/i.test(signature)||encoder.encode(raw).byteLength>262144)return null;
 const bytes=new Uint8Array(signature.match(/../g)!.map(s=>parseInt(s,16)));
 return await crypto.subtle.verify('HMAC',await key(secret),bytes,encoder.encode(await canonical(raw,keyId,time,nonce)))?nonce:null;
}
export function secureEqual(a:string,b:string){if(!a||!b||a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0;}
export async function readLimitedBody(req:Request){
 const reader=req.body?.getReader();if(!reader)return '';const chunks:Uint8Array[]=[];let size=0;
 for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>262144){await reader.cancel();throw new Error('BODY_TOO_LARGE');}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return new TextDecoder().decode(bytes);
}
