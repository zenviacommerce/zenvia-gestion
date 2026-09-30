import JSZip from 'jszip';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { supabase } from './supabase';

pdfjsLib.GlobalWorkerOptions.workerSrc=pdfWorker;

export type TransportTariffStatus='draft'|'reviewed'|'active'|'superseded';
export type TransportShippingProvider='sendcloud'|'envia';
export type TransportMappingStatus='suggested'|'confirmed'|'unmapped';

export interface TransportTariffBandDraft{
  id?:string;
  countryCode:string;
  zoneCode:string;
  zoneName:string;
  minWeightKg:number;
  maxWeightKg:number|null;
  basePrice:number|null;
  extraKgPrice:number|null;
  notes?:string|null;
  sortOrder?:number;
}
export interface TransportTariffServiceDraft{
  id?:string;
  serviceName:string;
  canonicalServiceKey:string;
  externalProvider:string;
  externalServiceCode:string;
  mappingStatus:TransportMappingStatus;
  sortOrder?:number;
  bands:TransportTariffBandDraft[];
}
export interface TransportTariffProposal{
  carrierCode:string;
  carrierName:string;
  effectiveFrom:string|null;
  effectiveTo:string|null;
  currencyCode:string;
  pricesIncludeVat:boolean;
  fuelSurchargePct:number|null;
  fuelSurchargeIncluded:boolean;
  parserProvider:string;
  parserModel:string|null;
  parserConfidence:number;
  parserNotes:string[];
  services:TransportTariffServiceDraft[];
}
export interface TransportTariffDocument extends TransportTariffProposal{
  id:string;
  status:TransportTariffStatus;
  shippingProvider:TransportShippingProvider;
  sourceFileName:string|null;
  sourceFilePath:string|null;
  sourceMimeType:string|null;
  createdAt:string;
  reviewedAt:string|null;
  activatedAt:string|null;
  revisions:Array<{id:string;effectiveFrom:string;snapshot:TransportTariffProposal}>;
}

const BUCKET='transport-tariffs';
const clean=(value:unknown)=>String(value??'').replace(/\s+/g,' ').trim();
const slug=(value:string)=>clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const num=(value:string|number|null|undefined)=>{if(value==null||value==='')return null;const raw=String(value).replace(/\s/g,'').replace(/\.(?=\d{3}(?:\D|$))/g,'').replace(',','.').replace(/[^\d.-]/g,'');const parsed=Number(raw);return Number.isFinite(parsed)?parsed:null};
const isoDate=(day:string,month:string,year:string)=>`${year.length===2?`20${year}`:year}-${month.padStart(2,'0')}-${day.padStart(2,'0')}`;

function safeFileName(name:string){return (name||'tarifa').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/-+/g,'-').slice(0,120)||'tarifa';}
async function sha256(file:File){const bytes=await file.arrayBuffer();const digest=await crypto.subtle.digest('SHA-256',bytes);return Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,'0')).join('');}

async function readPdfText(file:File){
  const pdf=await pdfjsLib.getDocument({data:await file.arrayBuffer()}).promise;
  const pages:string[]=[];
  for(let p=1;p<=pdf.numPages;p+=1){
    const page=await pdf.getPage(p);const content=await page.getTextContent();
    const items=(content.items as Array<any>).map(item=>({
      text:clean(item.str),x:Number(item.transform?.[4]||0),y:Number(item.transform?.[5]||0),
      width:Math.max(0,Number(item.width||0)),height:Math.max(0,Number(item.height||item.transform?.[0]||0)),
    })).filter(item=>item.text);
    const rows=new Map<number,Array<{text:string;x:number;width:number;height:number}>>();
    for(const item of items){
      const tolerance=Math.max(2,Math.min(5,item.height*.45||3));
      const existing=[...rows.keys()].find(key=>Math.abs(key-item.y)<=tolerance);
      const key=existing??item.y;
      const row=rows.get(key)||[];row.push({text:item.text,x:item.x,width:item.width,height:item.height});rows.set(key,row);
    }
    const text=Array.from(rows.entries()).sort((a,b)=>b[0]-a[0]).map(([,row])=>{
      const sorted=row.sort((a,b)=>a.x-b.x);let out='';
      for(let index=0;index<sorted.length;index+=1){
        const item=sorted[index],previous=sorted[index-1];
        if(previous){
          const gap=item.x-(previous.x+previous.width);
          const charWidth=previous.text.length?Math.max(2,previous.width/previous.text.length):4;
          out+=gap>Math.max(12,charWidth*3)?'\t':' ';
        }
        out+=item.text;
      }
      return out.trim();
    }).filter(Boolean).join('\n');
    pages.push(`[[PAGE ${p}]]\n${text}`);
  }
  return pages.join('\n\n');
}

