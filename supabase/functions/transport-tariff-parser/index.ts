import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
};
const headers={...corsHeaders,'Content-Type':'application/json'};
const response=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
const clean=(value:unknown,max=200000)=>typeof value==='string'?value.replace(/\s+/g,' ').trim().slice(0,max):'';
const slug=(value:string)=>clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const num=(value:unknown)=>{const raw=String(value??'').replace(/\s/g,'').replace(/\.(?=\d{3}(?:\D|$))/g,'').replace(',','.').replace(/[^\d.-]/g,'');const parsed=Number(raw);return Number.isFinite(parsed)?parsed:null};
function getAdminKey(){const raw=Deno.env.get('SUPABASE_SECRET_KEYS');if(raw){try{const parsed=JSON.parse(raw);if(typeof parsed?.default==='string'&&parsed.default.trim())return parsed.default.trim()}catch{}}return clean(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),5000)}
function norm(value:unknown){return clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim()}
function tokens(value:unknown){return new Set(norm(value).split(' ').filter(token=>token.length>1))}
function similarity(a:unknown,b:unknown){const aa=tokens(a),bb=tokens(b);if(!aa.size||!bb.size)return 0;let common=0;for(const token of aa)if(bb.has(token))common++;return common/Math.max(aa.size,bb.size)}

