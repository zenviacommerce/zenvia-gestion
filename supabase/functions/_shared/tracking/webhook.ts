export async function webhookToken(secret:string,owner:string,account:string){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return [...new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode('zenvia:shipment-tracking:'+owner+':'+account)))].map(n=>n.toString(16).padStart(2,'0')).join('')}
function equal(a:string,b:string){if(a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0}
export async function handleTrackingWebhook(req:Request,admin:any,environmentCredentials:any){
 if(req.method!=='POST')return Response.json({error:'METHOD_NOT_ALLOWED'},{status:405});
 if(Number(req.headers.get('Content-Length')||0)>65536)return Response.json({error:'TOO_LARGE'},{status:413});
 const accountId=new URL(req.url).searchParams.get('account')||'';
 if(!/^[0-9a-f-]{36}$/i.test(accountId))return Response.json({error:'UNAUTHORIZED'},{status:401});
 const {data:account,error}=await admin.from('integration_accounts').select('id,owner_id,provider,secret_id,credential_source').eq('id',accountId).eq('provider','sendcloud').eq('enabled',true).neq('status','disabled').maybeSingle();
 if(error||!account)return Response.json({error:'UNAUTHORIZED'},{status:401});
 let stored:any={};if(account.secret_id){const {data,error}=await admin.rpc('integration_read_secret',{p_secret_id:account.secret_id});if(error)return Response.json({error:'UNAUTHORIZED'},{status:401});try{stored=JSON.parse(String(data||'{}'))}catch{return Response.json({error:'UNAUTHORIZED'},{status:401})}}
 const c={...(account.credential_source==='environment'?environmentCredentials:{}),...stored};const secret=c.secretKey||c.secret_key;
 if(!secret)return Response.json({error:'UNAUTHORIZED'},{status:401});
 const expected=await webhookToken(secret,account.owner_id,account.id),provided=(req.headers.get('Authorization')||'').replace(/^Bearer /,'');
 if(!equal(expected,provided))return Response.json({error:'UNAUTHORIZED'},{status:401});
 const reader=req.body?.getReader();let total=0;const chunks:Uint8Array[]=[];
 if(reader)while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>65536){await reader.cancel();return Response.json({error:'TOO_LARGE'},{status:413})}chunks.push(value)}
 const bytes=new Uint8Array(total);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length}
 let body:any;try{body=JSON.parse(new TextDecoder().decode(bytes))}catch{return Response.json({error:'INVALID_JSON'},{status:400})}
 // Never trust pushed states; just wake authenticated polling for a known active parcel.
 if(body.event_type!=='parcels.event.created'||!['carrier','internal','calculated'].includes(body.data?.event?.event_type))return Response.json({ignored:true});
 const tracking=body.data?.parcel?.tracking_number;if(typeof tracking!=='string'||tracking.length>100)return Response.json({ignored:true});
 const fingerprint=[body.data?.event?.id||'',body.data?.event?.timestamp||'',body.data?.event?.phase||'',body.data?.event?.exception||'',tracking].join('|');
 const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(fingerprint)))].map(n=>n.toString(16).padStart(2,'0')).join('');
 const result=await admin.rpc('tracking_webhook_wake',{p_account:account.id,p_owner:account.owner_id,p_tracking:tracking,p_event_key:hash});
 if(result.error)return Response.json({error:'TRACKING_WAKE_FAILED'},{status:503});return Response.json({accepted:true});
}