function xmlText(node:Element|null){return node?Array.from(node.querySelectorAll('t')).map(t=>t.textContent||'').join(''):''}
async function readXlsxText(file:File){
  const zip=await JSZip.loadAsync(await file.arrayBuffer());
  const parser=new DOMParser();
  const sharedFile=zip.file('xl/sharedStrings.xml');
  const shared:string[]=[];
  if(sharedFile){const xml=parser.parseFromString(await sharedFile.async('text'),'application/xml');xml.querySelectorAll('si').forEach(si=>shared.push(xmlText(si)))}
  const sheets=Object.keys(zip.files).filter(name=>/^xl\/worksheets\/sheet\d+\.xml$/i.test(name)).sort();
  const output:string[]=[];
  for(const name of sheets){
    const sheet=zip.file(name);if(!sheet)continue;
    output.push(`[[SHEET ${name.replace('xl/worksheets/','')}]]`);
    const xml=parser.parseFromString(await sheet.async('text'),'application/xml');
    xml.querySelectorAll('row').forEach(row=>{
      const cells:Array<{ref:string;value:string}>=[];
      row.querySelectorAll('c').forEach(cell=>{
        const type=cell.getAttribute('t')||'';const ref=cell.getAttribute('r')||'';let value='';
        if(type==='s'){const index=Number(cell.querySelector('v')?.textContent||'-1');value=shared[index]||''}
        else if(type==='inlineStr')value=xmlText(cell.querySelector('is'));
        else value=cell.querySelector('v')?.textContent||'';
        if(clean(value))cells.push({ref,value:clean(value)});
      });
      if(cells.length)output.push(cells.map(c=>c.value).join('\t'));
    });
  }
  return output.join('\n');
}

export async function readTransportDocumentText(file:File){
  const lower=file.name.toLowerCase();
  if(file.type==='application/pdf'||lower.endsWith('.pdf'))return readPdfText(file);
  if(lower.endsWith('.xlsx')||file.type.includes('spreadsheetml'))return readXlsxText(file);
  if(lower.endsWith('.csv')||file.type==='text/csv')return file.text();
  throw new Error('Formato no compatible. Utiliza PDF, XLSX o CSV.');
}

const zones=[
  {label:'Urbano',code:'urban',country:'ES'},
  {label:'Provincial',code:'provincial',country:'ES'},
  {label:'Regional-Limítrofe',code:'regional-border',country:'ES'},
  {label:'España Peninsular',code:'peninsular',country:'ES'},
  {label:'Portugal Peninsular',code:'peninsular',country:'PT'},
];
function prices(line:string){return Array.from(line.matchAll(/(-?\d+(?:[.,]\d{1,4})?)\s*€/g)).map(match=>num(match[1])).filter((value):value is number=>value!=null)}
function zoneLayout(block:string){
  const header=block.split(/\r?\n/).find(line=>/Tramos Peso/i.test(line)&&/Peninsular/i.test(line))||'';
  return zones.map(zone=>({zone,index:header.toLowerCase().indexOf(zone.label.toLowerCase())})).filter(item=>item.index>=0).sort((a,b)=>a.index-b.index).map(item=>item.zone);
}
function serviceBlocks(text:string){
  const matches=Array.from(text.matchAll(/EXPEDICIONES?\s+MAÑANA\s+(\d{1,2})\s*h/gi));
  if(!matches.length)return [] as Array<{hour:string;block:string}>;
  return matches.map((match,index)=>({hour:match[1],block:text.slice(match.index??0,matches[index+1]?.index??text.length)}));
}
const genericCarriers=[
  {code:'correos-express',pattern:/\bcorreos\s+express\b/i,label:'Correos Express'},
  {code:'correos',pattern:/\bcorreos\b/i,label:'Correos'},
  {code:'mrw',pattern:/\bmrw\b/i,label:'MRW'},
  {code:'seur',pattern:/\bseur\b/i,label:'SEUR'},
  {code:'gls',pattern:/\bgls\b/i,label:'GLS'},
  {code:'nacex',pattern:/\bnacex\b/i,label:'NACEX'},
  {code:'cttExpress',pattern:/\bctt\s*express\b/i,label:'CTT Express'},
  {code:'ctt',pattern:/\bctt\b/i,label:'CTT'},
  {code:'inPost',pattern:/\bin\s*post\b/i,label:'InPost'},
  {code:'transaher',pattern:/\btransaher\b/i,label:'Transaher'},
  {code:'zeleris',pattern:/\bzeleris\b/i,label:'Zeleris'},
  {code:'tdn',pattern:/\btdn\b/i,label:'TDN'},
  {code:'ontime',pattern:/\bon\s*time\b/i,label:'Ontime'},
  {code:'cainiao',pattern:/\bcainiao\b/i,label:'Cainiao'},
  {code:'ups',pattern:/\bups\b/i,label:'UPS'},
  {code:'dhl',pattern:/\bdhl\b/i,label:'DHL'},
  {code:'fedex',pattern:/\bfedex\b/i,label:'FedEx'},
  {code:'dpd',pattern:/\bdpd\b/i,label:'DPD'},
];
function carrierFromLine(line:string){
  return genericCarriers.find(item=>item.pattern.test(line))||null;
}
function loosePrices(line:string){
  const euro=prices(line);if(euro.length)return euro;
  return Array.from(line.matchAll(/(?<![\d])(-?\d{1,4}[.,]\d{2,4})(?![\d])/g))
    .map(match=>num(match[1])).filter((value):value is number=>value!=null&&value>=0&&value<10000);
}
function parseGenericCarrierServices(text:string):TransportTariffServiceDraft[]{
  const lines=text.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
  const services:TransportTariffServiceDraft[]=[];
  let weights:number[]=[];
  for(const line of lines){
    const headerWeights=Array.from(line.matchAll(/(?:hasta\s+)?(\d+(?:[.,]\d+)?)\s*kg\b/gi))
      .map(match=>num(match[1])).filter((value):value is number=>value!=null&&value>0);
    if(headerWeights.length>=2){
      weights=[...new Set(headerWeights)].sort((a,b)=>a-b);
      continue;
    }
    const carrier=carrierFromLine(line);
    if(!carrier)continue;
    const rowPrices=loosePrices(line);
    if(weights.length>=2&&rowPrices.length>=weights.length){
      const firstPriceIndex=line.search(/\d{1,4}[.,]\d{2,4}/);
      const rawName=(firstPriceIndex>0?line.slice(0,firstPriceIndex):line).replace(carrier.pattern,' ').replace(/[-–—|:]+/g,' ').replace(/\s+/g,' ').trim();
      const serviceName=rawName||carrier.label;
      const bands:TransportTariffBandDraft[]=[];
      let min=0;
      for(let index=0;index<weights.length;index+=1){
        const price=rowPrices[index];if(price==null)continue;
        bands.push({countryCode:'ES',zoneCode:'peninsular',zoneName:'España Peninsular',minWeightKg:min,maxWeightKg:weights[index],basePrice:price,extraKgPrice:null,notes:'Extraído de tabla genérica; revisar zona y servicio',sortOrder:bands.length});
        min=weights[index];
      }
      if(bands.length){
        const key=slug(`${carrier.code}-${serviceName}`);
        services.push({serviceName:`${carrier.label} · ${serviceName}`,canonicalServiceKey:key,externalProvider:carrier.code,externalServiceCode:slug(serviceName),mappingStatus:'suggested',sortOrder:services.length,bands});
      }
      continue;
    }

    const range=line.match(/(?:de\s*)?(\d+(?:[.,]\d+)?)\s*(?:-|a|–|—)\s*(\d+(?:[.,]\d+)?)\s*kg/i);
    const until=line.match(/(?:hasta|max\.?|≤)\s*(\d+(?:[.,]\d+)?)\s*kg/i);
    const rowPrice=rowPrices.at(-1);
    if(rowPrice==null||(!range&&!until))continue;
    const minWeight=range?(num(range[1])??0):0;
    const maxWeight=range?num(range[2]):num(until?.[1]||'');
    if(maxWeight==null)continue;
    const namePart=line.replace(carrier.pattern,' ').replace(range?.[0]||until?.[0]||'',' ').replace(/\d{1,4}[.,]\d{2,4}\s*€?/g,' ').replace(/[-–—|:]+/g,' ').replace(/\s+/g,' ').trim();
    const serviceName=namePart||carrier.label;
    const key=slug(`${carrier.code}-${serviceName}`);
    let service=services.find(item=>item.canonicalServiceKey===key);
    if(!service){
      service={serviceName:`${carrier.label} · ${serviceName}`,canonicalServiceKey:key,externalProvider:carrier.code,externalServiceCode:slug(serviceName),mappingStatus:'suggested',sortOrder:services.length,bands:[]};
      services.push(service);
    }
    service.bands.push({countryCode:'ES',zoneCode:'peninsular',zoneName:'España Peninsular',minWeightKg:minWeight,maxWeightKg:maxWeight,basePrice:rowPrice,extraKgPrice:null,notes:'Extraído de tabla genérica; revisar zona y servicio',sortOrder:service.bands.length});
  }
  return services.filter(service=>service.bands.length>0);
}