const carriers=[
  {code:'correos_express',name:'Correos Express',rx:/\bcorreos\s+express\b/i},
  {code:'correos',name:'Correos',rx:/\bcorreos\b/i},
  {code:'mrw',name:'MRW',rx:/\bmrw\b/i},
  {code:'seur',name:'SEUR',rx:/\bseur\b/i},
  {code:'gls',name:'GLS',rx:/\bgls\b/i},
  {code:'nacex',name:'Nacex',rx:/\bnacex\b/i},
  {code:'ctt_express',name:'CTT Express',rx:/\bctt\s*express\b/i},
  {code:'inpost',name:'InPost',rx:/\bin\s*post\b/i},
  {code:'ups',name:'UPS',rx:/\bups\b/i},
  {code:'dhl',name:'DHL',rx:/\bdhl\b/i},
  {code:'dpd',name:'DPD',rx:/\bdpd\b/i},
  {code:'fedex',name:'FedEx',rx:/\bfedex\b/i},
  {code:'zeleris',name:'Zeleris',rx:/\bzeleris\b/i},
  {code:'ontime',name:'Ontime',rx:/\bon\s*time\b/i},
];
function carrierIn(value:string){
  // Correos Express must win before Correos.
  return carriers.find(carrier=>carrier.rx.test(value))||null;
}
function prices(line:string){
  const explicit=[...line.matchAll(/(-?\d{1,5}(?:[.,]\d{1,4})?)\s*(?:€|EUR)(?=\W|$)/gi)]
    .map(match=>num(match[1])).filter((value):value is number=>value!=null&&value>=0&&value<100000);
  if(explicit.length)return explicit;
  const cells=line.split(/\t|\s{2,}|[|;]/).map(value=>value.trim()).filter(Boolean);
  const numeric=cells.map(cell=>{
    if(/%|kg|día|dia|hora|h\b/i.test(cell))return null;
    if(!/^-?\d{1,5}[.,]\d{2,4}$/.test(cell.replace(/\s/g,'')))return null;
    return num(cell);
  }).filter((value):value is number=>value!=null&&value>=0&&value<100000);
  return numeric;
}
function weights(line:string){
  return [...line.matchAll(/(?:hasta\s*)?(\d+(?:[.,]\d+)?)\s*(?:kg|kgs|kilogramos?)\b/gi)]
    .map(match=>num(match[1])).filter((value):value is number=>value!=null&&value>0&&value<10000);
}
function zoneFrom(value:string){
  const text=norm(value);
  if(/baleares|balear|mallorca|menorca|ibiza|formentera/.test(text))return {countryCode:'ES',zoneCode:'baleares',zoneName:'Baleares'};
  if(/canarias|canaria|tenerife|gran canaria|lanzarote|fuerteventura/.test(text))return {countryCode:'ES',zoneCode:'canarias',zoneName:'Canarias'};
  if(/ceuta/.test(text))return {countryCode:'ES',zoneCode:'ceuta',zoneName:'Ceuta'};
  if(/melilla/.test(text))return {countryCode:'ES',zoneCode:'melilla',zoneName:'Melilla'};
  if(/portugal/.test(text))return {countryCode:'PT',zoneCode:'peninsular',zoneName:'Portugal Peninsular'};
  return {countryCode:'ES',zoneCode:'peninsular',zoneName:'España Peninsular'};
}
function stripCommercialNoise(line:string,carrier:any){
  return clean(line
    .replace(carrier?.rx||/$^/,' ')
    .replace(/(?:hasta\s*)?\d+(?:[.,]\d+)?\s*(?:kg|kgs|kilogramos?)\b/gi,' ')
    .replace(/-?\d{1,5}(?:[.,]\d{1,4})?\s*(?:€|EUR)(?=\W|$)/gi,' ')
    .replace(/\b(?:iva|vat|combustible|fuel)\b.*$/i,' ')
    .replace(/[|;]+/g,' ')
    .replace(/\s+/g,' '));
}
function dateFromText(text:string){
  const match=text.match(/(?:vigencia|válid[oa]|validez)[^\n]{0,80}?(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/i);
  if(!match)return null;const year=match[3].length===2?'20'+match[3]:match[3];return `${year}-${match[2].padStart(2,'0')}-${match[1].padStart(2,'0')}`;
}
function vatInfo(text:string){
  const excluded=/no\s+incluyen?\s+iva|iva\s+no\s+incluido|sin\s+iva|más\s+iva|mas\s+iva/i.test(text);
  const included=/iva\s+incluido|impuestos?\s+incluidos?/i.test(text)&&!excluded;
  return {included,known:included||excluded};
}
function fuelInfo(text:string){
  const excluded=/combustible\s+no\s+incluido|fuel\s+not\s+included|plus\s+combustible/i.test(text);
  const included=/combustible\s+incluido|fuel\s+included/i.test(text)&&!excluded;
  let pct:number|null=null;
  for(const line of text.split(/\r?\n/).filter(line=>/combustible|fuel/i.test(line))){
    for(const fuel of line.matchAll(/combustible|fuel/gi)){
      const clause=line.slice((fuel.index||0)+fuel[0].length).split(/\b(?:iva|vat|impuesto)\b/i)[0];
      const after=clause.match(/^[^%\n]{0,40}?(\d+(?:[.,]\d+)?)\s*%/);
      const before=line.slice(0,fuel.index).match(/(\d+(?:[.,]\d+)?)\s*%\s*(?:de\s+)?$/i);
      if(after||before){pct=num((after||before)![1]);break}
    }
    if(pct!=null)break;
  }
  return {included,excluded,pct};
}
function currency(text:string){if(/\bUSD\b|\$/i.test(text))return 'USD';if(/\bGBP\b|£/.test(text))return 'GBP';return 'EUR'}

type Band={countryCode:string;zoneCode:string;zoneName:string;minWeightKg:number;maxWeightKg:number|null;basePrice:number|null;extraKgPrice:number|null;notes:string|null;sortOrder:number};
type Service={serviceName:string;canonicalServiceKey:string;externalProvider:string;externalServiceCode:string;mappingStatus:'suggested'|'unmapped';sortOrder:number;bands:Band[]};

function ownParse(text:string){
  const lines=text.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
  const services=new Map<string,Service>();
  const notes:string[]=[];
  let carrier:any=null,context='',headerWeights:number[]=[];
  let pageCarrierAge=0;

  const addBand=(carrierDef:any,label:string,band:Omit<Band,'sortOrder'>)=>{
    const serviceLabel=clean(label)||carrierDef.name;
    const key=slug(`${carrierDef.code}-${serviceLabel}`);
    if(!key)return;
    let service=services.get(key);
    if(!service){
      service={serviceName:`${carrierDef.name} · ${serviceLabel}`,canonicalServiceKey:key,externalProvider:carrierDef.code,externalServiceCode:slug(serviceLabel),mappingStatus:'suggested',sortOrder:services.size,bands:[]};
      services.set(key,service);
    }
    const duplicate=service.bands.some(existing=>existing.countryCode===band.countryCode&&existing.zoneCode===band.zoneCode&&existing.minWeightKg===band.minWeightKg&&existing.maxWeightKg===band.maxWeightKg&&existing.basePrice===band.basePrice);
    if(!duplicate)service.bands.push({...band,sortOrder:service.bands.length});
  };

  for(let index=0;index<lines.length;index++){
    const line=lines[index];
    if(/^\[\[(?:PAGE|SHEET)/i.test(line)){context='';headerWeights=[];pageCarrierAge++;continue}
    const detected=carrierIn(line);
    if(detected){carrier=detected;pageCarrierAge=0}
    else pageCarrierAge++;
    if(pageCarrierAge>80)carrier=null;

    const lineWeights=weights(line);
    if(lineWeights.length>=2&&(/peso|weight|kg|tramo/i.test(line)||lineWeights.length>=3)){
      headerWeights=[...new Set(lineWeights)].sort((a,b)=>a-b);
      if(line.length<180)context=stripCommercialNoise(line,carrier);
      continue;
    }

    const rowPrices=prices(line);
    const usableCarrier=detected||carrier;
    if(usableCarrier&&headerWeights.length>=2&&rowPrices.length>=headerWeights.length){
      const label=stripCommercialNoise(line,usableCarrier)||context||usableCarrier.name;
      const zone=zoneFrom(`${context} ${line}`);
      let minWeight=0;
      for(let col=0;col<headerWeights.length;col++){
        const price=rowPrices[col];if(price==null)continue;
        addBand(usableCarrier,label,{...zone,minWeightKg:minWeight,maxWeightKg:headerWeights[col],basePrice:price,extraKgPrice:null,notes:'Matriz peso/precio detectada por ZENVIA Tariff Engine.'});
        minWeight=headerWeights[col];
      }
      continue;
    }

    if(usableCarrier&&rowPrices.length){
      const weightValues=lineWeights;
      const zone=zoneFrom(`${context} ${line}`);
      const label=stripCommercialNoise(line,usableCarrier)||context||usableCarrier.name;
      if(weightValues.length===1&&rowPrices.length>=1){
        const maxWeight=weightValues[0],price=rowPrices[rowPrices.length-1];
        const key=slug(`${usableCarrier.code}-${label}`);
        const existing=services.get(key);
        const previousMax=existing?.bands.filter(b=>b.countryCode===zone.countryCode&&b.zoneCode===zone.zoneCode&&b.maxWeightKg!=null).map(b=>Number(b.maxWeightKg)).sort((a,b)=>b-a)[0]||0;
        if(maxWeight>previousMax)addBand(usableCarrier,label,{...zone,minWeightKg:previousMax,maxWeightKg:maxWeight,basePrice:price,extraKgPrice:null,notes:'Tramo peso/precio detectado por ZENVIA Tariff Engine.'});
        continue;
      }
      if(rowPrices.length===1&&line.length<220&&!/iva|vat|combustible|fuel|seguro|reembolso|suplemento|recargo|descuento|total|subtotal/i.test(line)){
        addBand(usableCarrier,label,{...zone,minWeightKg:0,maxWeightKg:null,basePrice:rowPrices[0],extraKgPrice:null,notes:'Precio plano sin tramo explícito; requiere revisión antes de activar.'});
        continue;
      }
    }

    if(line.length<160&&/[A-Za-zÀ-ÿ]{3}/.test(line)&&!/iva|vat|combustible|fuel|vigencia|condiciones|subtotal|total|cliente|propuesta\s+de\s+envios/i.test(line)){
      context=stripCommercialNoise(line,detected||carrier);
    }
  }

  const normalized=[...services.values()].map((service,serviceIndex)=>{
    const bands=service.bands.sort((a,b)=>a.countryCode.localeCompare(b.countryCode)||a.zoneCode.localeCompare(b.zoneCode)||a.minWeightKg-b.minWeightKg).map((band,index)=>({...band,sortOrder:index}));
    return {...service,sortOrder:serviceIndex,bands};
  }).filter(service=>service.bands.length);

  if(!normalized.length)notes.push('ZENVIA Tariff Engine no ha podido reconstruir ningún servicio con evidencia suficiente.');
  else notes.push(`${normalized.length} servicios reconstruidos por ZENVIA Tariff Engine.`);
  return {services:normalized,notes};
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  if(req.method!=='POST')return response({error:'Método no permitido.'},405);
  const url=Deno.env.get('SUPABASE_URL')||'',adminKey=getAdminKey();
  if(!url||!adminKey)return response({error:'Configuración interna no disponible.'},500);
  const admin=createClient(url,adminKey,{auth:{persistSession:false,autoRefreshToken:false}});
  try{
    const token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'').trim();
    if(!token)return response({error:'Sesión no válida.'},401);
    const {data:userData,error:userError}=await admin.auth.getUser(token);
    if(userError||!userData?.user)return response({error:'Sesión no válida.'},401);
    const {data:caller,error:callerError}=await admin.from('app_users').select('data_owner_id,role,active,permissions').eq('user_id',userData.user.id).maybeSingle();
    if(callerError)throw callerError;
    if(!caller?.active)return response({error:'Tu acceso está desactivado.'},403);
    const permissions=Array.isArray(caller.permissions)?caller.permissions:[];
    if(caller.role!=='admin'&&!permissions.includes('orders'))return response({error:'No tienes permiso para gestionar tarifas de transporte.'},403);

    const body=await req.json().catch(()=>({}));
    const text=String(body?.text||'').trim(),fileName=clean(body?.fileName,240)||'tarifa',fallback=body?.fallback||{};
    if(!text)return response({error:'El documento no contiene texto estructurado suficiente.'},400);

    const parsed=ownParse(text);
    const {data:mappings}=await admin.from('transport_service_mappings').select('carrier_code,canonical_service_key,external_provider,external_service_code').eq('owner_id',caller.data_owner_id);
    const learned=Array.isArray(mappings)?mappings:[];

    const services=parsed.services.map(service=>{
      const candidates=learned.map((mapping:any)=>({mapping,score:Math.max(
        similarity(service.canonicalServiceKey,mapping.canonical_service_key),
        similarity(service.serviceName,mapping.canonical_service_key),
      )})).filter(item=>item.score>=0.55).sort((a,b)=>b.score-a.score);
      const match=candidates[0]?.mapping;
      return match?{...service,externalProvider:clean(match.external_provider)||service.externalProvider,externalServiceCode:clean(match.external_service_code)||service.externalServiceCode,mappingStatus:'suggested' as const}:service;
    });

    const providers=[...new Set(services.map(service=>service.externalProvider).filter(Boolean))];
    const single=providers.length===1?carriers.find(carrier=>carrier.code===providers[0]):null;
    const vat=vatInfo(text),fuel=fuelInfo(text);
    const proposal={
      carrierCode:single?.code||(providers.length>1?'multi-carrier':slug(fileName.replace(/\.[^.]+$/,''))||'carrier'),
      carrierName:single?.name||(providers.length>1?'Varios transportistas':clean(fileName.replace(/\.[^.]+$/,''))||'Transportista'),
      effectiveFrom:null,
      effectiveTo:dateFromText(text),
      currencyCode:currency(text),
      pricesIncludeVat:vat.included,
      fuelSurchargePct:fuel.pct,
      fuelSurchargeIncluded:fuel.included,
      parserProvider:'zenvia-tariff-engine',
      parserModel:'zte-v2',
      parserConfidence:services.length?Math.min(.95,.58+Math.min(services.length,8)*.045):0,
      parserNotes:[
        ...parsed.notes,
        learned.length?'Se han aplicado asociaciones aprendidas de tarifas revisadas anteriormente.':'Aún no hay asociaciones históricas suficientes para aprendizaje por revisión.',
        vat.known?(vat.included?'El documento indica IVA incluido.':'El documento indica IVA no incluido.'):'Tratamiento del IVA no determinado; revisar.',
        fuel.included?'El documento indica combustible incluido.':fuel.excluded?'El documento indica combustible no incluido.':'Tratamiento del combustible no determinado; revisar.',
      ],
      services,
    };

    return response({proposal,parserProvider:'zenvia-tariff-engine',parserModel:'zte-v2',parserConfidence:proposal.parserConfidence});
  }catch(error){
    return response({error:error instanceof Error?error.message:String(error||'Error interno del parser.')},500);
  }
});
