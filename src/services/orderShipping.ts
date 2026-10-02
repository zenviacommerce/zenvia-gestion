import type { FulfillmentOrder, ShippingOption } from './orders';
import type { TransportTariffDocument } from './transportTariffs';

export type ValidationSeverity='error'|'warning';
export interface OrderValidationIssue{field:string;severity:ValidationSeverity;message:string}
export interface OrderValidationResult{blocking:boolean;issues:OrderValidationIssue[]}
export interface ShippingPricePreview{
  totalAmount:number|null;
  netAmount:number|null;
  taxAmount:number|null;
  currency:string;
  carrierName:string;
  serviceName:string;
  source:'tariff_estimate'|'provider_quote'|'recorded';
  note?:string|null;
}

const clean=(value:unknown)=>String(value??'').trim();
function addLengthIssue(issues:OrderValidationIssue[],field:string,label:string,value:unknown,max:number,required=false){
  const text=clean(value);
  if(required&&!text){issues.push({field,severity:'error',message:`${label}: obligatorio.`});return}
  if(text.length>max)issues.push({field,severity:'error',message:`${label}: ${text.length}/${max} caracteres.`});
}
function normalizedPhoneDigits(value:unknown){return clean(value).replace(/[^0-9]+/g,'')}
function addPhoneIssue(issues:OrderValidationIssue[],value:unknown,countryCode:string,required=false,maxChars=20){
  const raw=clean(value);
  if(required&&!raw){issues.push({field:'phone',severity:'error',message:'Teléfono: obligatorio para este transportista.'});return}
  if(!raw)return;
  if(raw.length>maxChars){issues.push({field:'phone',severity:'error',message:`Teléfono: ${raw.length}/${maxChars} caracteres.`});return}
  const digits=normalizedPhoneDigits(raw);
  if(countryCode==='ES'){
    const national=digits.startsWith('0034')?digits.slice(4):(digits.startsWith('34')&&digits.length===11?digits.slice(2):digits);
    if(national.length!==9){
      issues.push({field:'phone',severity:'error',message:`Teléfono: para España debe tener 9 dígitos, o 34 + 9 dígitos. Ahora tiene ${digits.length} dígitos.`});
    }
    return;
  }
  if(digits.length<7||digits.length>15){
    issues.push({field:'phone',severity:'error',message:`Teléfono: debe contener entre 7 y 15 dígitos internacionales. Ahora tiene ${digits.length}.`});
  }
}
function addEmailIssue(issues:OrderValidationIssue[],value:unknown,required=false,max=254){
  const email=clean(value);
  if(required&&!email){issues.push({field:'email',severity:'error',message:'Email: obligatorio para este transportista.'});return}
  if(!email)return;
  if(email.length>max){issues.push({field:'email',severity:'error',message:`Email: ${email.length}/${max} caracteres.`});return}
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))issues.push({field:'email',severity:'error',message:'Email: formato no válido.'});
}

