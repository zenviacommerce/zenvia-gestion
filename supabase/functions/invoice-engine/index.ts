import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
};
const headers={...corsHeaders,'Content-Type':'application/json'};
const clean=(v:unknown,max=200000)=>typeof v==='string'?v.trim().slice(0,max):'';
const response=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});

function getAdminKey(){
  const raw=Deno.env.get('SUPABASE_SECRET_KEYS');
  if(raw){try{const parsed=JSON.parse(raw);if(typeof parsed?.default==='string'&&parsed.default.trim())return parsed.default.trim()}catch{}}
  return clean(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),5000);
}
function dataUrlBase64(value:string){return value.includes(',')?value.slice(value.indexOf(',')+1):value;}
function normalizeTaxId(value:unknown){return clean(value,80).toUpperCase().replace(/[^A-Z0-9]/g,'');}

const fieldConfidenceSchema={
  type:'object',additionalProperties:{type:'number',minimum:0,maximum:1},
};
const nullableString={anyOf:[{type:'string'},{type:'null'}]};
const nullableNumber={anyOf:[{type:'number'},{type:'null'}]};

const invoiceSchema={
  type:'object',additionalProperties:false,
  properties:{
    pageNumbers:{type:'array',items:{type:'integer',minimum:1}},
    documentType:{type:'string',enum:['full','simplified','credit_note','receipt','unknown']},
    supplier:{type:'object',additionalProperties:false,properties:{
      name:nullableString,taxId:nullableString,address:nullableString,email:nullableString,phone:nullableString,iban:nullableString,
    },required:['name','taxId','address','email','phone','iban']},
    series:nullableString,number:nullableString,issueDate:nullableString,dueDate:nullableString,paymentMethod:nullableString,currency:nullableString,
    orderReference:nullableString,deliveryNoteReference:nullableString,qrPayload:nullableString,
    intracommunity:{type:'boolean'},reverseCharge:{type:'boolean'},
    categoryHint:nullableString,hasProducts:{type:'boolean'},
    lines:{type:'array',items:{type:'object',additionalProperties:false,properties:{
      supplierSku:nullableString,description:{type:'string'},quantity:nullableNumber,unit:nullableString,unitPrice:nullableNumber,
      discountPercent:nullableNumber,taxRate:nullableNumber,lineNet:nullableNumber,taxAmount:nullableNumber,lineTotal:nullableNumber,
    },required:['supplierSku','description','quantity','unit','unitPrice','discountPercent','taxRate','lineNet','taxAmount','lineTotal']}},
    vatBreakdown:{type:'array',items:{type:'object',additionalProperties:false,properties:{
      rate:nullableNumber,base:nullableNumber,tax:nullableNumber,exemptReason:nullableString,
    },required:['rate','base','tax','exemptReason']}},
    subtotal:nullableNumber,vat:nullableNumber,equivalenceSurcharge:nullableNumber,withholding:nullableNumber,total:nullableNumber,
    fieldConfidence:fieldConfidenceSchema,
    warnings:{type:'array',items:{type:'string'}},
  },
  required:['pageNumbers','documentType','supplier','series','number','issueDate','dueDate','paymentMethod','currency','orderReference','deliveryNoteReference','qrPayload','intracommunity','reverseCharge','categoryHint','hasProducts','lines','vatBreakdown','subtotal','vat','equivalenceSurcharge','withholding','total','fieldConfidence','warnings'],
};
const outputSchema={
  type:'object',additionalProperties:false,
  properties:{
    invoices:{type:'array',items:invoiceSchema},
    warnings:{type:'array',items:{type:'string'}},
  },
  required:['invoices','warnings'],
};

