// @vitest-environment node
/**
 * Prueba de integración del flujo completo de facturas de gasto:
 *   lector (simulado) → invoiceImportPipeline → createInvoice / Gmail → supabase-js → PostgREST → Postgres
 * contra una copia local del ESQUEMA REAL de producción (tablas, restricciones, tipos numeric y triggers).
 *
 * Se ejecuta solo si hay una base de pruebas disponible:
 *   ZG_IT_PGRST=http://127.0.0.1:3000  ZG_IT_JWT_SECRET=...  ZG_IT_PSQL="sudo -u postgres psql -d zvreal"
 * Sin esas variables (CI normal) la suite se omite.
 */
import {afterAll,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {createServer,request as httpRequest,type Server} from 'node:http';
import {createHmac} from 'node:crypto';
import {execSync} from 'node:child_process';

const PGRST=process.env.ZG_IT_PGRST||'';
const SECRET=process.env.ZG_IT_JWT_SECRET||'';
const PSQL=process.env.ZG_IT_PSQL||'';
const ENABLED=Boolean(PGRST&&SECRET&&PSQL);
const GATEWAY_PORT=54329;
const USER_ID='22222222-2222-4222-8222-222222222222';
const OWNER_ID='11111111-1111-4111-8111-111111111111';
const SYNTHETIC_DATE='2022-02-03';

const reads:any[]=[];
vi.mock('../src/services/invoiceReaderEnhanced',()=>({
  readInvoiceDocumentEnhanced:vi.fn(async()=>{const next=reads.shift();if(!next)throw new Error('lector sin respuesta preparada');return next;}),
  readInvoiceDocumentsEnhanced:vi.fn(async()=>{const next=reads.shift();if(!next)throw new Error('lector sin respuesta preparada');return [next];}),
  isMultiInvoiceDocumentError:()=>false,
  MultiInvoiceDocumentError:class extends Error{},
}));
vi.mock('../src/services/invoiceCandidateClassifier',()=>({classifyInvoiceFile:vi.fn(async()=>({isInvoice:true,score:1,signals:[],negativeSignals:[]}))}));
vi.mock('../src/services/gmail',async(importOriginal)=>{
  const actual=await importOriginal<typeof import('../src/services/gmail')>();
  return {...actual,downloadGmailAttachment:vi.fn(async(_token:string,candidate:any)=>new File([`gmail:${candidate.messageId}`],candidate.attachmentName,{type:'application/pdf'}))};
});
vi.mock('../src/services/supabase',async()=>{
  const {createClient}=await import('@supabase/supabase-js');
  return {
    INVOICE_BUCKET:'invoices',
    supabase:createClient(`http://127.0.0.1:${GATEWAY_PORT}`,'local-anon-key',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}}),
  };
});

