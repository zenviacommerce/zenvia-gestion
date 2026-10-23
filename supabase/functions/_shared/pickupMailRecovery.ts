type Entry={sender:string;rfcMessageId:string;requestId:string};
type Result={status:'sent';messageId:string}|{status:'absent'}|{status:'unconfirmed';code:string};
export async function pickupGmailProfile(fetcher:typeof fetch,token:string){
 const r=await fetcher('https://gmail.googleapis.com/gmail/v1/users/me/profile',{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(10000)});
 if(!r.ok)throw Error(r.status===401||r.status===403?'GMAIL_SCOPE_REQUIRED':'GMAIL_LOOKUP_FAILED');
 const data=await r.json();if(typeof data.emailAddress!=='string'||!data.emailAddress.includes('@'))throw Error('GMAIL_LOOKUP_FAILED');return data.emailAddress.trim().toLowerCase();
}
/** Read-only provider check. Absence is an observation; only the SQL state machine can release a retry. */
export async function reconcilePickupGmail(fetcher:typeof fetch,token:string,entry:Entry):Promise<Result>{
 try{
  if(!entry.rfcMessageId||!entry.sender)return{status:'unconfirmed',code:'GMAIL_LEGACY_UNCONFIRMED'};
  if(await pickupGmailProfile(fetcher,token)!==entry.sender.toLowerCase())return{status:'unconfirmed',code:'GMAIL_MAILBOX_MISMATCH'};
  const get=async(url:string)=>{const response=await fetcher(url,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error(response.status===401||response.status===403?'GMAIL_SCOPE_REQUIRED':'GMAIL_LOOKUP_FAILED');return response.json()};
  const url=new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');url.searchParams.set('q','in:sent rfc822msgid:'+entry.rfcMessageId);url.searchParams.set('includeSpamTrash','true');url.searchParams.set('maxResults','10');
  const found=await get(url.href);if(!found||typeof found!=='object'||found.error||found.nextPageToken||found.messages!==undefined&&!Array.isArray(found.messages))throw Error('GMAIL_LOOKUP_INCOMPLETE');
  if(!found.messages?.length){if(found.resultSizeEstimate!==0)throw Error('GMAIL_LOOKUP_INCOMPLETE');return{status:'absent'}};
  for(const m of found.messages){
   if(typeof m.id!=='string'||!/^[A-Za-z0-9_-]{1,200}$/.test(m.id))throw Error('GMAIL_LOOKUP_INCOMPLETE');
   const message=await get('https://gmail.googleapis.com/gmail/v1/users/me/messages/'+encodeURIComponent(m.id)+'?format=metadata&metadataHeaders=Message-ID&metadataHeaders=X-Zenvia-Pickup-Request');
   const headers=message.payload?.headers;if(!Array.isArray(headers)||!Array.isArray(message.labelIds))throw Error('GMAIL_LOOKUP_INCOMPLETE');
   const header=(name:string)=>headers.find((h:any)=>String(h.name).toLowerCase()===name)?.value;
   if(message.id===m.id&&message.labelIds.includes('SENT')&&header('message-id')===entry.rfcMessageId&&header('x-zenvia-pickup-request')===entry.requestId)return{status:'sent',messageId:m.id};
  }
  return{status:'unconfirmed',code:'GMAIL_LOOKUP_MISMATCH'};
 }catch(error){const code=error instanceof Error&&/^GMAIL_[A-Z_]+$/.test(error.message)?error.message:'GMAIL_LOOKUP_FAILED';return{status:'unconfirmed',code}};
}
