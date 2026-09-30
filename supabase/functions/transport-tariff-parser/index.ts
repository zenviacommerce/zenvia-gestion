import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
};
const jsonHeaders={...corsHeaders,'Content-Type':'application/json'};

type Caller={user_id:string;data_owner_id:string;role:string;active:boolean;permissions:string[]|null};

function response(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:jsonHeaders});}
function fail(message:string,status=400){return response({error:message},status)}
function getAdminKey(){
  const secretKeys=Deno.env.get('SUPABASE_SECRET_KEYS');
  if(secretKeys){try{const parsed=JSON.parse(secretKeys);if(parsed?.default)return parsed.default as string}catch{/* legacy fallback */}}
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
}
async function authenticate(req:Request,admin:any):Promise<Caller>{
  const token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'').trim();
  if(!token)throw new Error('Sesión no válida.');
  const {data:userData,error:userError}=await admin.auth.getUser(token);
  if(userError||!userData.user)throw new Error('Sesión no válida.');
  const {data:caller,error}=await admin.from('app_users').select('user_id,data_owner_id,role,active,permissions').eq('user_id',userData.user.id).maybeSingle();
  if(error)throw error;
  if(!caller?.active)throw new Error('Tu acceso está desactivado.');
  const permissions=Array.isArray(caller.permissions)?caller.permissions:[];
  if(caller.role!=='admin'&&!permissions.includes('orders'))throw new Error('No tienes permiso para gestionar tarifas de transporte.');
  return caller as Caller;
}

const tariffSchema={
  type:'object',additionalProperties:false,
  required:['carrierCode','carrierName','effectiveFrom','effectiveTo','currencyCode','pricesIncludeVat','fuelSurchargePct','fuelSurchargeIncluded','parserConfidence','parserNotes','services'],
  properties:{
    carrierCode:{type:'string'},carrierName:{type:'string'},
    effectiveFrom:{type:['string','null']},effectiveTo:{type:['string','null']},currencyCode:{type:'string'},
    pricesIncludeVat:{type:'boolean'},fuelSurchargePct:{type:['number','null']},fuelSurchargeIncluded:{type:'boolean'},
    parserConfidence:{type:'number',minimum:0,maximum:1},parserNotes:{type:'array',items:{type:'string'}},
    services:{type:'array',items:{type:'object',additionalProperties:false,required:['serviceName','canonicalServiceKey','externalProvider','externalServiceCode','mappingStatus','bands'],properties:{
      serviceName:{type:'string'},canonicalServiceKey:{type:'string'},externalProvider:{type:'string'},externalServiceCode:{type:'string'},mappingStatus:{type:'string',enum:['suggested','unmapped']},
      bands:{type:'array',items:{type:'object',additionalProperties:false,required:['countryCode','zoneCode','zoneName','minWeightKg','maxWeightKg','basePrice','extraKgPrice','notes'],properties:{
        countryCode:{type:'string'},zoneCode:{type:'string'},zoneName:{type:'string'},minWeightKg:{type:'number'},maxWeightKg:{type:['number','null']},basePrice:{type:['number','null']},extraKgPrice:{type:['number','null']},notes:{type:['string','null']},
      }}},
    }}},
  },
};