export function validateOrderForCarrier(order:FulfillmentOrder,carrierCode=''):OrderValidationResult{
  const address=order.shippingAddress||{},issues:OrderValidationIssue[]=[];
  const carrierHint=clean(carrierCode||order.carrierCode||order.carrierName||order.shippingOptionCode||order.shippingServiceName).toLowerCase();
  const isMrw=carrierHint.includes('mrw');
  const requiresMrwDimensions=isMrw&&(/\b0200\b|\b0205\b|\b0220\b/.test(carrierHint)||/urgente\s*19/.test(carrierHint));
  const country=clean(address.country_code).toUpperCase();
  const name=order.customerName||address.name;
  addLengthIssue(issues,'name','Nombre',name,isMrw?50:80,true);
  addLengthIssue(issues,'address_line_1','Dirección',address.address_line_1,isMrw?50:80,true);
  addLengthIssue(issues,'city','Ciudad',address.city,isMrw?30:80,true);
  addLengthIssue(issues,'postal_code','Código postal',address.postal_code,isMrw?8:30,true);
  addLengthIssue(issues,'country_code','País',country,2,true);
  if(country&&country.length!==2)issues.push({field:'country_code',severity:'error',message:'País: debe ser un código ISO de 2 letras.'});
  const postal=clean(address.postal_code).replace(/\s+/g,'');
  if(country==='ES'&&postal&&!/^\d{5}$/.test(postal))issues.push({field:'postal_code',severity:'error',message:'Código postal: en España debe tener 5 dígitos.'});
  addPhoneIssue(issues,order.customerPhone||address.phone_number,country,isMrw,isMrw?20:30);
  addEmailIssue(issues,order.customerEmail||address.email,false,isMrw?50:254);
  if(isMrw){
    addLengthIssue(issues,'address_line_2','Dirección 2',address.address_line_2,60,false);
    addLengthIssue(issues,'house_number','Número',address.house_number,20,false);
  }
  if(order.weightKg==null||!Number.isFinite(order.weightKg)||order.weightKg<=0)issues.push({field:'weight',severity:'error',message:'Peso: debe ser mayor que 0 kg.'});
  if(requiresMrwDimensions){
    const dimensions=[
      ['package_length_cm','Largo',order.packageLengthCm],
      ['package_width_cm','Ancho',order.packageWidthCm],
      ['package_height_cm','Alto',order.packageHeightCm],
    ] as const;
    for(const [field,label,value] of dimensions){
      if(value==null||!Number.isFinite(value)||value<=0)issues.push({field,severity:'error',message:`${label} del paquete: obligatorio para MRW.`});
    }
  }
  return {blocking:issues.some(issue=>issue.severity==='error'),issues};
}

function inDateRange(document:TransportTariffDocument,order:FulfillmentOrder){
  const raw=(order.orderCreatedAt||new Date().toISOString()).slice(0,10);
  return (!document.effectiveFrom||raw>=document.effectiveFrom)&&(!document.effectiveTo||raw<=document.effectiveTo);
}

