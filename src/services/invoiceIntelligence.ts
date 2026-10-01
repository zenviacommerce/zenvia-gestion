import { supabase } from './supabase';
import type { NewInvoiceLineInput } from '../types';
import type { InvoiceReadResult } from './invoiceReader';

export type InvoiceIntelligenceMode='expense'|'sales';
export type InvoicePartyAI={
  name:string|null;taxId:string|null;email:string|null;phone:string|null;address:string|null;countryCode:string|null;
};
type IntelligenceResponse={
  ok?:boolean;model?:string;
  extraction?:{
    documentKind:'invoice'|'credit_note'|'not_invoice'|'unknown';
    issuer:InvoicePartyAI;recipient:InvoicePartyAI;
    invoiceNumber:string|null;issueDate:string|null;dueDate:string|null;currency:string|null;
    amounts:{subtotal:number|null;vat:number|null;equivalenceSurcharge:number|null;withholding:number|null;total:number|null};
    lines:Array<{description:string;quantity:number|null;unit:string|null;unitPrice:number|null;discountPercent:number|null;taxRate:number|null;lineNet:number|null;lineTotal:number|null;evidenceQuote:string}>;
    confidence:number;warnings:string[];
  };
  verification?:{
    support:Record<string,boolean>;fiscalConsistent:boolean;
    verifiedLines:Array<any>;warnings:string[];
  };
  error?:string;code?:string;
};

function finite(value:unknown){const number=Number(value);return Number.isFinite(number)?number:null;}
function clean(value:unknown){return typeof value==='string'?value.trim():'';}
async function fileAsDataUrl(file:File){
  if(file.size>9.5*1024*1024)return '';
  return await new Promise<string>((resolve,reject)=>{
    const reader=new FileReader();
    reader.onerror=()=>reject(reader.error||new Error('No se pudo preparar el documento para IA.'));
    reader.onload=()=>resolve(typeof reader.result==='string'?reader.result:'');
    reader.readAsDataURL(file);
  });
}
function supported(response:IntelligenceResponse,field:string){return response.verification?.support?.[field]===true;}
function verifiedParty(response:IntelligenceResponse,prefix:'issuer'|'recipient',party:InvoicePartyAI):InvoicePartyAI{
  const value=(field:keyof InvoicePartyAI)=>supported(response,prefix+'.'+field)?clean(party?.[field])||null:null;
  return {name:value('name'),taxId:value('taxId'),email:value('email'),phone:value('phone'),address:value('address'),countryCode:value('countryCode')};
}
function validDate(value:string){return /^\\d{4}-\\d{2}-\\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value+'T12:00:00Z'));}
function validCurrency(value:string){return /^[A-Z]{3}$/.test(value);}
function verifiedLines(response:IntelligenceResponse):NewInvoiceLineInput[]{
  return (response.verification?.verifiedLines||[])
    .filter(line=>line?.verified&&clean(line?.description).length>=2)
    .map(line=>{
      const quantity=finite(line.quantity)??1;
      const unitPrice=finite(line.unitPrice);
      const lineNet=finite(line.lineNet);
      const lineTotal=finite(line.lineTotal);
      const taxRate=finite(line.taxRate);
      const taxAmount=lineNet!=null&&taxRate!=null?Math.round(lineNet*taxRate)/100:null;
      return {
        description:clean(line.description).slice(0,500),
        quantity:quantity>0?quantity:1,
        unit:clean(line.unit)||null,
        unitPrice:unitPrice!=null&&unitPrice>=0?unitPrice:null,
        lineNet:lineNet!=null&&lineNet>=0?lineNet:null,
        taxRate:taxRate!=null&&taxRate>=0&&taxRate<=100?taxRate:null,
        taxAmount,
        lineTotal:lineTotal!=null&&lineTotal>=0?lineTotal:null,
      } satisfies NewInvoiceLineInput;
    });
}
export async function analyzeInvoiceWithIntelligence(
  file:File|undefined,
  deterministic:InvoiceReadResult,
  mode:InvoiceIntelligenceMode,
):Promise<InvoiceReadResult>{
  let fileData='';
  if(file&&(/pdf/i.test(file.type)||file.type.startsWith('image/'))){
    try{fileData=await fileAsDataUrl(file)}catch{}
  }
  let data:IntelligenceResponse|null=null;
  try{
    const {data:payload,error}=await supabase.functions.invoke('invoice-document-intelligence',{
      body:{mode,text:deterministic.text,fileName:file?.name||'documento',mimeType:file?.type||'text/plain',fileData:fileData||undefined},
    });
    if(error)return {...deterministic,analysisEngine:'deterministic',analysisWarnings:['IA documental no disponible: '+error.message]};
    data=payload as IntelligenceResponse;
  }catch(error){
    return {...deterministic,analysisEngine:'deterministic',analysisWarnings:['IA documental no disponible: '+(error instanceof Error?error.message:'error de conexión')]};
  }
  if(!data?.ok||!data.extraction||!data.verification){
    const detail=clean(data?.error)||'El analizador IA no devolvió una extracción válida.';
    return {...deterministic,analysisEngine:'deterministic',analysisWarnings:[detail]};
  }

  const extracted=data.extraction,verification=data.verification;
  const next:InvoiceReadResult={
    ...deterministic,
    analysisEngine:'hybrid-ai-verified',
    analysisModel:data.model,
    analysisWarnings:[...(verification.warnings||[])],
    aiIssuer:verifiedParty(data,'issuer',extracted.issuer),
    aiRecipient:verifiedParty(data,'recipient',extracted.recipient),
    aiDueDate:supported(data,'dueDate')&&validDate(clean(extracted.dueDate))?clean(extracted.dueDate):undefined,
  };

  if(supported(data,'invoiceNumber')&&clean(extracted.invoiceNumber))next.invoiceNumber=clean(extracted.invoiceNumber);
  if(supported(data,'issueDate')&&validDate(clean(extracted.issueDate)))next.invoiceDate=clean(extracted.issueDate);
  if(supported(data,'currency')&&validCurrency(clean(extracted.currency).toUpperCase()))next.currency=clean(extracted.currency).toUpperCase();
  if(mode==='expense'&&supported(data,'issuer.name')&&clean(extracted.issuer?.name))next.supplierName=clean(extracted.issuer.name);

  if(verification.fiscalConsistent){
    const amounts=extracted.amounts||{} as any;
    if(supported(data,'amounts.subtotal')&&finite(amounts.subtotal)!=null)next.subtotal=finite(amounts.subtotal)!;
    if(supported(data,'amounts.vat')&&finite(amounts.vat)!=null)next.vat=finite(amounts.vat)!;
    if(supported(data,'amounts.withholding')&&finite(amounts.withholding)!=null)next.withholding=finite(amounts.withholding)!;
    if(supported(data,'amounts.total')&&finite(amounts.total)!=null)next.total=finite(amounts.total)!;
    const surcharge=finite(amounts.equivalenceSurcharge);
    if(supported(data,'amounts.equivalenceSurcharge')&&surcharge!=null)next.aiEquivalenceSurcharge=surcharge;
  }

  const lines=verifiedLines(data);
  if(lines.length)next.lines=lines;
  next.confidence=Math.max(deterministic.confidence,Math.min(.99,Math.max(0,Number(extracted.confidence)||0)));
  return next;
}
