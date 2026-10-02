// Shared by the browser and Vercel. No provider-specific parsing or secrets.
export const normalizeTaxId = value => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g,'').replace(/^ES(?=[A-Z0-9]{9}$)/,'');
export const normalizeIdentity = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const cents = value => Math.round(Number(value)*100);
const near = (a,b,tolerance=2) => Number.isFinite(Number(a)) && Number.isFinite(Number(b)) && Math.abs(cents(a)-cents(b))<=tolerance;
export function validSpanishTaxId(value) {
  const id=normalizeTaxId(value), letters='TRWAGMYFPDXBNJZSQVHLCKE';
  if(/^\d{8}[A-Z]$/.test(id))return letters[Number(id.slice(0,8))%23]===id[8];
  if(/^[XYZ]\d{7}[A-Z]$/.test(id))return letters[Number('XYZ'.indexOf(id[0])+id.slice(1,8))%23]===id[8];
  if(!/^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/.test(id))return false;
  let sum=0;for(let i=1;i<=7;i++){const n=Number(id[i]);const doubled=n*2;sum+=i%2?Math.floor(doubled/10)+doubled%10:n;}
  const digit=(10-sum%10)%10,letter='JABCDEFGHI'[digit];
  return /[KPQS]/.test(id[0])?id[8]===letter:/[ABEH]/.test(id[0])?id[8]===String(digit):id[8]===letter||id[8]===String(digit);
}
export function fullInvoiceNumber(d){const number=String(d.number||'').trim(),series=String(d.series||'').trim();return series&&!(number.toLowerCase().startsWith(series.toLowerCase())&&/^[^a-z0-9]/i.test(number.slice(series.length)))?`${series}-${number}`:number;}
export function fingerprint(d) {
  return [normalizeTaxId(d.supplier?.taxId)||`name:${normalizeIdentity(d.supplier?.name)}`,normalizeIdentity(fullInvoiceNumber(d)),d.issueDate||'',cents(d.total),d.currency||''].join('|');
}
function dateValid(v){return /^\d{4}-\d{2}-\d{2}$/.test(String(v))&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;}
export function validateDocument(input,{threshold=.92,reviewed=false}={}) {
  const d=structuredClone(input||{}),reasons=[],corrections=[];
  d.supplier=d.supplier||{};d.lines=Array.isArray(d.lines)?d.lines:[];d.taxes=Array.isArray(d.taxes)?d.taxes:[];d.confidence=d.confidence||{};
  const fail=message=>reasons.push(message);
  if(!String(d.supplier.name||'').trim())fail('Falta la razón social del proveedor.');
  const taxId=normalizeTaxId(d.supplier.taxId);d.supplier.taxId=taxId;
  const spanish=d.supplier.countryCode==='ES'||/^ES/i.test(input?.supplier?.taxId||'')||/^[A-Z0-9]{9}$/.test(taxId)&&!d.supplier.countryCode;
  if(taxId&&spanish&&!validSpanishTaxId(taxId))fail('El NIF/CIF no supera el dígito de control.');
  if(!taxId&&d.type!=='simplified')fail('Falta el identificador fiscal del proveedor.');
  if(!String(d.number||'').trim())fail('Falta el número de factura o ticket.');
  if(!['complete','simplified','rectification','credit'].includes(d.type))fail('Revisa el tipo de factura.');
  if(!dateValid(d.issueDate))fail('La fecha de emisión no es válida.');
  if(dateValid(d.issueDate)&&Date.parse(d.issueDate)>Date.now()+2*86400000)fail('La fecha de emisión es futura.');
  if(d.dueDate&&(!dateValid(d.dueDate)||dateValid(d.issueDate)&&d.dueDate<d.issueDate))fail('Revisa la fecha de vencimiento.');
  if(!/^[A-Z]{3}$/.test(d.currency||''))fail('Falta una moneda válida.');
  for(const k of ['subtotal','vat','total','surcharge','withholding']){
    if(d[k]==null&&['surcharge','withholding'].includes(k))d[k]=0;
    if(typeof d[k]!=='number'||!Number.isFinite(d[k]))fail(`Importe inválido: ${k}.`);
  }
  if(d.total===0)fail('El total es cero.');
  if(d.total<0&&!['rectification','credit'].includes(d.type))fail('Un total negativo necesita tipo rectificativa o abono.');
  if(!d.lines.length)fail('No se han extraído las líneas.');
  for(const [i,l] of d.lines.entries()){
    if(!l.description||![l.quantity,l.unitPrice,l.net,l.vat,l.total].every(n=>typeof n==='number'&&Number.isFinite(n))) {fail(`Línea ${i+1}: faltan importes o descripción.`);continue;}
    if(![0,4,10,21].includes(l.vatRate)&&d.currency==='EUR'&&spanish)fail(`Línea ${i+1}: tipo de IVA no admitido.`);
    if(!Number.isFinite(l.discountPercent||0)||(l.discountPercent||0)<0||(l.discountPercent||0)>100)fail(`Línea ${i+1}: descuento inválido.`);
    if(!near(l.net,l.quantity*l.unitPrice*(1-(l.discountPercent||0)/100)))fail(`Línea ${i+1}: cantidad, precio y descuento no cuadran.`);
    if(!near(l.total,l.net+l.vat))fail(`Línea ${i+1}: total incorrecto.`);
    if(!near(l.vat,l.net*l.vatRate/100))fail(`Línea ${i+1}: cuota de IVA incorrecta.`);
  }
  if(d.lines.length&&!near(d.subtotal,d.lines.reduce((n,l)=>n+Number(l.net),0),Math.max(2,d.lines.length)))fail('Las líneas no suman la base imponible.');
  if(!d.taxes.length)fail('Falta el desglose fiscal.');
  for(const t of d.taxes){
    if(![t.rate,t.base,t.amount].every(n=>typeof n==='number'&&Number.isFinite(n)))fail('Desglose de IVA incompleto.');
    else if(!near(t.amount,t.base*t.rate/100))fail('La base y cuota del desglose IVA no cuadran.');
    if(spanish&&![0,4,10,21].includes(t.rate))fail('Tipo de IVA no reconocido.');
    const matching=d.lines.filter(l=>l.vatRate===t.rate);
    if(matching.length&&!near(t.base,matching.reduce((n,l)=>n+l.net,0),Math.max(2,matching.length)))fail('El desglose de IVA no coincide con las líneas.');
  }
  if(!near(d.subtotal,d.taxes.reduce((n,t)=>n+Number(t.base),0)))fail('Las bases de IVA no suman la base de factura.');
  if(!near(d.vat,d.taxes.reduce((n,t)=>n+Number(t.amount),0)))fail('Las cuotas de IVA no suman el IVA de factura.');
  if(d.surcharges?.length){
    for(const s of d.surcharges)if(!near(s.amount,s.base*s.rate/100))fail('Recargo de equivalencia incorrecto.');
    if(!near(d.surcharge,d.surcharges.reduce((n,s)=>n+s.amount,0)))fail('Desglose de recargo inconsistente.');
  }else if(d.surcharge)fail('Falta el desglose del recargo de equivalencia.');
  if(d.withholdingRate!=null&&!near(d.withholding,d.subtotal*d.withholdingRate/100))fail('La retención IRPF no cuadra con su base.');
  if((d.intraCommunity||d.reverseCharge)&&d.vat!==0)fail('Operación intracomunitaria/inversión con IVA repercutido: revisar.');
  const calculated=d.subtotal+d.vat+d.surcharge-d.withholding;
  if(!near(d.total,calculated))fail('El total no cuadra con bases, cuotas, recargo y retención.');
  else if(d.total!==calculated&&Number.isFinite(calculated)) { d.total=cents(calculated)/100;corrections.push('Ajuste de redondeo del total (máximo 0,02).'); }
  if(d.segmentationWarning&&!(reviewed&&d.segmentationResolved))fail(d.segmentationWarning);
  if(d.lines.some(l=>l.kind==='expense')&&!d.categoryId)fail('Selecciona una categoría para el gasto.');
  if(!reviewed){
    for(const field of ['supplier',...(taxId?['taxId']:[]),'number','issueDate','currency','lines','taxes','total'])if(!(Number(d.confidence[field])>=threshold))fail(`Confianza insuficiente: ${field}.`);
    for(const field of ['email','phone','address','iban'])if(d.supplier[field]&&!(Number(d.confidence[field])>=threshold))fail(`Confianza insuficiente: ${field}.`);
    if(d.extractionWarning)fail(d.extractionWarning);
  }
  return {document:d,status:reasons.length?'needs_review':'ready',reasons:[...new Set(reasons)],corrections,confidence:Object.keys(d.confidence).length?Math.min(...Object.values(d.confidence).filter(n=>typeof n==='number'),0.999):0};
}
export function mergeDocuments(documents) {
  const out=[];
  for(const original of documents){
    const d=structuredClone(original),tax=normalizeTaxId(d.supplier?.taxId),name=normalizeIdentity(d.supplier?.name);
    const previous=out.find(x=>d.number&&normalizeIdentity(x.number)===normalizeIdentity(d.number)&&normalizeIdentity(x.series)===normalizeIdentity(d.series)&&(tax?normalizeTaxId(x.supplier?.taxId)===tax:normalizeIdentity(x.supplier?.name)===name)&&(!d.issueDate||!x.issueDate||x.issueDate===d.issueDate));
    if(!previous){out.push(d);continue;}
    const overlap=(d.pages||[]).some(p=>(previous.pages||[]).includes(p));
    if(overlap){out.push({...d,segmentationWarning:'Dos facturas con la misma identidad en la misma página: revisa la separación.'});continue;}
    previous.lines=[...(previous.lines||[]),...(d.lines||[])];
    previous.pages=[...new Set([...(previous.pages||[]),...(d.pages||[])])].sort((a,b)=>a-b);
    for(const k of ['subtotal','vat','total','surcharge','withholding'])if(Number.isFinite(d[k])){
      if(Number.isFinite(previous[k])&&!near(previous[k],d[k]))previous.segmentationWarning='Importes diferentes entre páginas con el mismo número de factura.';
      previous[k]=d[k];
    }
    if(d.taxes?.length)previous.taxes=d.taxes;
    previous.confidence=Object.fromEntries([...new Set([...Object.keys(previous.confidence||{}),...Object.keys(d.confidence||{})])].map(k=>[k,Math.min(previous.confidence?.[k]??0,d.confidence?.[k]??0)]));
    for(const [k,v] of Object.entries(d))if(previous[k]==null&&v!=null)previous[k]=v;
  }
  return out;
}
const text={type:['string','null']},number={type:['number','null']};
export const documentSchema={type:'object',properties:{
  supplier:{type:'object',properties:Object.fromEntries(['name','taxId','address','postalCode','city','province','countryCode','email','phone','iban'].map(k=>[k,text])),required:['name','taxId']},
  type:{enum:['complete','simplified','rectification','credit']},...Object.fromEntries(['number','series','issueDate','dueDate','paymentMethod','currency','orderNumber','deliveryNoteNumber','qrVerifactu','qrTicketBai','rectifiesNumber','categoryId'].map(k=>[k,text])),
  ...Object.fromEntries(['subtotal','vat','surcharge','withholding','withholdingRate','total'].map(k=>[k,number])),
  intraCommunity:{type:'boolean'},reverseCharge:{type:'boolean'},
  pages:{type:'array',items:{type:'integer'}},
  lines:{type:'array',items:{type:'object',properties:{description:text,reference:text,kind:{enum:['product','expense']},unit:text,...Object.fromEntries(['quantity','unitPrice','discountPercent','net','vatRate','vat','total','confidence'].map(k=>[k,number]))},required:['description','quantity','unitPrice','net','vatRate','vat','total','kind']}},
  taxes:{type:'array',items:{type:'object',properties:{rate:number,base:number,amount:number,exempt:{type:'boolean'}},required:['rate','base','amount']}},
  surcharges:{type:'array',items:{type:'object',properties:{rate:number,base:number,amount:number},required:['rate','base','amount']}},
  confidence:{type:'object',properties:Object.fromEntries(['supplier','taxId','address','email','phone','iban','number','series','issueDate','dueDate','currency','lines','taxes','total','paymentMethod','orderNumber','deliveryNoteNumber','qrVerifactu','qrTicketBai','categoryId'].map(k=>[k,{type:'number',minimum:0,maximum:1}])),required:['supplier','taxId','number','issueDate','currency','lines','taxes','total']}
},required:['supplier','type','number','issueDate','currency','lines','taxes','subtotal','vat','total','confidence','pages']};
export const extractionSchema={type:'object',properties:{documents:{type:'array',items:documentSchema}},required:['documents']};