function outputText(payload:any){
  if(typeof payload?.output_text==='string'&&payload.output_text.trim())return payload.output_text.trim();
  for(const item of Array.isArray(payload?.output)?payload.output:[]){
    for(const content of Array.isArray(item?.content)?item.content:[]){
      if(content?.type==='output_text'&&typeof content?.text==='string'&&content.text.trim())return content.text.trim();
    }
  }
  return '';
}
function fallbackResponse(fallback:any,reason?:string){
  const proposal={...(fallback&&typeof fallback==='object'?fallback:{})};
  proposal.parserProvider='automatic-rules';proposal.parserModel=null;
  const notes=Array.isArray(proposal.parserNotes)?proposal.parserNotes:[];
  if(reason&&!notes.includes(reason))proposal.parserNotes=[...notes,reason];
  return response({proposal,parserProvider:'automatic-rules',parserModel:null,parserConfidence:Number(proposal.parserConfidence||0)});
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  if(req.method!=='POST')return fail('Método no permitido.',405);
  const url=Deno.env.get('SUPABASE_URL')||'',adminKey=getAdminKey();
  if(!url||!adminKey)return fail('Configuración del backend no disponible.',500);
  const admin=createClient(url,adminKey,{auth:{persistSession:false,autoRefreshToken:false}});
  try{
    await authenticate(req,admin);
    const body=await req.json().catch(()=>({}));
    const text=String(body?.text||'').trim(),fileName=String(body?.fileName||'tarifa'),fallback=body?.fallback||{};
    if(!text)return fail('El documento no contiene texto para analizar.');
    const apiKey=Deno.env.get('OPENAI_API_KEY')||'';
    if(!apiKey)return fallbackResponse(fallback,'IA no configurada: se ha usado la lectura automática y debes revisar todos los datos.');

    const model=Deno.env.get('TRANSPORT_TARIFF_AI_MODEL')||'gpt-5';
    const instructions=`Eres un motor experto en lectura de TARIFAS LOGÍSTICAS y debes trabajar de forma genérica, sin depender de una plantilla, transportista o proveedor concreto.

OBJETIVO
Transforma cualquier propuesta o tarifa de transporte en servicios y tramos estructurados. El documento puede ser PDF, Excel convertido a texto, varias páginas u hojas, tablas transpuestas, matrices por peso, matrices por zona, varios transportistas en el mismo archivo o una tarifa de un único carrier.

REGLAS DE INTERPRETACIÓN
- Reconstruye la semántica de las tablas aunque los encabezados estén en una página o fila anterior. Los marcadores [[PAGE n]] y [[SHEET ...]] indican estructura, no contenido comercial.
- Detecta si las columnas representan pesos, zonas, destinos, servicios, transportistas o precios. Detecta también el caso inverso: pesos en filas y zonas o servicios en columnas.
- Separa cada combinación real de servicio y zona en bandas de peso coherentes. "Hasta X kg" crea un límite máximo; "de X a Y kg" conserva ambos límites; "kg adicional", "exceso", "por kg" o equivalentes deben ir en extraKgPrice cuando corresponda.
- Diferencia precio base, suplemento, mínimo, recargo, combustible, IVA o impuestos, seguro, reembolso, isla o remoto y otros conceptos. No conviertas un porcentaje o suplemento en precio base.
- Si el documento contiene varios carriers, crea servicios separados y usa externalProvider como sugerencia del carrier real. No uses envia o sendcloud como carrier salvo que el documento realmente esté tarifando esa plataforma como tal.
- Si solo existe un carrier, carrierCode y carrierName deben representar ese carrier, no el nombre del cliente destinatario de la propuesta.
- Normaliza países a ISO-2 cuando estén explícitos o sean inequívocos. Para España Peninsular usa ES/peninsular; Portugal Peninsular PT/peninsular. Baleares, Canarias, Ceuta y Melilla son zonas distintas cuando el documento las distingue.
- Moneda: respeta la indicada por el documento. No asumas EUR si aparece otra divisa.
- Fechas: solo extrae vigencia si está expresamente indicada.
- pricesIncludeVat=true únicamente si el documento afirma que IVA o impuestos están incluidos. fuelSurchargeIncluded=true únicamente si el combustible está incluido expresamente.
- fuelSurchargePct solo puede contener el porcentaje de combustible, nunca IVA u otro porcentaje.
- externalServiceCode debe usar un código explícito del documento cuando exista; si no existe puede ser un slug descriptivo como sugerencia. mappingStatus siempre suggested o unmapped, nunca confirmed.
- No inventes datos. Si una asociación entre encabezado, precio, peso o zona es ambigua, no la fuerces: omítela y explícalo en parserNotes.
- No actives ni confirmes nada; la salida siempre queda pendiente de revisión humana.

CONTROL DE CALIDAD
- Cada banda debe tener minWeightKg >= 0, maxWeightKg nulo o mayor que minWeightKg, y al menos basePrice o extraKgPrice.
- No generes bandas solapadas para el mismo servicio, país y zona salvo que el documento distinga otra condición explícita.
- No uses importes de totales, IVA, descuentos, depósitos o ejemplos como tarifas de envío.
- parserConfidence debe reflejar la calidad real de la lectura: bájala ante tablas rotas, OCR pobre, encabezados ambiguos o asociaciones inciertas.
- parserNotes debe explicar ambigüedades, supuestos evitados y campos que requieren revisión.

Devuelve únicamente información respaldada por el documento y ajustada al esquema solicitado.`;
    const ai=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({
      model,instructions,input:`Archivo: ${fileName}\nTipo MIME: ${String(body?.mimeType||'desconocido')}\n\nDocumento estructurado extraído:\n${text.slice(0,120000)}`,
      text:{format:{type:'json_schema',name:'transport_tariff',strict:true,schema:tariffSchema}},
    })});
    if(!ai.ok){const detail=(await ai.text()).slice(0,600);console.error('OpenAI tariff parse failed',ai.status,detail);return fallbackResponse(fallback,'La IA no pudo completar la lectura: se mantiene la extracción automática para revisión.');}
    const payload=await ai.json(),raw=outputText(payload);
    if(!raw)return fallbackResponse(fallback,'La IA no devolvió datos estructurados: se mantiene la extracción automática para revisión.');
    let proposal:any;try{proposal=JSON.parse(raw)}catch{return fallbackResponse(fallback,'La respuesta de IA no se pudo interpretar: se mantiene la extracción automática para revisión.');}
    proposal={...proposal,parserProvider:'openai',parserModel:model};
    return response({proposal,parserProvider:'openai',parserModel:model,parserConfidence:Number(proposal.parserConfidence||0)});
  }catch(error){
    const message=error instanceof Error?error.message:String(error||'Error interno.');
    const status=/Sesión no válida/.test(message)?401:/permiso|desactivado/.test(message)?403:500;
    return fail(message,status);
  }
});