function modelPrompt(input:any,examples:any[]){
  const categories=(Array.isArray(input?.categories)?input.categories:[]).map((x:any)=>clean(x?.name,120)).filter(Boolean);
  const pages=(Array.isArray(input?.pages)?input.pages:[]).map((p:any)=>`PÁGINA ${Number(p.pageNumber)||1}\n${clean(p.text,25000)||'(sin texto fiable)'}`).join('\n\n');
  const learned=examples.slice(0,10).map((e:any)=>`${clean(e.field_name,80)}: ${JSON.stringify(e.extracted_value)} -> ${JSON.stringify(e.corrected_value)}`).join('\n');
  return `Eres InvoiceEngine, un extractor contable para España/UE. Analiza exclusivamente el documento aportado.
OBJETIVO: detectar una o varias facturas/gastos independientes y devolver TODOS los campos del esquema.
REGLAS:
- Si un PDF contiene varias facturas, sepáralas en objetos distintos y asigna pageNumbers.
- Une páginas consecutivas de una misma factura.
- No inventes. Usa null y baja fieldConfidence si no hay evidencia.
- supplier es siempre el emisor/proveedor del gasto, no el cliente.
- Extrae tipo: full, simplified/ticket, credit_note/abono, receipt.
- Extrae serie y número por separado cuando se pueda.
- IVA: devuelve el desglose por tipos (21,10,4,0/exento u otros visibles); no confundas porcentajes con importes.
- reverseCharge/intracommunity solo true con evidencia explícita.
- Verifica subtotal + VAT + recargo - retención ~= total.
- Líneas: referencia proveedor, descripción, cantidad, precio unitario, descuento, IVA e importes.
- hasProducts=true solo si hay bienes/artículos inventariables; para luz, combustible, software, alquiler, comisiones, transporte o servicios puros suele ser false.
- categoryHint debe ser una categoría existente si encaja. Categorías: ${categories.join(', ')||'sin catálogo'}.
- QR: devuelve el contenido textual si puede leerse; no inventes un QR.
- fieldConfidence usa claves como supplier.name, supplier.taxId, number, issueDate, subtotal, vat, total, lines.
- Fechas en YYYY-MM-DD. Moneda ISO 4217.
${learned?`CORRECCIONES PREVIAS DEL MISMO PROVEEDOR (úsalas solo como patrón, nunca como dato):\n${learned}\n`:''}
TEXTO POR PÁGINA:
${pages}`;
}

async function callOllama(baseUrl:string,model:string,apiKey:string,prompt:string,pages:any[]){
  const images=pages.map((p:any)=>clean(p.imageDataUrl,8_000_000)).filter(Boolean).map(dataUrlBase64);
  const res=await fetch(baseUrl.replace(/\/$/,'')+'/api/chat',{
    method:'POST',
    headers:{'Content-Type':'application/json',...(apiKey?{Authorization:`Bearer ${apiKey}`}:{})},
    body:JSON.stringify({
      model,stream:false,format:outputSchema,
      options:{temperature:0},
      messages:[{role:'user',content:prompt,images}],
    }),
  });
  const payload=await res.json().catch(()=>({}));
  if(!res.ok)throw new Error(`Modelo local (${res.status}): ${clean(payload?.error||payload?.message||'error',900)}`);
  const raw=clean(payload?.message?.content,200000);
  if(!raw)throw new Error('El modelo local no devolvió contenido.');
  return JSON.parse(raw);
}