const tariffKey=(value:unknown)=>clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
function destinationZone(order:FulfillmentOrder){
  const country=clean(order.shippingAddress?.country_code).toUpperCase();
  const postal=clean(order.shippingAddress?.postal_code).replace(/\s+/g,'');
  if(country==='ES'){
    if(/^07\d{3}$/.test(postal))return 'balearic';
    if(/^(35|38)\d{3}$/.test(postal))return 'canary';
    if(/^51\d{3}$/.test(postal))return 'ceuta';
    if(/^52\d{3}$/.test(postal))return 'melilla';
    return 'peninsular';
  }
  if(country==='PT')return 'peninsular';
  return '';
}
function matchingBand(service:TransportTariffDocument['services'][number],order:FulfillmentOrder){
  if(order.weightKg==null||!Number.isFinite(order.weightKg)||order.weightKg<=0)return null;
  const country=clean(order.shippingAddress?.country_code).toUpperCase();
  const countryBands=service.bands.filter(band=>band.countryCode===country);
  if(!countryBands.length)return null;
  const desiredZone=destinationZone(order);
  let zoneBands=desiredZone?countryBands.filter(band=>{
    const code=tariffKey(band.zoneCode),name=tariffKey(band.zoneName);
    if(desiredZone==='balearic')return /balear|baleares|illes-balears/.test(code+' '+name);
    if(desiredZone==='canary')return /canar/.test(code+' '+name);
    if(desiredZone==='ceuta')return /ceuta/.test(code+' '+name);
    if(desiredZone==='melilla')return /melilla/.test(code+' '+name);
    return /peninsular|peninsula/.test(code+' '+name);
  }):[];
  if(!zoneBands.length){
    const distinct=[...new Set(countryBands.map(band=>tariffKey(band.zoneCode||band.zoneName)))];
    if(distinct.length!==1)return null;
    zoneBands=countryBands;
  }
  const weight=order.weightKg;
  return zoneBands.sort((a,b)=>(a.maxWeightKg??Number.MAX_VALUE)-(b.maxWeightKg??Number.MAX_VALUE))
    .find(band=>weight>=(band.minWeightKg||0)&& (band.maxWeightKg==null||weight<=band.maxWeightKg))||null;
}
function serviceScore(document:TransportTariffDocument,service:TransportTariffDocument['services'][number],option:ShippingOption){
  // A carrier tariff belongs to the carrier contract, not to the aggregator used
  // to reach it. The same Correos/MRW/SEUR tariff must therefore be comparable
  // against Sendcloud and Envia.com options when the carrier/service matches.
  const carrierCandidates=[option.carrierCode,option.carrierName].map(tariffKey).filter(Boolean);
  const docCarrier=[document.carrierCode,document.carrierName].map(tariffKey).filter(Boolean);
  const externalProvider=tariffKey(service.externalProvider);
  const providerMatch=carrierCandidates.some(candidate=>docCarrier.some(value=>value===candidate||value.includes(candidate)||candidate.includes(value)))
    ||carrierCandidates.some(candidate=>externalProvider&&(candidate===externalProvider||candidate.includes(externalProvider)||externalProvider.includes(candidate)));
  if(!providerMatch)return -1;

  const optionCodes=[option.code,option.name].map(tariffKey).filter(Boolean);
  const serviceCodes=[service.externalServiceCode,service.canonicalServiceKey,service.serviceName].map(tariffKey).filter(Boolean);

  // MRW SAGEC identifies services with numeric codes while our uploaded tariff
  // uses commercial names ("Mañana 19 h", etc.). Bridge the direct API option to
  // the tariff by the service time instead of requiring identical codes.
  if(carrierCandidates.some(value=>value.includes('mrw'))){
    const optionText=`${tariffKey(option.code)} ${tariffKey(option.name)}`;
    const serviceText=serviceCodes.join(' ');
    const hourMatch=optionText.match(/(?:^|\D)(10|12|14|19)(?:\D|$)/);
    if(hourMatch&&new RegExp(`(?:^|\\D)${hourMatch[1]}(?:\\D|$)`).test(serviceText))return 95;
    if(tariffKey(option.code)==='0205'&&/19/.test(serviceText))return 95;
  }

  if(option.code&&service.externalServiceCode&&tariffKey(option.code)===tariffKey(service.externalServiceCode))return 100;
  if(optionCodes.some(value=>serviceCodes.includes(value)))return 80;
  if(optionCodes.some(value=>serviceCodes.some(candidate=>value.length>=4&&candidate.length>=4&&(value.includes(candidate)||candidate.includes(value)))))return 55;
  // If a carrier tariff only contains one service, allow that service as a safe
  // carrier-level estimate. Never do this for multi-carrier Envia documents.
  if(document.carrierCode!=='envia'&&document.services.length===1)return 20;
  return -1;
}

export interface ContractedTariffComparison extends ShippingPricePreview{
  documentId:string;
  documentName:string;
  matchedServiceCode:string;
}

