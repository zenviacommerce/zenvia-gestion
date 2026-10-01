import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
};
const headers={...corsHeaders,'Content-Type':'application/json'};
const response=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
const clean=(value:unknown,max=10000)=>typeof value==='string'?value.trim().slice(0,max):'';
function getAdminKey(){
  const raw=Deno.env.get('SUPABASE_SECRET_KEYS');
  if(raw){try{const parsed=JSON.parse(raw);if(typeof parsed?.default==='string'&&parsed.default.trim())return parsed.default.trim()}catch{}}
  return clean(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),5000);
}
function norm(value:unknown){
  return clean(value,200000).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
}
function extractOutputText(payload:any){
  if(typeof payload?.output_text==='string')return payload.output_text;
  for(const item of payload?.output||[])for(const content of item?.content||[])if(typeof content?.text==='string')return content.text;
  return '';
}
function evidenceMap(evidence:any[]){
  const result=new Map<string,string[]>();
  for(const item of Array.isArray(evidence)?evidence:[]){
    const field=clean(item?.field,120),quote=clean(item?.quote,1200);
    if(!field||!quote)continue;
    result.set(field,[...(result.get(field)||[]),quote]);
  }
  return result;
}
function evidenceSupported(map:Map<string,string[]>,field:string,text:string){
  const haystack=norm(text);
  return (map.get(field)||[]).some(quote=>{
    const needle=norm(quote);
    return needle.length>=3&&haystack.includes(needle);
  });
}
function fiscalConsistent(amounts:any){
  const subtotal=Number(amounts?.subtotal||0),vat=Number(amounts?.vat||0),surcharge=Number(amounts?.equivalenceSurcharge||0),withholding=Number(amounts?.withholding||0),total=Number(amounts?.total||0);
  if(!(subtotal>=0&&vat>=0&&surcharge>=0&&withholding>=0&&total>0))return false;
  const expected=subtotal+vat+surcharge-withholding;
  return Math.abs(expected-total)<=Math.max(.05,total*.005);
}
function parseDataUrlSize(value:string){
  const payload=value.split(',')[1]||'';
  return Math.floor(payload.length*3/4);
}
const nullableString={anyOf:[{type:'string'},{type:'null'}]};
const nullableNumber={anyOf:[{type:'number'},{type:'null'}]};
const schema={
  type:'object',additionalProperties:false,
  properties:{
    documentKind:{type:'string',enum:['invoice','credit_note','not_invoice','unknown']},
    issuer:{type:'object',additionalProperties:false,properties:{
      name:nullableString,taxId:nullableString,email:nullableString,phone:nullableString,address:nullableString,countryCode:nullableString,
    },required:['name','taxId','email','phone','address','countryCode']},
    recipient:{type:'object',additionalProperties:false,properties:{
      name:nullableString,taxId:nullableString,email:nullableString,phone:nullableString,address:nullableString,countryCode:nullableString,
    },required:['name','taxId','email','phone','address','countryCode']},
    invoiceNumber:nullableString,issueDate:nullableString,dueDate:nullableString,currency:nullableString,
    amounts:{type:'object',additionalProperties:false,properties:{
      subtotal:nullableNumber,vat:nullableNumber,equivalenceSurcharge:nullableNumber,withholding:nullableNumber,total:nullableNumber,
    },required:['subtotal','vat','equivalenceSurcharge','withholding','total']},
    lines:{type:'array',items:{type:'object',additionalProperties:false,properties:{
      description:{type:'string'},quantity:nullableNumber,unit:nullableString,unitPrice:nullableNumber,discountPercent:nullableNumber,
      taxRate:nullableNumber,lineNet:nullableNumber,lineTotal:nullableNumber,evidenceQuote:{type:'string'},
    },required:['description','quantity','unit','unitPrice','discountPercent','taxRate','lineNet','lineTotal','evidenceQuote']}},
    evidence:{type:'array',items:{type:'object',additionalProperties:false,properties:{field:{type:'string'},quote:{type:'string'}},required:['field','quote']}},
    confidence:{type:'number'},warnings:{type:'array',items:{type:'string'}},
  },
  required:['documentKind','issuer','recipient','invoiceNumber','issueDate','dueDate','currency','amounts','lines','evidence','confidence','warnings'],
};

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  if(req.method!=='POST')return response({error:'Método no permitido.'},405);
  try{
    const supabaseUrl=clean(Deno.env.get('SUPABASE_URL'),500),adminKey=getAdminKey();
    if(!supabaseUrl||!adminKey)return response({error:'Configuración interna no disponible.'},503);
    const admin=createClient(supabaseUrl,adminKey,{auth:{persistSession:false,autoRefreshToken:false}});
    const token=clean(req.headers.get('Authorization'),5000).replace(/^Bearer\s+/i,'');
    if(!token)return response({error:'Sesión no válida.'},401);
    const {data:userData,error:userError}=await admin.auth.getUser(token);
    if(userError||!userData?.user)return response({error:'Sesión no válida.'},401);
    const {data:profile,error:profileError}=await admin.from('app_users').select('data_owner_id,active,permissions,role').eq('user_id',userData.user.id).maybeSingle();
    if(profileError)throw profileError;
    if(!profile?.active)return response({error:'Tu acceso está desactivado.'},403);

    const body=await req.json().catch(()=>({}));
    const mode=body?.mode==='sales'?'sales':'expense';
    const text=clean(body?.text,160000);
    const fileName=clean(body?.fileName,240)||'documento';
    const mimeType=clean(body?.mimeType,120);
    const fileData=clean(body?.fileData,16_000_000);
    if(!text&&!fileData)return response({error:'Falta el contenido del documento.'},400);
    if(fileData&&parseDataUrlSize(fileData)>10*1024*1024)return response({error:'El documento supera 10 MB para análisis inteligente.'},413);

    const apiKey=clean(Deno.env.get('OPENAI_API_KEY'),5000);
    if(!apiKey)return response({error:'OPENAI_API_KEY no está configurada para el motor documental.',code:'ai_not_configured'},503);
    const model=clean(Deno.env.get('OPENAI_INVOICE_MODEL'),100)||'gpt-5.6-luna';

    const {data:business}=await admin.from('business_settings').select('legal_name,trade_name,tax_id,country_code').eq('owner_id',profile.data_owner_id).maybeSingle();
    const ownName=clean(business?.legal_name||business?.trade_name,200),ownTaxId=clean(business?.tax_id,80);
    const roleRule=mode==='expense'
      ?'Es una factura RECIBIDA: issuer/emisor es el proveedor y recipient/destinatario debe ser nuestra empresa.'
      :'Es una factura EMITIDA: issuer/emisor debe ser nuestra empresa y recipient/destinatario es el cliente.';

    const instructions=`Eres un motor de extracción documental contable extremadamente conservador.
Tu trabajo NO es completar huecos ni adivinar. Extrae solo datos que estén realmente visibles o textualmente respaldados por el documento.
${roleRule}
Nuestra empresa conocida es "${ownName||'ZENVIA'}" con NIF/VAT "${ownTaxId||'desconocido'}"; úsala solo para distinguir emisor de destinatario, nunca para inventar campos.
REGLAS:
- Si un dato no aparece con evidencia suficiente, devuelve null.
- No uses el nombre del archivo como evidencia salvo que el mismo dato también aparezca en el documento.
- invoiceNumber debe ser el identificador fiscal real, no pedido, albarán, fecha, cliente ni referencia de pago.
- issueDate es fecha de emisión/factura; nunca vencimiento, entrega, estancia o pago.
- Separa base imponible, IVA/VAT, recargo de equivalencia, retención y total. Nunca metas un porcentaje como importe.
- Las líneas solo se extraen cuando puede reconstruirse concepto y valores de la misma línea/tabla. evidenceQuote debe contener texto visible de esa línea.
- Devuelve una evidencia literal corta para cada campo crítico encontrado usando field paths como issuer.name, issuer.taxId, recipient.name, recipient.taxId, invoiceNumber, issueDate, currency, amounts.subtotal, amounts.vat, amounts.equivalenceSurcharge, amounts.withholding, amounts.total.
- Si hay varias facturas completas en el mismo documento, añade una advertencia y baja confidence; no mezcles sus importes.
- confidence representa confianza documental, no deseo de completar el esquema.
- Produce JSON estrictamente según el esquema.`;

    const content:any[]=[{type:'input_text',text:`Archivo: ${fileName}\nMIME: ${mimeType||'desconocido'}\nTexto extraído por el lector local:\n${text||'(sin texto local fiable)'}`}];
    if(fileData){
      if(/^image\//i.test(mimeType))content.push({type:'input_image',image_url:fileData,detail:'high'});
      else content.push({type:'input_file',filename:fileName,file_data:fileData});
    }
    const ai=await fetch('https://api.openai.com/v1/responses',{
      method:'POST',
      headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},
      body:JSON.stringify({
        model,instructions,input:[{role:'user',content}],max_output_tokens:5000,
        text:{format:{type:'json_schema',name:'invoice_document_extraction',strict:true,schema}},
      }),
    });
    const payload=await ai.json().catch(()=>({}));
    if(!ai.ok)return response({error:`OpenAI (${ai.status}): ${clean(payload?.error?.message||payload?.error||'Error del proveedor IA.',900)}`,code:'ai_error'},502);
    const raw=extractOutputText(payload);
    let parsed:any;try{parsed=JSON.parse(raw)}catch{return response({error:'La respuesta IA no es JSON válido.',code:'ai_invalid_output'},502)}

    const evidence=evidenceMap(parsed?.evidence||[]);
    const support:Record<string,boolean>={};
    for(const field of ['issuer.name','issuer.taxId','recipient.name','recipient.taxId','invoiceNumber','issueDate','currency','amounts.subtotal','amounts.vat','amounts.equivalenceSurcharge','amounts.withholding','amounts.total']){
      support[field]=evidenceSupported(evidence,field,text);
    }
    const verifiedLines=(Array.isArray(parsed?.lines)?parsed.lines:[]).map((line:any)=>({
      ...line,verified:Boolean(norm(line?.evidenceQuote).length>=3&&norm(text).includes(norm(line?.evidenceQuote))),
    }));
    const fiscalOk=fiscalConsistent(parsed?.amounts);
    const warnings=[...(Array.isArray(parsed?.warnings)?parsed.warnings.map((x:any)=>clean(x,400)).filter(Boolean):[])];
    if(!fiscalOk)warnings.push('Los importes extraídos por IA no superan la validación fiscal matemática.');
    const critical=['invoiceNumber','issueDate','amounts.total'];
    if(critical.some(field=>parsed?.[field.split('.')[0]]!=null&&!support[field]))warnings.push('Hay campos críticos sin evidencia textual verificable; no se aplicarán automáticamente.');

    return response({
      ok:true,model,extraction:parsed,
      verification:{support,fiscalConsistent:fiscalOk,verifiedLines,warnings},
    });
  }catch(error){
    console.error(error);
    return response({error:error instanceof Error?error.message:'Error interno del analizador documental.'},500);
  }
});