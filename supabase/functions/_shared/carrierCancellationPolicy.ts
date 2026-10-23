export type CancellationOutcome={status:'confirmed'|'pending'|'unknown'|'rejected';message:string};
const outcome=(status:CancellationOutcome['status']):CancellationOutcome=>({status,message:status==='confirmed'?'El transportista confirmó la cancelación.':status==='pending'?'Cancelación solicitada; pendiente de confirmación del transportista.':status==='rejected'?'El transportista rechazó la cancelación. La etiqueta sigue activa.':'El resultado no está confirmado. Comprueba el estado antes de volver a solicitarlo.'});
const text=(value:unknown)=>typeof value==='string'||typeof value==='number'?String(value).trim():'';
export function parseSendcloudCancellation(httpStatus:number,payload:any):CancellationOutcome{
 if(httpStatus===202)return outcome('pending');
 const status=text(payload?.status).toLowerCase();
 if(httpStatus===200&&['cancelled','canceled'].includes(status))return outcome('confirmed');
 if(['error','rejected','failed'].includes(status)||payload?.cancelled===false)return outcome('rejected');
 if(['pending','queued','cancellation_requested','cancellation_pending','requested','in_progress'].includes(status)||payload?.cancelled===true)return outcome('pending');
 return outcome('unknown');
}
export function parseEnviaCancellation(payload:any,tracking:string,carrier:string):CancellationOutcome{
 if(payload?.meta==='error')return outcome('rejected');
 const rows=Array.isArray(payload?.data)?payload.data:[payload?.data];
 const row=rows.find((item:any)=>text(item?.trackingNumber)===tracking&&(!item?.carrier||text(item.carrier).toLowerCase()===carrier.toLowerCase()));
 if(!row)return outcome('unknown');
 const status=text(row.status).toLowerCase();
 if(['error','rejected','failed'].includes(status)||row.cancelled===false||row.canceled===false)return outcome('rejected');
 if(['pending','queued','requested','in_progress'].includes(status))return outcome('pending');
 if(payload?.meta==='cancel'||['cancelled','canceled','confirmed'].includes(status)||row.cancelled===true||row.canceled===true)return outcome('confirmed');
 return outcome('unknown');
}
// Parse only bounded, balanced XML; no DTDs, external entities or CDATA.
type ReplyNode={name:string;qualified:string;text:string;children:ReplyNode[]};
function replyXml(xml:string):ReplyNode|null{
 if(xml.length>100000||/<!DOCTYPE|<!ENTITY|<!\[CDATA\[/i.test(xml))return null;
 const root:ReplyNode={name:'',qualified:'',text:'',children:[]},stack=[root];let offset=0;
 for(const m of xml.matchAll(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<[^>]+>|[^<]+/g)){
  if(m.index!==offset)return null;offset=m.index+m[0].length;const token=m[0];
  if(token.startsWith('<!--')||token.startsWith('<?'))continue;
  if(token.startsWith('</')){const name=token.match(/^<\/([\w.:-]+)\s*>$/)?.[1];if(stack.length===1||stack.pop()!.qualified!==name)return null;}
  else if(token.startsWith('<')){const name=token.match(/^<([\w.:-]+)(?:\s[^<>]*|\s*\/?)>$/)?.[1];if(!name||stack.length>32)return null;const node:ReplyNode={name:name.split(':').pop()!,qualified:name,text:'',children:[]};stack.at(-1)!.children.push(node);if(!/\/\s*>$/.test(token))stack.push(node);}
  else stack.at(-1)!.text+=token;
 }
 return offset===xml.length&&stack.length===1&&root.children.length===1&&!root.text.trim()?root.children[0]:null;
}
function only(node:ReplyNode|undefined,name:string){const children=node?.children.filter(child=>child.name===name)||[];return children.length===1?children[0]:undefined;}
function value(node:ReplyNode|undefined){return !node?.children.length?node?.text.trim().replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'")||'':'';}
export function parseMrwCancellation(xml:string,reference:string):CancellationOutcome{
 const envelope=replyXml(xml);if(envelope?.name!=='Envelope')return outcome('unknown');
 const body=only(envelope,'Body');if(!body)return outcome('unknown');
 const fault=only(body,'Fault');if(fault)return outcome(/(?:^|:)Client$/.test(value(only(fault,'faultcode')))?'rejected':'unknown');
 const response=only(body,'CancelarEnvioResponse'),result=only(response,'CancelarEnvioResult');
 if(!result||!reference||value(only(result,'NumeroEnvio'))!==reference)return outcome('unknown');
 return outcome('confirmed');
}