function probableCurrency(text:string){
  if(/\bUSD\b|\$/i.test(text))return 'USD';
  if(/\bGBP\b|£/i.test(text))return 'GBP';
  if(/\bCHF\b/i.test(text))return 'CHF';
  return 'EUR';
}
function genericWeightHeader(line:string){
  const explicit=Array.from(line.matchAll(/(?:hasta\s*)?(\d+(?:[.,]\d+)?)\s*(?:kg|kgs|kilogramos?)\b/gi))
    .map(match=>num(match[1])).filter((value):value is number=>value!=null&&value>0&&value<=10000);
  if(explicit.length>=2)return [...new Set(explicit)].sort((a,b)=>a-b);
  const cells=line.split(/\t|\s{2,}|[|;]/).map(clean).filter(Boolean);
  const numeric=cells.map(cell=>num(cell.replace(/(?:hasta|peso|weight|kg|kgs|kilogramos?)/gi,''))).filter((value):value is number=>value!=null&&value>0&&value<=10000);
  if(numeric.length>=2&&(/peso|weight|kg|tramo/i.test(line)||numeric.length>=3))return [...new Set(numeric)].sort((a,b)=>a-b);
  return [];
}
function genericRowLabel(line:string){
  const cells=line.split(/\t|\s{2,}|[|;]/).map(clean).filter(Boolean);
  const labels=cells.filter(cell=>/[A-Za-zÀ-ÿ]/.test(cell)&&!/^\[\[/.test(cell)&&!/^(?:kg|eur|usd|precio|price|hasta|desde)$/i.test(cell));
  return clean(labels.slice(0,2).join(' · ')).slice(0,120);
}
function parseGenericMatrixServices(text:string):TransportTariffServiceDraft[]{
  const lines=text.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
  const services:TransportTariffServiceDraft[]=[];
  let weights:number[]=[];
  let context='';
  let carrierContext:ReturnType<typeof carrierFromLine>=null;
  for(let lineIndex=0;lineIndex<lines.length;lineIndex+=1){
    const line=lines[lineIndex];
    if(/^\[\[(?:PAGE|SHEET)/.test(line)){context='';weights=[];carrierContext=null;continue}
    const detectedCarrier=carrierFromLine(line);if(detectedCarrier)carrierContext=detectedCarrier;
    const header=genericWeightHeader(line);
    if(header.length>=2){weights=header;context=line;continue}

    const cells=line.split(/\t|\s{2,}|[|;]/).map(clean).filter(Boolean);
    const rowPrices=loosePrices(line).filter(value=>value>=0&&value<100000);
    const rowWeightMatch=line.match(/(?:hasta\s*)?(\d+(?:[.,]\d+)?)\s*(?:kg|kgs|kilogramos?)\b/i);
    const rowWeight=rowWeightMatch?num(rowWeightMatch[1]):null;

    // Matrix with weights as columns: service/carrier on the left, one price per weight column.
    if(weights.length>=2&&rowPrices.length>=weights.length){
      const label=genericRowLabel(line)||clean(context);
      if(!label)continue;
      const known=detectedCarrier||carrierContext||carrierFromLine(`${context} ${line}`);
      const provider=known?.code||slug((context||label).split(/[·|:–—-]/)[0])||'carrier';
      const carrierLabel=known?.label||clean((context||label).split(/[·|:–—-]/)[0])||'Transportista';
      const serviceLabel=known?clean(label.replace(known.pattern,' '))||label:label;
      const key=slug(`${provider}-${serviceLabel}`);
      if(!key||services.some(service=>service.canonicalServiceKey===key))continue;
      const bands:TransportTariffBandDraft[]=[];let minWeight=0;
      for(let index=0;index<weights.length;index+=1){
        const price=rowPrices[index];if(price==null)continue;
        bands.push({countryCode:'ES',zoneCode:'peninsular',zoneName:'España Peninsular',minWeightKg:minWeight,maxWeightKg:weights[index],basePrice:price,extraKgPrice:null,notes:'Tabla detectada automáticamente; confirmar país/zona y correspondencia de columnas.',sortOrder:index});
        minWeight=weights[index];
      }
      if(bands.length>=2)services.push({serviceName:known?`${carrierLabel} · ${serviceLabel}`:serviceLabel,canonicalServiceKey:key,externalProvider:provider,externalServiceCode:slug(serviceLabel),mappingStatus:'suggested',sortOrder:services.length,bands});
      continue;
    }

    // Matrix transposed: each row contains a weight and one or more prices, while
    // the carrier/service appears in a preceding heading or in another cell.
    if(rowWeight!=null&&rowPrices.length){
      const label=genericRowLabel(line.replace(rowWeightMatch?.[0]||'',' '))||clean(context);
      const known=detectedCarrier||carrierContext||carrierFromLine(`${context} ${line}`);
      if(!known&&!label)continue;
      const provider=known?.code||slug((context||label).split(/[·|:–—-]/)[0])||'carrier';
      const serviceLabel=known?(clean(label.replace(known.pattern,' '))||clean(context.replace(known.pattern,' '))||known.label):(label||context);
      const key=slug(`${provider}-${serviceLabel}`);
      let service=services.find(item=>item.canonicalServiceKey===key);
      if(!service){
        service={serviceName:known?`${known.label} · ${serviceLabel}`:serviceLabel,canonicalServiceKey:key,externalProvider:provider,externalServiceCode:slug(serviceLabel),mappingStatus:'suggested',sortOrder:services.length,bands:[]};
        services.push(service);
      }
      const previous=service.bands.filter(band=>band.countryCode==='ES'&&band.zoneCode==='peninsular').sort((a,b)=>(a.maxWeightKg||0)-(b.maxWeightKg||0)).at(-1);
      const minWeight=previous?.maxWeightKg??0;
      const price=rowPrices.at(-1)??null;
      if(price!=null&&rowWeight>minWeight)service.bands.push({countryCode:'ES',zoneCode:'peninsular',zoneName:'España Peninsular',minWeightKg:minWeight,maxWeightKg:rowWeight,basePrice:price,extraKgPrice:null,notes:'Fila peso/precio detectada automáticamente; revisar asociación de servicio y zona.',sortOrder:service.bands.length});
      continue;
    }

    if(/[A-Za-zÀ-ÿ]{3}/.test(line)&&line.length<180&&!/iva|vat|combustible|fuel|vigencia|condiciones|subtotal|total/i.test(line))context=line;
  }
  return services.filter(service=>service.bands.length>0);
}
function validateParsedServices(services:TransportTariffServiceDraft[]){
  const notes:string[]=[];
  const valid=services.map((service,serviceIndex)=>{
    const seen=new Set<string>();
    const bands=service.bands
      .filter(band=>{
        const min=Number(band.minWeightKg),max=band.maxWeightKg==null?null:Number(band.maxWeightKg);
        const base=band.basePrice==null?null:Number(band.basePrice),extra=band.extraKgPrice==null?null:Number(band.extraKgPrice);
        const ok=Number.isFinite(min)&&min>=0&&(max==null||(Number.isFinite(max)&&max>min))
          &&(base!=null||extra!=null)&&(base==null||(Number.isFinite(base)&&base>=0&&base<100000))
          &&(extra==null||(Number.isFinite(extra)&&extra>=0&&extra<100000));
        if(!ok){notes.push(`Se descartó un tramo incoherente de ${service.serviceName||`Servicio ${serviceIndex+1}`}.`);return false}
        const key=`${band.countryCode}|${band.zoneCode}|${min}|${max??''}|${base??''}|${extra??''}`;
        if(seen.has(key))return false;seen.add(key);return true;
      })
      .sort((a,b)=>a.countryCode.localeCompare(b.countryCode)||a.zoneCode.localeCompare(b.zoneCode)||a.minWeightKg-b.minWeightKg);
    return {...service,sortOrder:serviceIndex,bands:bands.map((band,index)=>({...band,sortOrder:index}))};
  }).filter(service=>service.bands.length);
  return {services:valid,notes:[...new Set(notes)]};
}

function parseMrwServices(text:string):TransportTariffServiceDraft[]{
  return serviceBlocks(text).map(({hour,block},serviceIndex)=>{
    const layout=zoneLayout(block);const bands:TransportTariffBandDraft[]=[];const previousMax=new Map<string,number>();const lastPrice=new Map<string,number>();
    for(const line of block.split(/\r?\n/)){
      const weight=line.match(/Hasta\s+(\d+(?:[.,]\d+)?)\s*kg/i);
      if(weight){
        const max=num(weight[1]);const rowPrices=prices(line);if(max==null||!layout.length||rowPrices.length<layout.length)continue;
        layout.forEach((zone,column)=>{const price=rowPrices[column];if(price==null)return;const key=`${zone.country}:${zone.code}`;const minWeight=previousMax.get(key)??0;bands.push({countryCode:zone.country,zoneCode:zone.code,zoneName:zone.label,minWeightKg:minWeight,maxWeightKg:max,basePrice:price,extraKgPrice:null,sortOrder:bands.length});previousMax.set(key,max);lastPrice.set(key,price)});
        continue;
      }
      if(/^\s*adicionales/i.test(line)){
        const rowPrices=prices(line);if(!layout.length||rowPrices.length<layout.length)continue;
        layout.forEach((zone,column)=>{const extra=rowPrices[column];const key=`${zone.country}:${zone.code}`;const minWeight=previousMax.get(key);if(extra==null||minWeight==null)return;bands.push({countryCode:zone.country,zoneCode:zone.code,zoneName:zone.label,minWeightKg:minWeight,maxWeightKg:null,basePrice:lastPrice.get(key)??null,extraKgPrice:extra,notes:'kg adicional',sortOrder:bands.length})});
      }
    }
    const key=`manana-${hour}h`;
    return {serviceName:`Mañana ${hour} h`,canonicalServiceKey:key,externalProvider:'mrw',externalServiceCode:key,mappingStatus:'suggested' as TransportMappingStatus,sortOrder:serviceIndex,bands};
  }).filter(service=>service.bands.length>0);
}

function fallbackProposal(text:string,fileName:string):TransportTariffProposal{
  const upper=text.toUpperCase();const mrw=/\bMRW\b/.test(upper)||/EXPEDICIONES?\s+MAÑANA/i.test(text);
  const until=text.match(/(?:vigencia[^\n]{0,80}?hasta|v[aá]lid[oa][^\n]{0,50}?hasta|tarifa[^\n]{0,50}?hasta)(?:\s+el)?\s+(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/i);
  const effectiveTo=until?isoDate(until[1],until[2],until[3]):null;
  const vatExcluded=/no\s+incluyen?\s+iva|iva\s+no\s+incluido|sin\s+iva/i.test(text);
  const vatIncluded=/iva\s+incluido/i.test(text)&&!vatExcluded;
  const fuelPct=(()=>{
    const lines=text.split(/\r?\n/).filter(line=>/combustible|fuel/i.test(line));
    for(const line of lines){
      for(const match of line.matchAll(/(\d+(?:[.,]\d+)?)\s*%/g)){
        const before=line.slice(Math.max(0,(match.index||0)-28),match.index||0);
        if(/iva|vat|impuesto/i.test(before))continue;
        if(/combustible|fuel|plus|recargo|suplemento/i.test(line))return num(match[1]);
      }
    }
    return null;
  })();
  const fuelExcluded=/combustible\s+no\s+incluido|plus\s+combustible\s+no\s+incluido|fuel\s+not\s+included/i.test(text);
  const fuelIncluded=/combustible\s+incluido|fuel\s+included/i.test(text)&&!fuelExcluded;
  const mrwServices=mrw?parseMrwServices(text):[];
  const namedGenericServices=mrwServices.length?[]:parseGenericCarrierServices(text);
  const matrixServices=mrwServices.length||namedGenericServices.length?[]:parseGenericMatrixServices(text);
  const checked=validateParsedServices(mrwServices.length?mrwServices:namedGenericServices.length?namedGenericServices:matrixServices);
  const services=checked.services;
  const genericServices=namedGenericServices.length?namedGenericServices:matrixServices;
  const providers=[...new Set(services.map(service=>service.externalProvider).filter(Boolean))];
  const multiCarrier=providers.length>1||/\benvia(?:\.com)?\b/i.test(text);
  return {
    carrierCode:mrwServices.length?'mrw':multiCarrier?'envia':providers[0]||slug(fileName.split('.')[0])||'carrier',
    carrierName:mrwServices.length?'MRW':multiCarrier?'Envia.com · Tarifas contratadas':providers[0]?genericCarriers.find(item=>item.code===providers[0])?.label||clean(fileName.replace(/\.[^.]+$/,'')):clean(fileName.replace(/\.[^.]+$/,''))||'Transportista',
    effectiveFrom:null,effectiveTo,currencyCode:probableCurrency(text),pricesIncludeVat:vatIncluded,fuelSurchargePct:fuelPct,
    fuelSurchargeIncluded:fuelIncluded,parserProvider:'automatic-rules',parserModel:null,
    parserConfidence:mrwServices.length?0.86:genericServices.length?0.68:0.45,
    parserNotes:[services.length?`${services.length} servicios detectados automáticamente.`:'No se detectaron tablas de peso automáticamente; revisa y añade los tramos.',...checked.notes,genericServices.length?'Se ha usado el lector genérico multitransportista: confirma transportista, servicio, zona y pesos antes de activar.':null,vatExcluded?'El documento indica precios sin IVA.':'Revisa si los precios incluyen IVA.',fuelExcluded?'El documento indica que el combustible no está incluido.':fuelIncluded?'El documento indica que el combustible está incluido.':'No se ha podido determinar el tratamiento del combustible; revísalo.'].filter(Boolean) as string[],services,
  };
}

function normalizeProposal(value:any,fallback:TransportTariffProposal):TransportTariffProposal{
  if(!value||typeof value!=='object')return fallback;
  const services=Array.isArray(value.services)?value.services.map((service:any,index:number)=>({
    serviceName:clean(service.serviceName)||`Servicio ${index+1}`,canonicalServiceKey:slug(service.canonicalServiceKey||service.serviceName||`service-${index+1}`),
    externalProvider:clean(service.externalProvider)||fallback.carrierCode,externalServiceCode:clean(service.externalServiceCode)||slug(service.serviceName||`service-${index+1}`),
    mappingStatus:(['suggested','confirmed','unmapped'].includes(service.mappingStatus)?service.mappingStatus:'suggested') as TransportMappingStatus,sortOrder:index,
    bands:Array.isArray(service.bands)?service.bands.map((band:any,bandIndex:number)=>({countryCode:clean(band.countryCode).toUpperCase().slice(0,2),zoneCode:slug(band.zoneCode||band.zoneName||'zone'),zoneName:clean(band.zoneName)||clean(band.zoneCode)||'Zona',minWeightKg:Number(band.minWeightKg||0),maxWeightKg:band.maxWeightKg==null?null:Number(band.maxWeightKg),basePrice:band.basePrice==null?null:Number(band.basePrice),extraKgPrice:band.extraKgPrice==null?null:Number(band.extraKgPrice),notes:clean(band.notes)||null,sortOrder:bandIndex})).filter((band:any)=>band.countryCode.length===2&&(band.basePrice!=null||band.extraKgPrice!=null)):[],
  })).filter((service:any)=>service.serviceName):fallback.services;
  const proposal={...fallback,...value,carrierCode:slug(value.carrierCode||fallback.carrierCode),carrierName:clean(value.carrierName)||fallback.carrierName,effectiveFrom:value.effectiveFrom||null,effectiveTo:value.effectiveTo||null,currencyCode:clean(value.currencyCode||fallback.currencyCode).toUpperCase(),fuelSurchargePct:value.fuelSurchargePct==null?null:Number(value.fuelSurchargePct),parserConfidence:Number(value.parserConfidence??fallback.parserConfidence),parserNotes:Array.isArray(value.parserNotes)?value.parserNotes.map(clean).filter(Boolean):fallback.parserNotes,services};
  const checked=validateParsedServices(proposal.services);
  const warnings=[...new Set([...proposal.parserNotes,...checked.notes])];
  const suspiciousFuel=proposal.fuelSurchargePct!=null&&(!Number.isFinite(proposal.fuelSurchargePct)||proposal.fuelSurchargePct<0||proposal.fuelSurchargePct>100);
  if(suspiciousFuel)warnings.push('Se descartó un porcentaje de combustible incoherente.');
  return {...proposal,fuelSurchargePct:suspiciousFuel?null:proposal.fuelSurchargePct,parserConfidence:Math.max(0,Math.min(1,Number(proposal.parserConfidence)||0)),parserNotes:warnings,services:checked.services};
}

export async function parseTransportTariffDocument(file:File):Promise<TransportTariffProposal>{
  const text=await readTransportDocumentText(file);if(!clean(text))throw new Error('No se ha podido extraer texto del documento.');
  const fallback=fallbackProposal(text,file.name);
  try{
    const {data,error}=await supabase.functions.invoke('transport-tariff-parser',{body:{fileName:file.name,mimeType:file.type,text:text.slice(0,90000),fallback}});
    if(!error&&data?.proposal)return normalizeProposal(data.proposal,{...fallback,parserProvider:data.parserProvider||fallback.parserProvider,parserModel:data.parserModel||null,parserConfidence:Number(data.parserConfidence??fallback.parserConfidence)});
  }catch{/* El lector automático local mantiene el flujo disponible si el proveedor IA no está configurado. */}
  return fallback;
}

function mapDocument(row:any):TransportTariffDocument{
  const revisions=(row.transport_tariff_revisions||[]).sort((a:any,b:any)=>String(a.effective_from||'').localeCompare(String(b.effective_from||''))).map((item:any)=>({id:item.id,effectiveFrom:item.effective_from,snapshot:item.snapshot as TransportTariffProposal}));
  const services=(row.transport_tariff_services||[]).sort((a:any,b:any)=>(a.sort_order||0)-(b.sort_order||0)).map((service:any)=>({id:service.id,serviceName:service.service_name,canonicalServiceKey:service.canonical_service_key,externalProvider:service.external_provider||'',externalServiceCode:service.external_service_code||'',mappingStatus:service.mapping_status,sortOrder:service.sort_order,bands:(service.transport_tariff_bands||[]).sort((a:any,b:any)=>(a.sort_order||0)-(b.sort_order||0)).map((band:any)=>({id:band.id,countryCode:band.country_code,zoneCode:band.zone_code,zoneName:band.zone_name,minWeightKg:Number(band.min_weight_kg),maxWeightKg:band.max_weight_kg==null?null:Number(band.max_weight_kg),basePrice:band.base_price==null?null:Number(band.base_price),extraKgPrice:band.extra_kg_price==null?null:Number(band.extra_kg_price),notes:band.notes||null,sortOrder:band.sort_order}))}));
  return {id:row.id,status:row.status,shippingProvider:(row.shipping_provider==='envia'?'envia':'sendcloud'),carrierCode:row.carrier_code,carrierName:row.carrier_name,effectiveFrom:row.effective_from||null,effectiveTo:row.effective_to||null,currencyCode:row.currency_code,pricesIncludeVat:Boolean(row.prices_include_vat),fuelSurchargePct:row.fuel_surcharge_pct==null?null:Number(row.fuel_surcharge_pct),fuelSurchargeIncluded:Boolean(row.fuel_surcharge_included),parserProvider:row.parser_provider||'unknown',parserModel:row.parser_model||null,parserConfidence:Number(row.parser_confidence||0),parserNotes:Array.isArray(row.parser_notes?.notes)?row.parser_notes.notes:[],services,revisions,sourceFileName:row.source_file_name||null,sourceFilePath:row.source_file_path||null,sourceMimeType:row.source_mime_type||null,createdAt:row.created_at,reviewedAt:row.reviewed_at||null,activatedAt:row.activated_at||null};
}

async function insertServices(documentId:string,ownerId:string,carrierCode:string,services:TransportTariffServiceDraft[]){
  const {data:mappings}=await supabase.from('transport_service_mappings').select('*').eq('owner_id',ownerId).eq('carrier_code',carrierCode);
  const byKey=new Map((mappings||[]).map((item:any)=>[item.canonical_service_key,item]));
  for(let index=0;index<services.length;index+=1){
    const service=services[index],remembered=byKey.get(service.canonicalServiceKey) as any;
    const payload={owner_id:ownerId,document_id:documentId,service_name:service.serviceName,canonical_service_key:service.canonicalServiceKey,external_provider:remembered?.external_provider||service.externalProvider||null,external_service_code:remembered?.external_service_code||service.externalServiceCode||null,mapping_status:remembered?'confirmed':service.mappingStatus,sort_order:index};
    const {data:saved,error}=await supabase.from('transport_tariff_services').insert(payload).select('id').single();if(error)throw error;
    if(service.bands.length){const bands=service.bands.map((band,bandIndex)=>({owner_id:ownerId,service_id:saved.id,country_code:band.countryCode.toUpperCase(),zone_code:band.zoneCode,zone_name:band.zoneName,min_weight_kg:band.minWeightKg,max_weight_kg:band.maxWeightKg,base_price:band.basePrice,extra_kg_price:band.extraKgPrice,notes:band.notes||null,sort_order:bandIndex}));const {error:bandError}=await supabase.from('transport_tariff_bands').insert(bands);if(bandError)throw bandError}
  }
}

export async function createTransportTariffDraft(file:File,proposal:TransportTariffProposal,shippingProvider:TransportShippingProvider){
  const {data:{user}}=await supabase.auth.getUser();if(!user)throw new Error('Sesión no válida.');
  const id=crypto.randomUUID(),path=`${user.id}/${id}/${safeFileName(file.name)}`,digest=await sha256(file);
  const {error:uploadError}=await supabase.storage.from(BUCKET).upload(path,file,{contentType:file.type||undefined,upsert:false});if(uploadError)throw uploadError;
  try{
    const documentPayload={id,shipping_provider:shippingProvider,carrier_code:proposal.carrierCode,carrier_name:proposal.carrierName,status:'draft',effective_from:proposal.effectiveFrom,effective_to:proposal.effectiveTo,currency_code:proposal.currencyCode,prices_include_vat:proposal.pricesIncludeVat,fuel_surcharge_pct:proposal.fuelSurchargePct,fuel_surcharge_included:proposal.fuelSurchargeIncluded,source_file_name:file.name,source_file_path:path,source_mime_type:file.type||null,source_sha256:digest,parser_provider:proposal.parserProvider,parser_model:proposal.parserModel,parser_confidence:proposal.parserConfidence,parser_notes:{notes:proposal.parserNotes}};
    const {data:document,error}=await supabase.from('transport_tariff_documents').insert(documentPayload).select('id,owner_id').single();if(error)throw error;
    await insertServices(document.id,document.owner_id,proposal.carrierCode,proposal.services);
    return document.id as string;
  }catch(error){await supabase.storage.from(BUCKET).remove([path]).catch(()=>undefined);await supabase.from('transport_tariff_documents').delete().eq('id',id);throw error}
}

export async function reanalyzeTransportTariffDraft(document:TransportTariffDocument){
  if(document.status!=='draft')throw new Error('Solo se puede reanalizar una tarifa en borrador.');
  if(!document.sourceFilePath)throw new Error('La tarifa no conserva el documento original.');
  const {data,error}=await supabase.storage.from(BUCKET).download(document.sourceFilePath);
  if(error||!data)throw error||new Error('No se pudo recuperar el documento original.');
  const file=new File([data],document.sourceFileName||'tarifa.pdf',{type:document.sourceMimeType||data.type||'application/pdf'});
  const proposal=await parseTransportTariffDocument(file);
  const next:TransportTariffDocument={...document,...proposal};
  await saveTransportTariffReview(next);
  return next;
}

export async function listTransportTariffs():Promise<TransportTariffDocument[]>{
  const {data,error}=await supabase.from('transport_tariff_documents').select('*,transport_tariff_revisions(*),transport_tariff_services(*,transport_tariff_bands(*))').order('created_at',{ascending:false});if(error)throw error;return (data||[]).map(mapDocument);
}

export async function saveTransportTariffReview(document:TransportTariffDocument){
  if(document.status!=='draft')throw new Error('Solo se pueden modificar borradores con esta operación.');
  const {data:ownerRow,error:ownerError}=await supabase.from('transport_tariff_documents').select('owner_id').eq('id',document.id).single();if(ownerError)throw ownerError;
  const {error}=await supabase.from('transport_tariff_documents').update({shipping_provider:document.shippingProvider,carrier_code:document.carrierCode,carrier_name:document.carrierName,effective_from:document.effectiveFrom,effective_to:document.effectiveTo,currency_code:document.currencyCode,prices_include_vat:document.pricesIncludeVat,fuel_surcharge_pct:document.fuelSurchargePct,fuel_surcharge_included:document.fuelSurchargeIncluded,parser_provider:document.parserProvider,parser_model:document.parserModel,parser_confidence:document.parserConfidence,parser_notes:{notes:document.parserNotes},updated_at:new Date().toISOString()}).eq('id',document.id);if(error)throw error;
  const {error:deleteError}=await supabase.from('transport_tariff_services').delete().eq('document_id',document.id);if(deleteError)throw deleteError;
  await insertServices(document.id,ownerRow.owner_id,document.carrierCode,document.services);
}

function tariffSnapshot(document:TransportTariffDocument):TransportTariffProposal{
  return {
    carrierCode:document.carrierCode,carrierName:document.carrierName,effectiveFrom:document.effectiveFrom,effectiveTo:document.effectiveTo,
    currencyCode:document.currencyCode,pricesIncludeVat:document.pricesIncludeVat,fuelSurchargePct:document.fuelSurchargePct,
    fuelSurchargeIncluded:document.fuelSurchargeIncluded,parserProvider:document.parserProvider,parserModel:document.parserModel,
    parserConfidence:document.parserConfidence,parserNotes:document.parserNotes,
    services:document.services.map(service=>({...service,bands:service.bands.map(band=>({...band}))}))
  };
}

export async function saveActiveTransportTariff(document:TransportTariffDocument,applyFrom:string){
  if(document.status!=='active')throw new Error('La tarifa no está activa.');
  if(!applyFrom)throw new Error('Indica desde qué fecha se aplican los cambios.');
  const {data,error}=await supabase.rpc('transport_tariff_save_active',{document_id:document.id,apply_from:applyFrom,snapshot:tariffSnapshot(document)});if(error)throw error;
  const {error:repriceError}=await supabase.rpc('transport_tariff_reprice_estimates',{document_id:document.id});if(repriceError)throw repriceError;
  return data;
}

export async function markTransportTariffReviewed(documentId:string){const {data,error}=await supabase.rpc('transport_tariff_mark_reviewed',{document_id:documentId});if(error)throw error;return data}
export async function activateTransportTariff(documentId:string){const {data,error}=await supabase.rpc('transport_tariff_activate',{document_id:documentId});if(error)throw error;return data}
export async function deleteTransportTariffDraft(document:TransportTariffDocument){if(!['draft','reviewed'].includes(document.status))throw new Error('Una tarifa activa no se puede eliminar.');const {error}=await supabase.from('transport_tariff_documents').delete().eq('id',document.id);if(error)throw error;if(document.sourceFilePath)await supabase.storage.from(BUCKET).remove([document.sourceFilePath]).catch(()=>undefined)}
