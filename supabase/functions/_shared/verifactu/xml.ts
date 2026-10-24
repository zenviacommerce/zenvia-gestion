import {buildAltaHashInput,buildAnulacionHashInput,sha256Hex,type AltaHashFields,type AnulacionHashFields} from './hash.ts';

export type ShadowRecord={id:string;owner_id:string;issuer_nif:string;installation_id:string;invoice_id:string;sequence:number;record_kind:'alta'|'anulacion';alta_record_id?:string|null;hash_fields:Record<string,string>;hash_input:string;hash:string;snapshot:{invoice?:Record<string,any>;lines?:Record<string,any>[];altaRecordId?:string;invoiceId?:string;reason?:string}};
export type SystemIdentity={producerName:string;producerNif:string;name:string;id:string;version:string;installation:string;onlyVerifactu:'S';multiTaxpayer:'S'|'N';multipleTaxpayers:'S'|'N'};
type Entry={record:ShadowRecord;previous?:ShadowRecord;alta?:ShadowRecord};
const NS='https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/';
function fail(code:string):never{throw new Error('VF_XML_'+code)}
function text(value:unknown,max=500){if(typeof value!=='string'||!value.trim()||Array.from(value).length>max||/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/u.test(value)||/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value))fail('TEXT_INVALID');return value;}
function xml(value:unknown,max=500){return text(value,max).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]!));}
const el=(name:string,value:unknown,max=500)=>`<sf:${name}>${xml(value,max)}</sf:${name}>`;
function nif(value:unknown){const s=text(value,9);if(!/^[A-Z0-9]{9}$/.test(s))fail('NIF_REQUIRED');return s;}
function cents(value:unknown):bigint{const s=typeof value==='number'?String(value):value;if(typeof s!=='string'||!/^[-+]?\d{1,12}(\.\d{0,2})?$/.test(s))fail('MONEY_INVALID');const negative=s.startsWith('-');const [a,b='']=s.replace(/^[-+]/,'').split('.');return (BigInt(a)*100n+BigInt(b.padEnd(2,'0')))*(negative?-1n:1n);}
function money(value:unknown){const n=cents(value);const a=n<0?-n:n;return `${n<0?'-':''}${a/100n}.${String(a%100n).padStart(2,'0')}`;}
function date(value:unknown){const s=text(value,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(Date.parse(s+'T00:00:00Z'))||new Date(s+'T00:00:00Z').toISOString().slice(0,10)!==s)fail('DATE_INVALID');return s.slice(8,10)+'-'+s.slice(5,7)+'-'+s.slice(0,4);}
function identity(r:ShadowRecord){const f=r.hash_fields;return {nif:r.record_kind==='alta'?f.IDEmisorFactura:f.IDEmisorFacturaAnulada,number:r.record_kind==='alta'?f.NumSerieFactura:f.NumSerieFacturaAnulada,date:r.record_kind==='alta'?f.FechaExpedicionFactura:f.FechaExpedicionFacturaAnulada};}
async function integrity(r:ShadowRecord){
 try{const input=r.record_kind==='alta'?buildAltaHashInput(r.hash_fields as unknown as AltaHashFields):r.record_kind==='anulacion'?buildAnulacionHashInput(r.hash_fields as unknown as AnulacionHashFields):fail('KIND_INVALID');
  if(input!==r.hash_input||await sha256Hex(input)!==r.hash||identity(r).nif!==r.issuer_nif||!Number.isSafeInteger(r.sequence)||r.sequence<1)fail('INTEGRITY');
 }catch{fail('INTEGRITY');}
}
function chain(entry:Entry){const r=entry.record;const p=entry.previous;
 if(!r.hash_fields.Huella){if(r.sequence!==1||p)fail('FIRST_RECORD');return '<sf:Encadenamiento><sf:PrimerRegistro>S</sf:PrimerRegistro></sf:Encadenamiento>';}
 if(!p||p.hash!==r.hash_fields.Huella||p.sequence+1!==r.sequence||p.owner_id!==r.owner_id||p.issuer_nif!==r.issuer_nif||p.installation_id!==r.installation_id)fail('PREVIOUS_REQUIRED');
 const i=identity(p);return `<sf:Encadenamiento><sf:RegistroAnterior>${el('IDEmisorFactura',i.nif,9)}${el('NumSerieFactura',i.number,60)}${el('FechaExpedicionFactura',i.date,10)}${el('Huella',p.hash,64)}</sf:RegistroAnterior></sf:Encadenamiento>`;
}
function systemXml(s:SystemIdentity){
 if(s.onlyVerifactu!=='S'||!['S','N'].includes(s.multiTaxpayer)||!['S','N'].includes(s.multipleTaxpayers))fail('SYSTEM_INVALID');
 return `<sf:SistemaInformatico>${el('NombreRazon',s.producerName,120)}${el('NIF',nif(s.producerNif),9)}${el('NombreSistemaInformatico',s.name,30)}${el('IdSistemaInformatico',s.id,2)}${el('Version',s.version,50)}${el('NumeroInstalacion',s.installation,100)}${el('TipoUsoPosibleSoloVerifactu',s.onlyVerifactu)}${el('TipoUsoPosibleMultiOT',s.multiTaxpayer)}${el('IndicadorMultiplesOT',s.multipleTaxpayers)}</sf:SistemaInformatico>`;
}
function invoice(r:ShadowRecord){const i=r.snapshot.invoice;if(!i||i.id!==r.invoice_id||i.owner_id!==r.owner_id||i.currency!=='EUR'||i.invoice_number!==r.hash_fields.NumSerieFactura||date(i.issue_date)!==r.hash_fields.FechaExpedicionFactura||nif(i.issuer_tax_id)!==r.issuer_nif||money(i.tax_amount)!==r.hash_fields.CuotaTotal||money(i.total_amount)!==r.hash_fields.ImporteTotal)fail('SNAPSHOT_MISMATCH');return i;}
function fiscalDetails(r:ShadowRecord,i:Record<string,any>){
 // Deliberately explicit supported profile: current ordinary Spanish IVA. Never infer an exemption/OSS code from free text.
 if(i.fiscal_treatment!=='taxable'||(i.issuer_tax_country_code&&i.issuer_tax_country_code!=='ES'))fail('FISCAL_MAPPING_REQUIRED');
 const groups=new Map<string,{base:bigint;tax:bigint}>();let base=0n,tax=0n;
 if(!r.snapshot.lines?.length)fail('LINES_REQUIRED');
 for(const line of r.snapshot.lines){const rate=String(line.tax_rate);if(!/^\d{1,2}(\.\d{1,2})?$/.test(rate)||Number(rate)>99.99)fail('RATE_INVALID');const key=money(rate);const v=groups.get(key)||{base:0n,tax:0n};v.base+=cents(line.line_net);v.tax+=cents(line.tax_amount);groups.set(key,v);base+=cents(line.line_net);tax+=cents(line.tax_amount);}
 if(groups.size>12||base!==cents(i.subtotal)||tax!==cents(i.tax_amount)||base+tax!==cents(i.total_amount))fail('TOTALS_MISMATCH');
 const decimal=(n:bigint)=>`${n<0?'-':''}${(n<0?-n:n)/100n}.${String((n<0?-n:n)%100n).padStart(2,'0')}`;
 return '<sf:Desglose>'+[...groups].map(([rate,g])=>`<sf:DetalleDesglose>${el('Impuesto','01')}${el('ClaveRegimen','01')}${el('CalificacionOperacion','S1')}${el('TipoImpositivo',rate)}${el('BaseImponibleOimporteNoSujeto',decimal(g.base))}${el('CuotaRepercutida',decimal(g.tax))}</sf:DetalleDesglose>`).join('')+'</sf:Desglose>';
}
function altaXml(entry:Entry,s:SystemIdentity){
 const r=entry.record;const i=invoice(r);const f=r.hash_fields;const t=f.TipoFactura;
 if(t==='F3')fail('SUBSTITUTED_INVOICES_REQUIRED');
 let correction='';
 if(t.startsWith('R')){
  if(!['S','I'].includes(i.rectification_mode)||!i.rectifies_invoice_id)fail('RECTIFICATION_REQUIRED');
  correction=el('TipoRectificativa',i.rectification_mode)+`<sf:FacturasRectificadas><sf:IDFacturaRectificada>${el('IDEmisorFactura',r.issuer_nif,9)}${el('NumSerieFactura',i.rectification_original_number,60)}${el('FechaExpedicionFactura',date(i.rectification_original_date),10)}</sf:IDFacturaRectificada></sf:FacturasRectificadas>`;
  if(i.rectification_mode==='S')correction+=`<sf:ImporteRectificacion>${el('BaseRectificada',money(i.rectification_original_base))}${el('CuotaRectificada',money(i.rectification_original_tax))}</sf:ImporteRectificacion>`;
 }
 let recipient='';
 if(!['F2','R5'].includes(t)){recipient=`<sf:Destinatarios><sf:IDDestinatario>${el('NombreRazon',i.client_name,120)}${el('NIF',nif(i.client_tax_id),9)}</sf:IDDestinatario></sf:Destinatarios>`;}
 const description=i.rectification_reason||r.snapshot.lines?.map(l=>String(l.description||'')).join('; ');text(description); // reject overlong content rather than silently truncating it
 return `<sf:RegistroAlta>${el('IDVersion','1.0')}<sf:IDFactura>${el('IDEmisorFactura',r.issuer_nif,9)}${el('NumSerieFactura',f.NumSerieFactura,60)}${el('FechaExpedicionFactura',f.FechaExpedicionFactura,10)}</sf:IDFactura>${el('NombreRazonEmisor',i.issuer_name,120)}${el('TipoFactura',t)}${correction}${i.operation_date?el('FechaOperacion',date(i.operation_date),10):''}${el('DescripcionOperacion',description)}${recipient}${fiscalDetails(r,i)}${el('CuotaTotal',f.CuotaTotal)}${el('ImporteTotal',f.ImporteTotal)}${chain(entry)}${systemXml(s)}${el('FechaHoraHusoGenRegistro',f.FechaHoraHusoGenRegistro)}${el('TipoHuella','01')}${el('Huella',r.hash,64)}</sf:RegistroAlta>`;
}
function cancellationXml(entry:Entry,s:SystemIdentity){const r=entry.record;const a=entry.alta;const f=r.hash_fields;
 if(!a||a.record_kind!=='alta'||a.id!==r.alta_record_id||a.invoice_id!==r.invoice_id||a.owner_id!==r.owner_id||a.issuer_nif!==r.issuer_nif||a.installation_id!==r.installation_id||a.sequence>=r.sequence||r.snapshot.altaRecordId!==a.id||r.snapshot.invoiceId!==r.invoice_id)fail('CANCELLATION_ALTA');
 const ai=identity(a);if(ai.number!==f.NumSerieFacturaAnulada||ai.date!==f.FechaExpedicionFacturaAnulada)fail('CANCELLATION_ALTA');
 return `<sf:RegistroAnulacion>${el('IDVersion','1.0')}<sf:IDFactura>${el('IDEmisorFacturaAnulada',r.issuer_nif,9)}${el('NumSerieFacturaAnulada',f.NumSerieFacturaAnulada,60)}${el('FechaExpedicionFacturaAnulada',f.FechaExpedicionFacturaAnulada,10)}</sf:IDFactura>${chain(entry)}${systemXml(s)}${el('FechaHoraHusoGenRegistro',f.FechaHoraHusoGenRegistro)}${el('TipoHuella','01')}${el('Huella',r.hash,64)}</sf:RegistroAnulacion>`;
}
/** Offline export only. XSD validation and business acceptance are separate; never sends a request. */
export async function serializeAeatSubmission(entries:Entry[],s:SystemIdentity):Promise<string>{
 if(!entries.length||entries.length>1000)fail('BATCH_LIMIT');const first=entries[0];const owner=first.record.owner_id,n=first.record.issuer_nif;let body='';const ids=new Set<string>();
 for(const entry of entries){const r=entry.record;if(r.owner_id!==owner||r.issuer_nif!==n||r.installation_id!==s.installation||ids.has(r.id))fail('BATCH_IDENTITY');ids.add(r.id);await integrity(r);if(entry.previous)await integrity(entry.previous);if(entry.alta)await integrity(entry.alta);body+=`<sfLR:RegistroFactura>${r.record_kind==='alta'?altaXml(entry,s):cancellationXml(entry,s)}</sfLR:RegistroFactura>`;}
 const source=first.record.record_kind==='alta'?first.record:first.alta;if(!source)fail('ISSUER_SNAPSHOT_REQUIRED');
 return `<?xml version="1.0" encoding="UTF-8"?><sfLR:RegFactuSistemaFacturacion xmlns:sfLR="${NS}SuministroLR.xsd" xmlns:sf="${NS}SuministroInformacion.xsd"><sfLR:Cabecera><sf:ObligadoEmision>${el('NombreRazon',source.snapshot.invoice?.issuer_name,120)}${el('NIF',nif(n),9)}</sf:ObligadoEmision></sfLR:Cabecera>${body}</sfLR:RegFactuSistemaFacturacion>`;
}