export function estimateTransportTariffForOption(order:FulfillmentOrder,tariffs:TransportTariffDocument[],option:ShippingOption,vatRate=21):ContractedTariffComparison|null{
  if(order.weightKg==null||!Number.isFinite(order.weightKg)||order.weightKg<=0)return null;
  const candidates=tariffs
    .filter(document=>(document.status==='active'||document.status==='superseded')&&inDateRange(document,order)&&document.services.length>0)
    .flatMap(document=>{
      const orderDate=(order.orderCreatedAt||new Date().toISOString()).slice(0,10);
      const revision=(document.revisions||[]).filter(item=>item.effectiveFrom<=orderDate).sort((a,b)=>b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
      const config=(revision?.snapshot||document) as TransportTariffDocument;
      return config.services.map(service=>({document,config,service,score:serviceScore(document,service,option)}));
    })
    .filter(item=>item.score>=0)
    .sort((a,b)=>b.score-a.score);

  for(const item of candidates){
    const band=matchingBand(item.service,order);
    if(!band||band.basePrice==null)continue;
    let base=band.basePrice;
    if(band.maxWeightKg==null&&band.extraKgPrice!=null&&order.weightKg>band.minWeightKg){
      base+=Math.ceil(order.weightKg-band.minWeightKg)*band.extraKgPrice;
    }
    const fuelPct=item.config.fuelSurchargeIncluded?0:(item.config.fuelSurchargePct??0);
    const priced=base*(1+fuelPct/100);
    let netAmount:number,totalAmount:number,taxAmount:number;
    if(item.config.pricesIncludeVat){
      totalAmount=priced;netAmount=priced/(1+vatRate/100);taxAmount=totalAmount-netAmount;
    }else{
      netAmount=priced;taxAmount=netAmount*(vatRate/100);totalAmount=netAmount+taxAmount;
    }
    const round=(value:number)=>Math.round((value+Number.EPSILON)*100)/100;
    return {
      totalAmount:round(totalAmount),
      netAmount:round(netAmount),
      taxAmount:round(taxAmount),
      currency:item.config.currencyCode||'EUR',
      carrierName:option.carrierName||option.carrierCode,
      serviceName:item.service.serviceName,
      source:'tariff_estimate',
      note:item.score<50?'Estimación por tarifa del transportista':'Tarifa contratada asociada al servicio',
      documentId:item.document.id,
      documentName:item.document.carrierName,
      matchedServiceCode:item.service.externalServiceCode||item.service.canonicalServiceKey,
    };
  }
  return null;
}

export function calculateDefaultShippingPreview(order:FulfillmentOrder,tariffs:TransportTariffDocument[],carrierCode='',vatRate=21):ShippingPricePreview|null{
  const dispatched=Boolean(order.shippingProvider||order.sendcloudParcelId||order.shippingRemoteId||order.fulfilledAt||order.labelCreatedAt);
  const actualCarrier=clean(order.carrierCode||order.carrierName||order.shippingOptionCode?.split(':')[0]);
  const carrier=dispatched?actualCarrier:clean(carrierCode||actualCarrier);
  if(!carrier||order.weightKg==null)return null;
  const serviceName=clean(order.shippingServiceName);
  const serviceCode=clean(order.shippingOptionCode);
  // Only pending MRW orders may use the configured default service. An existing
  // shipment must be valued against its own carrier and service.
  const defaultService=!dispatched&&carrier.toLowerCase().includes('mrw')?'manana-19h':'';
  if(dispatched&&!serviceName&&!serviceCode)return null;
  return estimateTransportTariffForOption(order,tariffs,{
    provider:order.shippingProvider||'sendcloud',providerName:'Tarifa contratada',
    carrierCode:carrier,carrierName:order.carrierName||carrier,
    code:serviceCode||defaultService,name:serviceName||defaultService,
    contractId:order.contractId,price:null,currency:null,raw:{},
  },vatRate);
}

export function previewFromShippingOption(option:ShippingOption|null):ShippingPricePreview|null{
  if(!option||option.price==null)return null;
  return {totalAmount:option.price,netAmount:null,taxAmount:null,currency:option.currency||'EUR',carrierName:option.carrierName||option.carrierCode,serviceName:option.name,source:'provider_quote',note:`Cotización ${option.providerName||'logística'}`};
}

export function shippingPriceForOrder(order:FulfillmentOrder,preview:ShippingPricePreview|null|undefined):ShippingPricePreview|null{
  if(order.shippingCostSource==='tariff_estimate'&&preview)return preview;
  if(order.shippingCostAmount!=null){
    return {
      totalAmount:order.shippingCostAmount,
      netAmount:order.shippingCostNetAmount,
      taxAmount:order.shippingCostTaxAmount,
      currency:order.shippingCostCurrency||'EUR',
      carrierName:order.carrierName||'Transportista',
      serviceName:order.shippingServiceName||order.shippingOptionCode||'Servicio seleccionado',
      source:'recorded',
      note:null,
    };
  }
  return preview||null;
}


export function trackingUrlForOrder(order:FulfillmentOrder):string|null{
  // The carrier is not a URL directory. Use the shipment's recorded link;
  // provider links are resolved on the server, never guessed in the browser.
  for(const value of [order.carrierTrackingUrl,order.trackingUrl]){
    try{
      if(!value)continue;
      const url=new URL(value);
      const host=url.hostname.toLowerCase();
      const provider=['envia.com','sendcloud.com','sendcloud.sc'].some(domain=>host===domain||host.endsWith(`.${domain}`));
      if(['https:','http:'].includes(url.protocol)&&!url.username&&!url.password&&!provider)return url.href;
    }catch{/* The drawer will request fresh shipment metadata. */}
  }
  return null;
}