async function callOpenAICompatible(baseUrl:string,model:string,apiKey:string,prompt:string,pages:any[]){
  const content:any[]=[{type:'text',text:prompt}];
  for(const page of pages){
    const image=clean(page?.imageDataUrl,8_000_000);
    if(image)content.push({type:'image_url',image_url:{url:image}});
  }
  const res=await fetch(baseUrl.replace(/\/$/,'')+'/v1/chat/completions',{
    method:'POST',
    headers:{'Content-Type':'application/json',...(apiKey?{Authorization:`Bearer ${apiKey}`}:{})},
    body:JSON.stringify({
      model,temperature:0,
      messages:[{role:'user',content}],
      response_format:{type:'json_schema',json_schema:{name:'invoice_engine',strict:true,schema:outputSchema}},
    }),
  });
  const payload=await res.json().catch(()=>({}));
  if(!res.ok)throw new Error(`Servidor IA (${res.status}): ${clean(payload?.error?.message||payload?.error||'error',900)}`);
  const raw=clean(payload?.choices?.[0]?.message?.content,200000);
  if(!raw)throw new Error('El servidor IA no devolvió contenido.');
  return JSON.parse(raw);
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  if(req.method!=='POST')return response({error:'Método no permitido.'},405);
  try{
    const url=Deno.env.get('SUPABASE_URL')||'',adminKey=getAdminKey();
    if(!url||!adminKey)return response({error:'Configuración interna no disponible.'},503);
    const admin=createClient(url,adminKey,{auth:{persistSession:false,autoRefreshToken:false}});
    const token=clean(req.headers.get('Authorization'),5000).replace(/^Bearer\s+/i,'');
    if(!token)return response({error:'Sesión no válida.'},401);
    const {data:userData,error:userError}=await admin.auth.getUser(token);
    if(userError||!userData?.user)return response({error:'Sesión no válida.'},401);
    const {data:profile,error:profileError}=await admin.from('app_users').select('data_owner_id,active,permissions,role').eq('user_id',userData.user.id).maybeSingle();
    if(profileError)throw profileError;
    if(!profile?.active)return response({error:'Tu acceso está desactivado.'},403);
    const permissions=Array.isArray(profile.permissions)?profile.permissions.map(String):[];
    if(profile.role!=='admin'&&!permissions.includes('invoices')&&!permissions.includes('gmail'))return response({error:'No tienes permiso para importar gastos.'},403);

    const body=await req.json().catch(()=>({}));
    const pages=Array.isArray(body?.pages)?body.pages.slice(0,30):[];
    if(!pages.length)return response({error:'No hay páginas para analizar.'},400);
    const totalBytes=pages.reduce((sum:number,p:any)=>sum+clean(p?.imageDataUrl,8_000_000).length+clean(p?.text,25000).length,0);
    if(totalBytes>24_000_000)return response({error:'El documento es demasiado grande para una sola ejecución. Divide el archivo o reduce la resolución.'},413);

    const provider=clean(Deno.env.get('INVOICE_AI_PROVIDER'),50)||'ollama';
    const baseUrl=clean(Deno.env.get('INVOICE_AI_BASE_URL'),1000);
    const model=clean(Deno.env.get('INVOICE_AI_MODEL'),120)||'qwen2.5vl:7b';
    const apiKey=clean(Deno.env.get('INVOICE_AI_API_KEY'),5000);
    if(!baseUrl)return response({error:'InvoiceEngine está instalado pero falta INVOICE_AI_BASE_URL.',code:'invoice_ai_not_configured'},503);

    const supplierTaxId=normalizeTaxId(body?.supplierTaxIdHint);
    const supplierNameKey=clean(body?.supplierNameHint,180).toLowerCase();
    let examples:any[]=[];
    try{
      let query=admin.from('invoice_engine_examples').select('field_name,extracted_value,corrected_value,context').eq('owner_id',profile.data_owner_id).order('created_at',{ascending:false}).limit(20);
      if(supplierTaxId)query=query.eq('supplier_tax_id',supplierTaxId);
      else if(supplierNameKey)query=query.eq('supplier_name_key',supplierNameKey);
      else query=query.limit(0);
      const result=await query;
      if(!result.error)examples=result.data||[];
    }catch{}

    const prompt=modelPrompt(body,examples);
    const extraction=provider==='openai-compatible'
      ?await callOpenAICompatible(baseUrl,model,apiKey,prompt,pages)
      :await callOllama(baseUrl,model,apiKey,prompt,pages);

    if(!Array.isArray(extraction?.invoices)||!extraction.invoices.length)return response({error:'InvoiceEngine no detectó ninguna factura o gasto.',code:'no_invoice_detected'},422);

    let runId:string|null=null;
    try{
      const {data:run,error:runError}=await admin.from('invoice_engine_runs').insert({
        owner_id:profile.data_owner_id,
        source_document_id:body?.sourceDocumentId||null,
        source_channel:clean(body?.sourceChannel,40)||'manual',
        source_name:clean(body?.sourceName,240)||null,
        source_mime_type:clean(body?.sourceMimeType,120)||null,
        page_count:pages.length,
        model_provider:provider,
        model_name:model,
        status:'completed',
        extraction,
        warnings:extraction.warnings||[],
        created_by:userData.user.id,
      }).select('id').single();
      if(!runError)runId=run?.id||null;
    }catch{}

    return response({ok:true,engine:'invoice-engine-v1',provider,model,runId,...extraction});
  }catch(error){
    console.error(error);
    return response({error:error instanceof Error?error.message:'Error interno de InvoiceEngine.'},500);
  }
});