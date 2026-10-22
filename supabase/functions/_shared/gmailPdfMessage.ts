export type GmailPdfMessage={to:string;cc?:string;subject:string;body:string;pdf:Uint8Array;filename:string};
const email=/^[^\s@<>;,\r\n]+@[^\s@<>;,\r\n]+\.[^\s@<>;,\r\n]{2,}$/;
export const validMailAddress=(value:string)=>value.length<=254&&email.test(value);
function base64(bytes:Uint8Array){let binary='';for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(binary)}
const encoded=(value:string)=>`=?UTF-8?B?${base64(new TextEncoder().encode(value))}?=`;
export function buildGmailPdfMessage(input:GmailPdfMessage):string{
 if(!validMailAddress(input.to)||input.cc&&!validMailAddress(input.cc))throw new Error('El destinatario no es válido.');
 if(!input.subject.trim()||input.subject.length>998||/[\r\n]/.test(input.subject))throw new Error('El asunto no es válido.');
 if(!/^[A-Za-z0-9_.-]+\.pdf$/i.test(input.filename)||input.filename.includes('..'))throw new Error('El nombre del PDF no es válido.');
 if(input.body.length>1_000_000||input.pdf.byteLength>25*1024*1024)throw new Error('El mensaje o PDF supera el límite.');
 const boundary='zenvia_'+crypto.randomUUID().replaceAll('-','');
 const headers=[`To: ${input.to}`,...(input.cc?[`Cc: ${input.cc}`]:[]),`Subject: ${encoded(input.subject)}`,'MIME-Version: 1.0',`Content-Type: multipart/mixed; boundary="${boundary}"`];
 const mime=[...headers,'',`--${boundary}`,'Content-Type: text/plain; charset="UTF-8"','Content-Transfer-Encoding: 8bit','',input.body,'',`--${boundary}`,`Content-Type: application/pdf; name="${input.filename}"`,'Content-Transfer-Encoding: base64',`Content-Disposition: attachment; filename="${input.filename}"`,'',base64(input.pdf).replace(/(.{76})/g,'$1\r\n'),`--${boundary}--`,''].join('\r\n');
 return base64(new TextEncoder().encode(mime)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
}
