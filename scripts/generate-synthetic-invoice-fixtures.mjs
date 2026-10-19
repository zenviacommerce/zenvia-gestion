// Independent, deterministic examples. No input file, production connection,
// identifier mapping, original amount or original product catalogue is consumed.
import {writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const money=n=>Math.round((n+Number.EPSILON)*100)/100;
export function generateSyntheticInvoices(){
  const rows=[];
  const add=(kind,severity=null)=>{
    const n=rows.length+1,s=String(n).padStart(3,'0');
    const price=money(3.17+n*0.43),quantity=11+n;
    const item=(j,q=quantity,p=price,extra={})=>({description:`Synthetic item ${s}-${j}`,supplierSku:`SYNTHETIC-SKU-${s}-${j}`,quantity:q,unit:'ud',unitPrice:p,lineNet:money(q*p),taxRate:21,...extra});
    const row={id8:`SYNTHETIC-SCENARIO-${s}`,number:`SYNTHETIC-INVOICE-${s}`,supplier:`Synthetic Supplier ${s}`,supplier_type:'goods',category:'Mercancía',subtotal:money(quantity*price),vat:0,equivalenceSurcharge:0,withholding:0,total:0,lineImportWarning:null,detectedLineCount:null,scenario:kind,lines:[item(1)]};
    if(severity)row.incidentSeverity=severity;
    if(kind==='duplicate-mismatch')row.lines.push({...row.lines[0]});
    if(kind==='subtotal-mismatch'||kind==='subtotal-and-price-mismatch')row.subtotal=money(row.subtotal+19.73+n);
    if(kind==='subtotal-and-price-mismatch')row.lines[0].quantity+=23;
    if(kind==='lost-goods'||kind==='lost-service'){
      row.lines=[];row.lineImportWarning='Synthetic numeric overflow';row.detectedLineCount=3+n%5;
      if(kind==='lost-service'){row.supplier_type='service';row.category='Synthetic service';}
    }
    if(kind==='missing-goods')row.lines=[];
    if(kind==='service'||kind==='service-in-goods-category'){
      row.supplier_type='service';row.lines=[];
      if(kind==='service')row.category='Synthetic service';
    }
    if(kind==='reconciled-nine-lines'){
      row.lines=Array.from({length:9},(_,i)=>item(i+1,13+i, money(4.23+i*0.61)));
      row.subtotal=money(row.lines.reduce((sum,l)=>sum+l.lineNet,0));row.resolvedIncident=true;
    }
    if(kind==='ambiguous-unit'){
      row.lines[0].description=`Synthetic item ${s}-1 240U R/8 C/9`;
      row.lines[0].unit='Retractil';
    }
    if(kind==='large-quantity'){
      row.lines=[item(1,345678,0.017)];row.subtotal=row.lines[0].lineNet;
    }
    if(kind==='legitimate-repetition'){
      row.lines.push({...row.lines[0]});row.subtotal=money(row.subtotal*2);
    }
    if(kind==='negative-withholding')row.withholding=-money(row.subtotal*0.15);
    const zeroVat=kind==='service'||kind==='service-in-goods-category'||(kind==='correct'&&n<=64);
    if(zeroVat)for(const line of row.lines)line.taxRate=0;
    if(kind==='correct'&&n>=65&&n<=72)row.equivalenceSurcharge=money(row.subtotal*0.052);
    row.vat=zeroVat?0:money(row.subtotal*0.21);
    row.total=money(row.subtotal+row.vat+row.equivalenceSurcharge-Math.abs(row.withholding));
    rows.push(row);
  };
  // 28 review scenarios: same aggregate defect families and severity coverage.
  for(let i=0;i<13;i++)add(i===0?'duplicate-mismatch':'subtotal-mismatch','Alta');
  add('subtotal-and-price-mismatch','Alta');
  for(let i=0;i<5;i++)add('lost-goods','Media');
  for(let i=0;i<2;i++)add('lost-service','Baja');
  for(let i=0;i<4;i++)add('subtotal-mismatch','Baja');
  for(let i=0;i<3;i++)add('subtotal-and-price-mismatch','Baja');
  // 53 valid invoices plus the independent merchandise-without-lines check.
  add('reconciled-nine-lines');
  for(let i=0;i<7;i++)add('service-in-goods-category');
  for(let i=0;i<11;i++)add('service');
  add('missing-goods');
  for(const kind of ['ambiguous-unit','large-quantity','legitimate-repetition','negative-withholding'])add(kind);
  while(rows.length<82)add('correct');
  return rows;
}
export const serializeSyntheticInvoices=()=>JSON.stringify(generateSyntheticInvoices(),null,2)+'\n';
if(process.argv[1]===fileURLToPath(import.meta.url)){
  await writeFile(new URL('./fixtures/historical-expense-invoices-2026-10.json',import.meta.url),serializeSyntheticInvoices());
}