function b64url(value:string|Buffer){return Buffer.from(value).toString('base64').replace(/=+$/,'').replace(/\+/g,'-').replace(/\//g,'_');}
function jwt(){
  const head=b64url(JSON.stringify({alg:'HS256',typ:'JWT'}));
  const body=b64url(JSON.stringify({sub:USER_ID,role:'authenticated',aud:'authenticated',exp:Math.floor(Date.now()/1000)+3600}));
  return `${head}.${body}.${b64url(createHmac('sha256',SECRET).update(`${head}.${body}`).digest())}`;
}
const sql=(query:string)=>execSync(`${PSQL} -AtX -v ON_ERROR_STOP=1`,{input:query,encoding:'utf8'}).trim();
const json=(query:string)=>JSON.parse(sql(`select coalesce(json_agg(t),'[]') from (${query}) t`));

let gateway:Server;
beforeAll(async()=>{
  if(!ENABLED)return;
  const token=jwt();
  const target=new URL(PGRST);
  gateway=createServer((req,res)=>{
    const url=req.url||'/';
    if(url.startsWith('/auth/v1/user')){
      res.writeHead(200,{'content-type':'application/json'});
      res.end(JSON.stringify({id:USER_ID,aud:'authenticated',role:'authenticated',email:'invoice@example.test',app_metadata:{},user_metadata:{},created_at:new Date().toISOString()}));
      return;
    }
    if(url.startsWith('/storage/v1/')){
      req.resume();
      res.writeHead(200,{'content-type':'application/json'});
      res.end(JSON.stringify({Key:url.split('/object/')[1]||'ok',Id:'local'}));
      return;
    }
    if(!url.startsWith('/rest/v1/')){res.writeHead(404);res.end();return;}
    const headers={...req.headers,host:target.host,authorization:`Bearer ${token}`};
    delete (headers as any).apikey;
    const upstream=httpRequest({hostname:target.hostname,port:target.port,path:url.slice('/rest/v1'.length),method:req.method,headers},upstreamRes=>{
      res.writeHead(upstreamRes.statusCode||502,upstreamRes.headers);
      upstreamRes.pipe(res);
    });
    upstream.on('error',error=>{res.writeHead(502);res.end(String(error));});
    req.pipe(upstream);
  });
  await new Promise<void>(resolve=>gateway.listen(GATEWAY_PORT,'127.0.0.1',resolve));
  const {supabase}=await import('../src/services/supabase');
  const {error}=await supabase.auth.setSession({access_token:token,refresh_token:'local-refresh'});
  if(error)throw error;
});
afterAll(async()=>{if(gateway)await new Promise(resolve=>gateway.close(resolve));});

function cleanDatabase(){
  sql(`truncate public.gmail_imports, public.product_price_history, public.invoice_lines, public.supplier_products, public.invoices, public.source_documents, public.products, public.suppliers, public.app_settings, public.audit_logs restart identity cascade;
       delete from public.expense_categories;
       insert into public.expense_categories(owner_id,name,sort_order) values ('${OWNER_ID}','Mercancía',10),('${OWNER_ID}','Transporte y logística',20);`);
}
const categories=()=>json(`select id,name from public.expense_categories order by sort_order`) as Array<{id:string;name:string}>;
const merchandiseId=()=>categories().find(category=>category.name==='Mercancía')!.id;
let fileCounter=0;
const pdf=(name:string)=>new File([`%PDF-1.4 ${name} ${++fileCounter} ${Math.random()}`],`${name}.pdf`,{type:'application/pdf'});
const line=(description:string,quantity:number,unitPrice:number,extra:Record<string,unknown>={})=>({description,quantity,unit:'ud',unitPrice,lineNet:Math.round(quantity*unitPrice*100)/100,taxRate:21,verified:true,...extra});
function readResult(overrides:Record<string,unknown>){
  return {
    supplierName:'Synthetic Supplier Integration',invoiceNumber:'IT-1',invoiceDate:SYNTHETIC_DATE,categoryId:merchandiseId(),
    subtotal:0,vat:0,withholding:0,total:0,currency:'EUR',lines:[],text:'',confidence:0.95,usedOcr:false,
    analysisEngine:'hybrid-ai-verified',aiIssuer:{name:'Synthetic Supplier Integration',taxId:'SYNTH-TAX-INTEGRATION',email:null,phone:null,address:null,countryCode:'ES'},
    aiRecipient:{name:'Synthetic Recipient',taxId:null,email:null,phone:null,address:null,countryCode:'ES'},
    ...overrides,
  };
}
async function importManual(read:Record<string,unknown>,name:string){
  const {prepareInvoiceCandidate,invoiceCandidateToInput}=await import('../src/services/invoiceImportPipeline');
  const {createInvoice}=await import('../src/services/repository');
  reads.push(read);
  const candidate=await prepareInvoiceCandidate(pdf(name),categories() as any);
  const id=await createInvoice({...invoiceCandidateToInput(candidate,'manual'),categoryId:merchandiseId()});
  return {candidate,id};
}
const invoiceRow=(id:string)=>json(`select status, net_amount::float, tax_amount::float, total_amount::float, extraction->'integrityCheck'->>'status' as integrity, extraction->>'integrityRequestedStatus' as requested from public.invoices where id='${id}'`)[0];
const lineRows=(id:string)=>json(`select description, quantity::float, unit_price::float, line_net::float, price_update_status, normalized_unit_price::float from public.invoice_lines where invoice_id='${id}' order by created_at, line_net`);
const historyCount=(id:string)=>Number(sql(`select count(*) from public.product_price_history where invoice_id='${id}'`));

it('synthetic fixture date passes the real candidate safety gate before testing persistence',async()=>{
  const {validateInvoiceCandidateIntegrity}=await import('../src/services/invoiceImportPipeline');
  expect(validateInvoiceCandidateIntegrity({supplierName:'Synthetic Supplier Safety',invoiceNumber:'SYNTHETIC-SAFETY-01',invoiceDate:SYNTHETIC_DATE,subtotal:137,vat:28.77,equivalenceSurcharge:0,withholding:0,total:165.77})).toMatchObject({safe:true,reasons:[]});
});

describe.skipIf(!ENABLED)('Importación de facturas contra el esquema real (PostgREST + Postgres)',()=>{
  beforeEach(()=>{cleanDatabase();reads.length=0;});

  it('factura correcta: se guardan todas las líneas, cuadra y alimenta costes', async()=>{
    sql(`insert into public.app_settings(owner_id,schema_version,config) values ('${OWNER_ID}',1,'{"expenses":{"initialStatus":"reviewed"}}')`);
    const lines=[line('Synthetic item alpha',1300,0.017),line('Synthetic item beta',17,4.31),line('Synthetic item gamma',23,6.47)];
    const {id}=await importManual(readResult({invoiceNumber:'IT-OK',subtotal:244.18,vat:51.28,total:295.46,lines}),'ok');
    expect(invoiceRow(id)).toMatchObject({status:'reviewed',net_amount:244.18,integrity:'ready'});
    expect(lineRows(id)).toHaveLength(3);
    expect(historyCount(id)).toBe(3);
  });

  it('líneas repetidas legítimas: se conservan las dos', async()=>{
    const lines=[line('Synthetic item repeated',100,0.5),line('Synthetic item repeated',100,0.5),line('Synthetic item separate',50,0.2)];
    const {id}=await importManual(readResult({invoiceNumber:'IT-REP',subtotal:110,vat:23.1,total:133.1,lines}),'rep');
    expect(lineRows(id).filter((row:any)=>row.description==='Synthetic item repeated')).toHaveLength(2);
    expect(invoiceRow(id).integrity).toBe('ready');
  });

  it('Sintético multifuente (14 líneas, 7 duplicadas): no se pierde nada, queda pendiente y no toca costes', async()=>{
    sql(`insert into public.app_settings(owner_id,schema_version,config) values ('${OWNER_ID}',1,'{"expenses":{"initialStatus":"accounted"}}')`);
    const base=[line('Synthetic item alpha',11,3),line('Synthetic item beta',13,5),line('Synthetic item gamma',17,7),line('Synthetic item delta',19,11),line('Synthetic item epsilon',29,17),line('Synthetic item zeta',31,19),line('Synthetic item eta',37,23)];
    const {id,candidate}=await importManual(readResult({supplierName:'Synthetic Supplier Multiple',invoiceNumber:'SYNTHETIC-MULTI-01',subtotal:3191,vat:670.11,total:3861.11,lines:[...base,...base]}),'synthetic-multiple');
    expect(candidate.status).toBe('needs_review');
    expect(candidate.reviewReason).toMatch(/Las líneas suman 4718\.00 y la base es 3191\.00/);
    const row=invoiceRow(id);
    expect(row.status).toBe('pending');
    expect(row.requested).toBe('accounted');
    expect(row.integrity).toBe('needs_review');
    expect(lineRows(id)).toHaveLength(14);
    expect(historyCount(id)).toBe(0);
    expect(Number(sql(`select count(*) from public.products where last_cost is not null`))).toBe(0);
  });

  it('factura repetida: mismo proveedor y número desde otro canal o archivo se rechaza sin crear filas', async()=>{
    const lines=[line('Synthetic item simple',1000,0.03)];
    await importManual(readResult({invoiceNumber:'IT-DUP',subtotal:30,vat:6.3,total:36.3,lines}),'dup-a');
    await expect(importManual(readResult({invoiceNumber:'IT-DUP',subtotal:30,vat:6.3,total:36.3,lines}),'dup-b')).rejects.toThrow(/parece estar subida ya/);
    expect(Number(sql(`select count(*) from public.invoices`))).toBe(1);
    expect(Number(sql(`select count(*) from public.invoice_lines`))).toBe(1);
  });

  it('cantidades grandes: 250.000 uds se guardan exactas; un código leído como cantidad no rompe el guardado', async()=>{
    const lines=[line('Synthetic item large',250000,0.0123),line('Synthetic item overflow',8765432109876,0.0000003,{lineNet:683})];
    const {id}=await importManual(readResult({supplierName:'Synthetic Supplier Large',invoiceNumber:'IT-BIG',subtotal:3758,vat:789.18,total:4547.18,lines}),'big');
    const rows=lineRows(id);
    expect(rows).toHaveLength(2);
    expect(rows.find((row:any)=>row.description.startsWith('Synthetic item large'))).toMatchObject({quantity:250000,unit_price:0.0123,line_net:3075});
    const absurd=rows.find((row:any)=>row.description.startsWith('Synthetic item overflow'));
    expect(absurd.quantity).toBe(0);
    expect(absurd.price_update_status).toBe('pending');
    expect(invoiceRow(id).status).toBe('pending');
    const raw=json(`select extraction->'integrityCheck'->'lines'->1->>'quantity' as q from public.invoices where id='${id}'`)[0];
    expect(Number(raw.q)).toBe(8765432109876);
  });

  it('Gmail usa el mismo motor: una factura descuadrada no se importa sola y, al revisarla, se guarda pendiente con sus líneas', async()=>{
    const {importGmailCandidate,saveReviewedGmailCandidate}=await import('../src/services/gmailImport');
    const {prepareInvoiceCandidate}=await import('../src/services/invoiceImportPipeline');
    const gmailId=sql(`insert into public.gmail_imports(gmail_message_id,attachment_id,attachment_name,status) values ('msg-1','att-1','SYNTHETIC-GMAIL-01.pdf','found') returning id`).split('\n')[0];
    const candidate={id:gmailId,messageId:'msg-1',attachmentId:'att-1',attachmentName:'SYNTHETIC-GMAIL-01.pdf',mimeType:'application/pdf',status:'found' as const,metadata:{invoiceClassificationVersion:1}};
    const read=readResult({supplierName:'Synthetic Supplier Large',invoiceNumber:'SYNTHETIC-GMAIL-01',subtotal:987.43,vat:207.36,total:1194.79,
      lines:[line('Synthetic item gmail-a',37,2.13),line('Synthetic item gmail-b',41,3.27)]});
    reads.push(read);
    const outcome=await importGmailCandidate('token',candidate as any,categories() as any);
    expect(outcome.kind).not.toBe('imported');
    expect(Number(sql(`select count(*) from public.invoices`))).toBe(0);
    reads.push(read);
    const prepared=await prepareInvoiceCandidate(new File([`gmail:msg-1`],'SYNTHETIC-GMAIL-01.pdf',{type:'application/pdf'}),categories() as any);
    const invoiceId=await saveReviewedGmailCandidate(candidate as any,prepared);
    expect(invoiceRow(invoiceId)).toMatchObject({status:'pending',integrity:'needs_review'});
    expect(lineRows(invoiceId)).toHaveLength(2);
    expect(historyCount(invoiceId)).toBe(0);
    expect(sql(`select status from public.gmail_imports where id='${gmailId}'`)).toBe('imported');
  });

  it('facturas largas: 120 líneas y descripciones con pocas letras se guardan todas', async()=>{
    const lines=Array.from({length:120},(_,index)=>line(`Synthetic item long ${String(index+1).padStart(3,'0')}`,index+1,0.5));
    // Invented numeric-heavy description must exercise the amount-consistency fallback.
    const numericDescription='17 x 29 (320)+7 ZX';
    const {isLikelyProductDescription}=await import('../src/services/invoiceProductLine');
    expect(isLikelyProductDescription(numericDescription)).toBe(false);
    lines.push(line(numericDescription,19,7.31));
    const subtotal=Math.round(lines.reduce((sum,item)=>sum+item.lineNet,0)*100)/100;
    const vat=Math.round(subtotal*0.21*100)/100;
    const {id}=await importManual(readResult({invoiceNumber:'IT-LARGA',subtotal,vat,total:Math.round((subtotal+vat)*100)/100,lines}),'larga');
    expect(lineRows(id)).toHaveLength(121);
    expect(invoiceRow(id).integrity).toBe('ready');
  });

  it('OCR: una factura leída por OCR pasa por el mismo motor y se guarda conciliada', async()=>{
    const lines=[line('Synthetic item ocr-a',2000,0.012),line('TAPA Synthetic item simple',2000,0.008)];
    const {id,candidate}=await importManual(readResult({invoiceNumber:'IT-OCR',usedOcr:true,analysisEngine:'deterministic',text:'Synthetic item ocr-a 2000 0,012 24,00\nTAPA Synthetic item simple 2000 0,008 16,00',subtotal:40,vat:8.4,total:48.4,lines}),'ocr');
    expect((candidate as any).integrityCheck?.status).toBe('ready');
    expect(lineRows(id)).toHaveLength(2);
    expect(invoiceRow(id).integrity).toBe('ready');
  });

  it('unidades ambiguas, descuento y portes: cuadra, se guarda todo y la unidad dudosa no toca costes', async()=>{
    const lines=[line('Synthetic item compound CAJA 7 UNIDADES',10,30,{unit:'caja'}),line('Synthetic item pack',1000,0.03),line('DTO. COMERCIAL 5%',1,-16.5,{lineNet:-16.5}),line('PORTES',1,12)];
    const {id}=await importManual(readResult({invoiceNumber:'IT-DTO',subtotal:325.5,vat:68.36,total:393.86,lines}),'dto');
    const rows=lineRows(id);
    expect(rows).toHaveLength(4);
    expect(invoiceRow(id).integrity).toBe('ready');
    const film=rows.find((row:any)=>row.description.startsWith('Synthetic item compound'));
    expect(film.price_update_status).not.toBe('confirmed');
    expect(film.normalized_unit_price).toBeNull();
  });

  it('descuadre de IVA: las líneas cuadran pero el IVA de cabecera no; queda pendiente con el motivo', async()=>{
    const lines=[line('Synthetic item tax',1000,0.05)];
    const {id,candidate}=await importManual(readResult({invoiceNumber:'IT-IVA',subtotal:50,vat:5,total:55,lines}),'iva');
    expect(candidate.reviewReason).toMatch(/IVA/);
    expect(invoiceRow(id)).toMatchObject({status:'pending',integrity:'needs_review'});
    expect(lineRows(id)).toHaveLength(1);
  });

  it('servicio sin líneas (proveedor clasificado como servicio) no se trata como error de mercancía', async()=>{
    sql(`insert into public.suppliers(owner_id,name,supplier_type) values ('${OWNER_ID}','Synthetic Supplier Service','service')`);
    const {id}=await importManual(readResult({supplierName:'Synthetic Supplier Service',aiIssuer:{name:'Synthetic Supplier Service',taxId:'SYNTH-TAX-SERVICE',email:null,phone:null,address:null,countryCode:'IE'},invoiceNumber:'IT-SERVICE',subtotal:100,vat:21,total:121,lines:[]}),'service');
    expect(invoiceRow(id).integrity).toBe('ready');
    expect(lineRows(id)).toHaveLength(0);
  });

  it('error al guardar líneas: subida manual no deja factura huérfana; Gmail guarda la cabecera pendiente y conserva las líneas', async()=>{
    sql(`alter table public.invoice_lines add constraint it_forced_line_error check (description <> 'LINEA QUE FALLA')`);
    try{
      const lines=[line('LINEA QUE FALLA',10,2),line('Synthetic item persistence',100,0.3)];
      await expect(importManual(readResult({invoiceNumber:'IT-ERR-1',subtotal:50,vat:10.5,total:60.5,lines}),'err1')).rejects.toBeTruthy();
      expect(Number(sql(`select count(*) from public.invoices`))).toBe(0);
      const {importGmailCandidate}=await import('../src/services/gmailImport');
      const gmailId=sql(`insert into public.gmail_imports(gmail_message_id,attachment_id,attachment_name,status) values ('msg-err','att-err','err.pdf','found') returning id`).split('\n')[0];
      reads.push(readResult({invoiceNumber:'IT-ERR-2',subtotal:50,vat:10.5,total:60.5,lines}));
      const outcome=await importGmailCandidate('token',{id:gmailId,messageId:'msg-err',attachmentId:'att-err',attachmentName:'err.pdf',mimeType:'application/pdf',status:'found',metadata:{invoiceClassificationVersion:1}} as any,categories() as any);
      expect(outcome.kind).toBe('imported');
      const saved=json(`select id, status, jsonb_array_length(extraction->'unsavedLines') as unsaved, extraction->>'lineImportWarning' as warning from public.invoices`)[0];
      expect(saved.status).toBe('pending');
      expect(saved.unsaved).toBe(2);
      expect(saved.warning).toMatch(/it_forced_line_error/);
    }finally{
      sql(`alter table public.invoice_lines drop constraint if exists it_forced_line_error`);
    }
  });

  it('el guardado no modifica facturas existentes (histórico intacto)', async()=>{
    const lines=[line('Synthetic item simple',1000,0.03)];
    const {id}=await importManual(readResult({invoiceNumber:'IT-HIST',subtotal:30,vat:6.3,total:36.3,lines}),'hist');
    const snapshot=()=>sql(`select md5(coalesce((select i::text from public.invoices i where id='${id}'),'')||coalesce((select string_agg(l::text,'|' order by l.id) from public.invoice_lines l where invoice_id='${id}'),''))`);
    const before=snapshot();
    await importManual(readResult({invoiceNumber:'IT-OTRA',subtotal:30,vat:6.3,total:36.3,lines}),'otra');
    expect(snapshot()).toBe(before);
  });
});
