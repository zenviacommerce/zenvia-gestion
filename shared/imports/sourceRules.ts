export function gmailAttachments(payload:any){
 const result:Array<{attachmentId:string;attachmentName:string;mimeType:string;size:number;partId:string}>=[];
 function walk(part:any){
  const name=String(part.filename||''),mime=String(part.mimeType||'');
  const compatible=/\.pdf$/i.test(name)||mime==='application/pdf'||/\.(?:jpe?g|png|webp)$/i.test(name);
  const decorative=/^(?:image\d*|logo|signature|firma|icon|banner|footer|header)[_. -]/i.test(name)||(mime.startsWith('image/')&&Number(part.body?.size)<12000);
  if(name&&compatible&&!decorative&&(part.body?.attachmentId||part.body?.data))result.push({attachmentId:part.body.attachmentId||`inline:${part.partId}`,attachmentName:name,mimeType:mime,size:Number(part.body?.size)||0,partId:String(part.partId||'')});
  for(const child of part.parts||[])walk(child);
 }
 walk(payload);return result;
}
export function persistentGmailReady(account:any,stored:any,clientId:string){return Boolean(account?.credential_source==='vault'&&stored?.refreshToken&&clientId&&stored.clientId===clientId);}
