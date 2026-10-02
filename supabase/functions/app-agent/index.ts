import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
};
const headers={...corsHeaders,'Content-Type':'application/json'};

function response(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers});}
function clean(value:unknown,max=1000){return typeof value==='string'?value.trim().slice(0,max):'';}
function getAdminKey(){
  const raw=Deno.env.get('SUPABASE_SECRET_KEYS');
  if(raw){try{const parsed=JSON.parse(raw);if(typeof parsed?.default==='string'&&parsed.default.trim())return parsed.default.trim()}catch{}}
  return clean(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
}

const knownPages=['dashboard','sales','orders','invoices','clients','products','suppliers','amazon','support','settings','admin'];

function authorizedPages(profile:any,requested:unknown){
  const requestedPages=Array.isArray(requested)?requested.map(value=>clean(value,50)).filter(value=>knownPages.includes(value)):[];
  const permissions=Array.isArray(profile?.permissions)?profile.permissions.map((value:any)=>clean(value,50)):[];
  const serverAllowed=profile?.role==='admin'
    ?new Set(knownPages)
    :new Set([...permissions,'settings']);
  return requestedPages.filter(page=>serverAllowed.has(page));
}

async function safeRows(query:PromiseLike<any>){
  try{const result=await query;if(result?.error)throw result.error;return result?.data||[];}catch{return [];}
}
async function safeCount(query:PromiseLike<any>){
  try{const result=await query;if(result?.error)throw result.error;return Number(result?.count||0);}catch{return 0;}
}
function orderStatusCodeRow(order:any){
  return clean(order?.source_status,120).toLowerCase();
}
function hasShippingLabelRow(order:any){
  return Boolean(order?.sendcloud_parcel_id||order?.shipping_remote_id||order?.label_created_at);
}
function isPendingOrderRow(order:any){
  const status=orderStatusCodeRow(order);
  const cancelled=status.includes('cancel');
  const processed=['fulfilled','shipped','delivered'].includes(status);
  return !hasShippingLabelRow(order)&&!cancelled&&!processed;
}
type DateRange={from:string;to:string}|null;
function validDate(value:unknown){
  const raw=clean(value,10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw)?raw:'';
}
function readRange(value:any):DateRange{
  const from=validDate(value?.from),to=validDate(value?.to);
  return from&&to?{from,to}:null;
}
function resolveAgentPeriods(preferences:any,currentPage:string){
  const filters=preferences?.filters&&typeof preferences.filters==='object'?preferences.filters:{};
  const dashboard=readRange(filters['dashboard.period']);
  const expenses=readRange(filters['expenses.filters']?.filter);
  const orders=readRange(filters['orders.filters']?.dateFilter);
  const sales=readRange(filters['sales.filters']?.dateFilter);
  return {
    dashboard,
    expenses:currentPage==='dashboard'?dashboard:expenses,
    orders:currentPage==='dashboard'?dashboard:orders,
    sales:currentPage==='dashboard'?dashboard:sales,
  };
}
function applyDateRange(query:any,column:string,range:DateRange,timestamp=false){
  if(!range)return query;
  if(timestamp)return query.gte(column,`${range.from}T00:00:00.000Z`).lte(column,`${range.to}T23:59:59.999Z`);
  return query.gte(column,range.from).lte(column,range.to);
}
async function loadBusinessContext(admin:any,ownerId:string,allowedPages:string[],periods:{dashboard:DateRange;expenses:DateRange;orders:DateRange;sales:DateRange}){
  const can=(page:string)=>allowedPages.includes(page);
  const tasks:Record<string,Promise<any>>={};

  if(can('orders')||can('dashboard')){
    let recentQuery=admin.from('fulfillment_orders')
      .select('id,order_number,source_channel,source_status,customer_name,total_amount,currency,tracking_number,sendcloud_parcel_id,shipping_remote_id,label_created_at,fulfilled_at,order_created_at,carrier_name,shipping_service_name')
      .eq('owner_id',ownerId);
    recentQuery=applyDateRange(recentQuery,'order_created_at',periods.orders,true);
    tasks.ordersRecent=safeRows(recentQuery.order('order_created_at',{ascending:false,nullsFirst:false}).limit(30));
    let stateQuery=admin.from('fulfillment_orders')
      .select('id,source_status,sendcloud_parcel_id,shipping_remote_id,label_created_at,order_created_at')
      .eq('owner_id',ownerId);
    stateQuery=applyDateRange(stateQuery,'order_created_at',periods.orders,true);
    tasks.ordersStateRows=safeRows(stateQuery.limit(10000));
    let totalQuery=admin.from('fulfillment_orders').select('id',{count:'exact',head:true}).eq('owner_id',ownerId);
    totalQuery=applyDateRange(totalQuery,'order_created_at',periods.orders,true);
    tasks.ordersTotal=safeCount(totalQuery);
  }
  if(can('invoices')||can('dashboard')){
    let recentQuery=admin.from('invoices')
      .select('id,invoice_number,supplier_id,issue_date,received_date,total_amount,net_amount,tax_amount,status,payment_status,paid_at')
      .eq('owner_id',ownerId);
    recentQuery=applyDateRange(recentQuery,'issue_date',periods.expenses);
    tasks.expensesRecent=safeRows(recentQuery.order('issue_date',{ascending:false,nullsFirst:false}).limit(30));
    let totalQuery=admin.from('invoices').select('id',{count:'exact',head:true}).eq('owner_id',ownerId);
    totalQuery=applyDateRange(totalQuery,'issue_date',periods.expenses);
    tasks.expensesTotal=safeCount(totalQuery);
    let pendingQuery=admin.from('invoices').select('id',{count:'exact',head:true}).eq('owner_id',ownerId).eq('status','pending');
    pendingQuery=applyDateRange(pendingQuery,'issue_date',periods.expenses);
    tasks.expensesPending=safeCount(pendingQuery);
    let unpaidQuery=admin.from('invoices').select('id',{count:'exact',head:true}).eq('owner_id',ownerId).eq('payment_status','unpaid');
    unpaidQuery=applyDateRange(unpaidQuery,'issue_date',periods.expenses);
    tasks.expensesUnpaid=safeCount(unpaidQuery);
    let paidQuery=admin.from('invoices').select('id',{count:'exact',head:true}).eq('owner_id',ownerId).eq('payment_status','paid');
    paidQuery=applyDateRange(paidQuery,'issue_date',periods.expenses);
    tasks.expensesPaid=safeCount(paidQuery);
  }
  if(can('products')||can('dashboard')){
    tasks.products=safeRows(admin.from('products')
      .select('id,name,sku,ean,category,base_unit,last_cost,sale_price,sales_tax_rate,active')
      .eq('owner_id',ownerId).eq('active',true).order('name').limit(60));
    tasks.productsTotal=safeCount(admin.from('products').select('id',{count:'exact',head:true}).eq('owner_id',ownerId).eq('active',true));
    tasks.productsWithoutCost=safeCount(admin.from('products').select('id',{count:'exact',head:true}).eq('owner_id',ownerId).eq('active',true).is('last_cost',null));
  }
  if(can('suppliers')||can('invoices')||can('dashboard')){
    tasks.suppliers=safeRows(admin.from('suppliers')
      .select('id,name,tax_id,email,phone,supplier_type')
      .eq('owner_id',ownerId).order('name').limit(60));
    tasks.suppliersTotal=safeCount(admin.from('suppliers').select('id',{count:'exact',head:true}).eq('owner_id',ownerId));
  }
  if(can('clients')||can('sales')||can('dashboard')){
    tasks.clients=safeRows(admin.from('clients')
      .select('id,name,tax_id,email,phone,city,country_code,payment_terms_days')
      .eq('owner_id',ownerId).eq('active',true).order('name').limit(60));
    tasks.clientsTotal=safeCount(admin.from('clients').select('id',{count:'exact',head:true}).eq('owner_id',ownerId).eq('active',true));
  }
  if(can('sales')||can('dashboard')){
    let recentQuery=admin.from('sales_invoices')
      .select('id,invoice_number,client_name,status,issue_date,due_date,total_amount,tax_amount,currency')
      .eq('owner_id',ownerId);
    recentQuery=applyDateRange(recentQuery,'issue_date',periods.sales);
    tasks.salesRecent=safeRows(recentQuery.order('issue_date',{ascending:false,nullsFirst:false}).limit(30));
    let totalQuery=admin.from('sales_invoices').select('id',{count:'exact',head:true}).eq('owner_id',ownerId);
    totalQuery=applyDateRange(totalQuery,'issue_date',periods.sales);
    tasks.salesTotal=safeCount(totalQuery);
    let openQuery=admin.from('sales_invoices').select('id',{count:'exact',head:true}).eq('owner_id',ownerId).in('status',['issued','sent','partially_paid']);
    openQuery=applyDateRange(openQuery,'issue_date',periods.sales);
    tasks.salesOpen=safeCount(openQuery);
  }
  if(can('support')){
    tasks.supportRecent=safeRows(admin.from('support_tickets')
      .select('id,ticket_number,subject,status,priority,last_activity_at')
      .eq('owner_id',ownerId).order('last_activity_at',{ascending:false}).limit(20));
    tasks.supportOpen=safeCount(admin.from('support_tickets').select('id',{count:'exact',head:true}).eq('owner_id',ownerId).in('status',['open','in_progress','waiting_user']));
  }

  const keys=Object.keys(tasks);
  const values=await Promise.all(keys.map(key=>tasks[key]));
  const raw=Object.fromEntries(keys.map((key,index)=>[key,values[index]])) as Record<string,any>;
  const supplierById=new Map((raw.suppliers||[]).map((item:any)=>[String(item.id),String(item.name||'Proveedor')]));
  if(Array.isArray(raw.expensesRecent)){
    raw.expensesRecent=raw.expensesRecent.map((item:any)=>({...item,supplier_name:supplierById.get(String(item.supplier_id))||null}));
  }
  const pendingOrders=Array.isArray(raw.ordersStateRows)?raw.ordersStateRows.filter(isPendingOrderRow):[];
  return {
    orders:raw.ordersRecent?{total:raw.ordersTotal,pending:pendingOrders.length,recent:raw.ordersRecent}:undefined,
    expenses:raw.expensesRecent?{total:raw.expensesTotal,pendingReview:raw.expensesPending,unpaid:raw.expensesUnpaid,paid:raw.expensesPaid,recent:raw.expensesRecent}:undefined,
    products:raw.products?{total:raw.productsTotal,withoutCost:raw.productsWithoutCost,items:raw.products}:undefined,
    suppliers:raw.suppliers?{total:raw.suppliersTotal,items:raw.suppliers}:undefined,
    clients:raw.clients?{total:raw.clientsTotal,items:raw.clients}:undefined,
    sales:raw.salesRecent?{total:raw.salesTotal,open:raw.salesOpen,recent:raw.salesRecent}:undefined,
    support:raw.supportRecent?{open:raw.supportOpen,recent:raw.supportRecent}:undefined,
    periods,
  };
}



function ymdLocal(date:Date){
  const y=date.getFullYear(),m=String(date.getMonth()+1).padStart(2,'0'),d=String(date.getDate()).padStart(2,'0');
  return `${y}-${m}-${d}`;
}
function agentQuestionRange(text:string){
  const today=new Date();
  let from=new Date(today.getFullYear(),today.getMonth(),1);
  let label='este mes';
  if(hasAny(text,['hoy'])){from=new Date(today);label='hoy';}
  else if(hasAny(text,['esta semana','ultimos 7 dias','últimos 7 días'])){from=new Date(today);from.setDate(from.getDate()-6);label='los últimos 7 días';}
  else if(hasAny(text,['ultimos 30 dias','últimos 30 días'])){from=new Date(today);from.setDate(from.getDate()-29);label='los últimos 30 días';}
  else if(hasAny(text,['este ano','este año','ano actual','año actual'])){from=new Date(today.getFullYear(),0,1);label='este año';}
  else if(hasAny(text,['trimestre','este trimestre'])){from=new Date(today.getFullYear(),Math.floor(today.getMonth()/3)*3,1);label='este trimestre';}
  return {from:ymdLocal(from),to:ymdLocal(today),label};
}
async function loadAmazonAgentContext(userClient:any,text:string){
  const range=agentQuestionRange(text);
  const sortBy=hasAny(text,['rentable','beneficio','beneficios','margen'])?'profit_before_ads'
    :hasAny(text,['factura mas','facturación','facturacion','ventas','vende mas dinero'])?'gross_sales'
    :'units';
  try{
    const [summaryResult,productsResult]=await Promise.all([
      userClient.rpc('amazon_analytics_summary',{from_date:range.from,to_date:range.to,marketplace_ids:null}),
      userClient.rpc('amazon_analytics_products',{
        from_date:range.from,to_date:range.to,marketplace_ids:null,search:null,page:1,page_size:10,sort_by:sortBy,sort_dir:'desc',
      }),
    ]);
    return {
      range,
      sortBy,
      summary:summaryResult?.error?null:summaryResult?.data||null,
      products:productsResult?.error?[]:(productsResult?.data?.items||[]),
    };
  }catch{return {range,sortBy,summary:null,products:[]};}
}
function sanitizedHistory(value:unknown){
  if(!Array.isArray(value))return [];
  return value.slice(-8).map((item:any)=>({role:item?.role==='assistant'?'assistant':'user',content:clean(item?.content,1000)})).filter((item:any)=>item.content);
}

type LocalActionParams={
  name:string|null;taxId:string|null;email:string|null;phone:string|null;city:string|null;countryCode:string|null;
  unit:string|null;sku:string|null;ean:string|null;category:string|null;price:number|null;salePrice:number|null;
  salesTaxRate:number|null;supplierType:'unclassified'|'goods'|'service'|'both'|null;
  invoiceId:string|null;status:'pending'|'reviewed'|'accounted'|null;
};
type LocalAction={
  type:'navigate'|'open_expense_upload'|'open_product_create'|'open_supplier_create'|'open_settings'|'refresh_data'|'sync_orders'|'create_client'|'create_product'|'create_supplier'|'set_expense_status'|'none';
  target:string|null;
  params:LocalActionParams;
};
function localParams():LocalActionParams{
  return {name:null,taxId:null,email:null,phone:null,city:null,countryCode:null,unit:null,sku:null,ean:null,category:null,price:null,salePrice:null,salesTaxRate:null,supplierType:null,invoiceId:null,status:null};
}
function localAction(type:LocalAction['type']='none',target:string|null=null,params:Partial<LocalActionParams>={}):LocalAction{
  return {type,target,params:{...localParams(),...params}};
}
function localReply(answer:string,action=localAction(),domain:AgentDomain='general'){
  return {ok:true,answer,action,engine:'zenvia-local-router-v2',domain};
}
function norm(value:string){
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[¿?¡!.,;:()[\]{}"]/g,' ').replace(/\s+/g,' ').trim();
}
function hasAny(text:string,terms:string[]){return terms.some(term=>text.includes(norm(term)));}
type AgentDomain='general'|'orders_shipping'|'expenses'|'sales_clients'|'catalog_suppliers'|'amazon'|'support'|'settings_admin';
type KnowledgeArticle={domain:AgentDomain;page:string|null;keywords:string[];answer:string};

const APP_KNOWLEDGE:KnowledgeArticle[]=[
  {domain:'general',page:'dashboard',keywords:['resumen','dashboard','kpi','pendiente','inicio'],answer:'Resumen concentra KPIs, alertas y accesos rápidos. Los datos respetan los filtros y permisos del usuario.'},
  {domain:'orders_shipping',page:'orders',keywords:['pedido','pedidos','envio','envíos','etiqueta','tracking','transportista','mrw','envia','sendcloud','shopify'],answer:'Pedidos centraliza pedidos de los canales conectados y la logística. ZENVIA mantiene los datos del pedido como fuente de verdad; al preparar un envío compara proveedores habilitados y solo usa el proveedor elegido para cotizar o generar la etiqueta.'},
  {domain:'expenses',page:'invoices',keywords:['gasto','gastos','factura de gasto','facturas de gasto','gmail','iva','proveedor factura','importar factura'],answer:'Gastos gestiona facturas recibidas: importación individual o masiva, Gmail, revisión, categoría, proveedor, estado contable, pago, PDF y líneas detectadas. El motor de lectura debe pedir revisión cuando no puede demostrar un dato fiscal o identificativo.'},
  {domain:'sales_clients',page:'sales',keywords:['facturacion','facturación','factura emitida','venta','cliente','cobro'],answer:'Facturación gestiona facturas emitidas, vencimientos, cobros y documentos de venta. Clientes mantiene identidad fiscal, contacto y valores comerciales reutilizados por la facturación.'},
  {domain:'catalog_suppliers',page:'products',keywords:['producto','productos','sku','ean','coste','precio','proveedor','proveedores'],answer:'Productos mantiene catálogo, SKU/EAN, unidad, IVA, costes, precios y vinculaciones. Proveedores mantiene identidad fiscal, contacto, tipo y categoría habitual.'},
  {domain:'amazon',page:'amazon',keywords:['amazon','asin','seller','marketplace','rentabilidad','reembolso','inventario'],answer:'Amazon reúne sincronización y analítica del canal: pedidos, unidades, ventas, reembolsos, rentabilidad, inventario y vinculaciones de productos, siempre limitado a los datos disponibles del workspace.'},
  {domain:'support',page:'support',keywords:['soporte','ticket','tickets','incidencia'],answer:'Soporte permite abrir y seguir tickets, adjuntos, estados y actividad. Los administradores disponen de las acciones adicionales que permita su rol.'},
  {domain:'settings_admin',page:'settings',keywords:['configuracion','configuración','integracion','integración','preferencias','usuario','permiso','administracion','auditoria','tema','modo oscuro'],answer:'Configuración concentra identidad, facturación, gastos, pedidos, envíos, productos, clientes, proveedores, integraciones, alertas y preferencias. Administración gestiona usuarios, permisos y auditoría; el agente nunca debe saltarse los permisos del usuario.'},
];

function basicSocial(text:string){
  return /^(hola|buenas|buenos dias|buen dia|hey|hello|que tal|qué tal|gracias|muchas gracias|perfecto|genial|vale|ok|okay|adios|adiós|hasta luego)(\s+zenvia)?$/.test(text);
}
function routeAgentDomain(text:string,currentPage:string):AgentDomain{
  let best:{domain:AgentDomain;score:number}|null=null;
  for(const article of APP_KNOWLEDGE){
    let score=article.page===currentPage?1:0;
    for(const keyword of article.keywords)if(text.includes(norm(keyword)))score+=keyword.includes(' ')?3:2;
    if(!best||score>best.score)best={domain:article.domain,score};
  }
  return best&&best.score>0?best.domain:'general';
}
function appScopeEvidence(text:string){
  const appWords=[
    'zenvia','pedido','envio','etiqueta','tracking','transportista','mrw','envia','sendcloud','shopify','amazon','marketplace',
    'gasto','factura','iva','cliente','producto','sku','ean','proveedor','soporte','ticket','configuracion','integracion',
    'usuario','permiso','auditoria','dashboard','resumen','kpi','gmail','cobro','venta','inventario','reembolso','rentabilidad'
  ];
  return appWords.some(word=>text.includes(norm(word)));
}
function outOfScopeReply(){
  return 'Solo puedo ayudarte con ZENVIA Gestión y con los datos, procesos y acciones disponibles dentro de la aplicación. Si quieres, dime qué módulo o tarea de ZENVIA necesitas resolver.';
}
function knowledgeAnswer(text:string,currentPage:string){
  const domain=routeAgentDomain(text,currentPage);
  const candidates=APP_KNOWLEDGE.filter(item=>item.domain===domain);
  let best=candidates[0];
  let bestScore=-1;
  for(const article of candidates){
    let score=article.page===currentPage?1:0;
    for(const keyword of article.keywords)if(text.includes(norm(keyword)))score+=keyword.includes(' ')?3:2;
    if(score>bestScore){best=article;bestScore=score;}
  }
  return best?.answer||null;
}

function pageAlias(text:string){
  const aliases:Record<string,string[]>={
    dashboard:['resumen','inicio','dashboard','escritorio'],
    sales:['facturacion','ventas','facturas emitidas','factura de venta'],
    orders:['pedidos','pedido','envios','envio','etiquetas','tracking','sendcloud','envia'],
    invoices:['gastos','facturas de gasto','factura de gasto','gmail'],
    clients:['clientes','cliente'],
    products:['productos','producto'],
    suppliers:['proveedores','proveedor'],
    amazon:['amazon','marketplace'],
    support:['soporte','tickets','ticket'],
    settings:['configuracion','ajustes','integraciones'],
    admin:['administracion','usuarios','permisos','auditoria'],
  };
  for(const [page,values] of Object.entries(aliases))if(values.some(value=>text.includes(norm(value))))return page;
  return null;
}
function pageTitle(page:string){
  return ({dashboard:'Resumen',sales:'Facturación',orders:'Pedidos',invoices:'Gastos',clients:'Clientes',products:'Productos',suppliers:'Proveedores',amazon:'Amazon',support:'Soporte',settings:'Configuración',admin:'Administración'} as Record<string,string>)[page]||page;
}
function helpForPage(page:string){
  const help:Record<string,string>={
    dashboard:'En Resumen ves KPIs, alertas y accesos rápidos. También puedo decirte qué tienes pendiente usando tus datos reales.',
    sales:'En Facturación gestionas facturas emitidas y clientes. Puedo consultar facturas abiertas y crear clientes.',
    orders:'En Pedidos puedes sincronizar, comparar opciones logísticas, generar etiquetas y revisar tracking. Yo puedo consultar pendientes y lanzar la sincronización con confirmación.',
    invoices:'En Gastos puedes importar facturas manualmente o desde Gmail, revisar y contabilizar. Puedo consultar pendientes y cambiar el estado de una factura concreta.',
    clients:'En Clientes gestionas datos fiscales y comerciales. Puedo consultar y crear clientes.',
    products:'En Productos gestionas catálogo, costes, precios y vinculaciones. Puedo localizar productos, detectar los que no tienen coste y crear productos.',
    suppliers:'En Proveedores gestionas datos fiscales, tipo y categoría habitual. Puedo consultar y crear proveedores.',
    amazon:'En Amazon revisas sincronización, inventario, rentabilidad y vinculaciones. Las acciones delicadas de Amazon siguen fuera del agente.',
    support:'En Soporte puedes abrir y seguir tickets. Puedo decirte cuántos siguen abiertos y cuáles tienen actividad reciente.',
    settings:'En Configuración gestionas empresa, facturación, envíos, productos, proveedores, integraciones, tema y valores globales.',
    admin:'En Administración gestionas usuarios, permisos y auditoría. El agente no modifica usuarios ni permisos.',
  };
  return help[page]||'Puedo ayudarte a navegar, consultar datos reales y ejecutar acciones seguras de ZENVIA Gestión.';
}
function euroLocal(value:unknown,currency='EUR'){
  const n=Number(value);if(!Number.isFinite(n))return '—';
  try{return new Intl.NumberFormat('es-ES',{style:'currency',currency:currency||'EUR'}).format(n)}catch{return n.toFixed(2)+' €'}
}
function extractNamed(raw:string,kind:string){
  const patterns:Record<string,RegExp>={
    supplier:/(?:crea|crear|añade|anade|nuevo)\s+(?:un\s+)?proveedor(?:\s+llamado|\s+que se llame|\s+con nombre)?\s+([^,;\n]+)/i,
    client:/(?:crea|crear|añade|anade|nuevo)\s+(?:un\s+)?cliente(?:\s+llamado|\s+que se llame|\s+con nombre)?\s+([^,;\n]+)/i,
    product:/(?:crea|crear|añade|anade|nuevo)\s+(?:un\s+)?producto(?:\s+llamado|\s+que se llame|\s+con nombre)?\s+([^,;\n]+)/i,
  };
  return raw.match(patterns[kind])?.[1]?.trim().replace(/[.,;]+$/,'')||'';
}
function emailFrom(raw:string){return raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]||''}
function taxIdFrom(raw:string){return raw.match(/\b(?:[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]|\d{8}[A-Z]|[XYZ]\d{7}[A-Z])\b/i)?.[0]?.toUpperCase()||''}
function pendingSummary(ctx:any,allowed:string[]){
  const parts:string[]=[];
  if(allowed.includes('orders')&&ctx.orders)parts.push(String(ctx.orders.pending)+' pedidos sin etiqueta');
  if(allowed.includes('invoices')&&ctx.expenses){parts.push(String(ctx.expenses.pendingReview)+' facturas de gasto pendientes de revisar');parts.push(String(ctx.expenses.unpaid||0)+' facturas de gasto por pagar');}
  if(allowed.includes('sales')&&ctx.sales)parts.push(String(ctx.sales.open)+' facturas emitidas abiertas');
  if(allowed.includes('products')&&ctx.products)parts.push(String(ctx.products.withoutCost)+' productos sin coste');
  if(allowed.includes('support')&&ctx.support)parts.push(String(ctx.support.open)+' tickets abiertos');
  const period=ctx?.periods?.dashboard;
  const scope=period?`Con el periodo seleccionado (${period.from} → ${period.to}), `:'';
  return parts.length?scope+'ahora mismo veo: '+parts.join('; ')+'.':'No veo tareas pendientes en los módulos a los que tienes acceso.';
}
function processLocalAgent(raw:string,ctx:any,allowed:string[],ui:any,history:any[]=[]){
  const text=norm(raw),currentPage=clean(ui?.currentPage,50)||'dashboard';
  const previousUser=[...history].reverse().find(item=>item?.role==='user')?.content||'';
  const contextual=text.split(' ').length<=5&&previousUser?norm(previousUser+' '+raw):text;

  if(/^(hola|buenas|buenos dias|buen dia|hey|hello|que tal|qué tal)(\s+zenvia)?$/.test(text)){
    return localReply('¡Hola! Soy ZENVIA IA. Puedo ayudarte con ZENVIA Gestión, consultar datos reales de tu empresa y llevarte o preparar acciones dentro de la aplicación. ¿Qué necesitas?');
  }
  if(/^(gracias|muchas gracias|perfecto|genial|vale|ok|okay)$/.test(text)){
    return localReply('De nada. Dime qué quieres consultar o hacer en ZENVIA Gestión.');
  }

  // Ámbito estricto: el agente no responde cultura general, programación,
  // noticias, recetas ni otros productos. Solo cortesía básica queda fuera del dominio.
  if(!basicSocial(text)&&!appScopeEvidence(contextual)){
    return localReply(outOfScopeReply());
  }

  // Una sola pregunta aclaratoria cuando una orden corta no identifica objeto/acción.
  if(text.split(' ').length<=3&&hasAny(text,['hazlo','crealo','créalo','cambialo','cámbialo','borralo','bórralo','arreglalo','arréglalo'])&&!previousUser){
    return localReply('¿Qué elemento o acción concreta de ZENVIA quieres que gestione?');
  }

  if(hasAny(text,['como funciona la aplicacion','cómo funciona la aplicación','explicame la aplicacion','explícame la aplicación','que es zenvia gestion','qué es zenvia gestión','como funciona zenvia gestion','cómo funciona zenvia gestión'])){
    return localReply('ZENVIA Gestión centraliza la operativa de la empresa: Resumen reúne KPIs y pendientes; Facturación gestiona facturas emitidas; Pedidos sincroniza pedidos, logística, etiquetas y tracking; Gastos importa y controla facturas de proveedores, su revisión, contabilización y pago; Clientes, Productos y Proveedores mantienen los maestros; Amazon analiza ventas, unidades, rentabilidad e inventario; Soporte gestiona incidencias; Configuración concentra integraciones y reglas; y Administración controla usuarios y permisos. Puedes preguntarme por datos concretos de esos módulos o pedirme que te lleve a uno.');
  }

  if(hasAny(text,['que tengo pendiente','pendientes ahora','resumen pendiente','cosas pendientes','que me queda','qué me queda']))return localReply(pendingSummary(ctx,allowed));

  if(hasAny(contextual,['pedidos pendientes','pedido pendiente','sin etiqueta'])&&ctx.orders&&allowed.includes('orders')){
    const recent=(ctx.orders.recent||[]).filter(isPendingOrderRow).slice(0,8);
    const detail=recent.length?' Los más recientes: '+recent.map((o:any)=>String(o.order_number||o.id)+' ('+String(o.customer_name||'sin cliente')+')').join(', ')+'.':'';
    return localReply('Tienes '+String(ctx.orders.pending)+' pedidos pendientes de etiqueta.'+detail);
  }
  if(hasAny(contextual,['ultimos pedidos','últimos pedidos','pedidos recientes'])&&ctx.orders&&allowed.includes('orders')){
    const rows=(ctx.orders.recent||[]).slice(0,8);
    return localReply(rows.length?'Últimos pedidos:\n'+rows.map((o:any)=>String(o.order_number||o.id)+' · '+String(o.customer_name||'sin cliente')+' · '+euroLocal(o.total_amount,o.currency)).join('\n'):'No hay pedidos recientes en el periodo consultado.');
  }
  if((hasAny(contextual,['facturas pendientes','gastos pendientes','facturas de gasto pendientes'])&&!hasAny(contextual,['pagar','pago','pagadas']))&&ctx.expenses&&allowed.includes('invoices')){
    const rows=(ctx.expenses.recent||[]).filter((i:any)=>i.status==='pending').slice(0,8);
    return localReply('Tienes '+String(ctx.expenses.pendingReview)+' facturas de gasto pendientes de revisar.'+(rows.length?'\n'+rows.map((i:any)=>String(i.invoice_number||'sin número')+' · '+String(i.supplier_name||'proveedor')+' · '+euroLocal(i.total_amount)).join('\n'):''));
  }
  if(hasAny(contextual,['por pagar','pendientes de pago','sin pagar','facturas no pagadas'])&&ctx.expenses&&allowed.includes('invoices')){
    const rows=(ctx.expenses.recent||[]).filter((i:any)=>String(i.payment_status||'unpaid')!=='paid').slice(0,8);
    return localReply('Tienes '+String(ctx.expenses.unpaid||0)+' facturas de gasto por pagar.'+(rows.length?'\n'+rows.map((i:any)=>String(i.invoice_number||'sin número')+' · '+String(i.supplier_name||'proveedor')+' · '+euroLocal(i.total_amount)).join('\n'):''));
  }
  if(hasAny(contextual,['facturas pagadas','gastos pagados','cuantas pagadas','cuántas pagadas'])&&ctx.expenses&&allowed.includes('invoices')){
    return localReply('Hay '+String(ctx.expenses.paid||0)+' facturas de gasto marcadas como pagadas en el periodo consultado.');
  }
  if(hasAny(contextual,['productos sin coste','sin coste','productos sin precio de coste'])&&ctx.products&&allowed.includes('products')){
    const rows=(ctx.products.items||[]).filter((p:any)=>p.last_cost==null).slice(0,12);
    return localReply(rows.length?'Tienes '+String(ctx.products.withoutCost)+' productos sin coste. Ejemplos: '+rows.map((p:any)=>String(p.name)).join(', ')+'.':'No veo productos activos sin coste.');
  }
  if(hasAny(contextual,['cuantos productos','cuántos productos','numero de productos','número de productos'])&&ctx.products&&allowed.includes('products'))return localReply('Tienes '+String(ctx.products.total)+' productos activos.');
  if(hasAny(contextual,['cuantos clientes','cuántos clientes','numero de clientes','número de clientes'])&&ctx.clients&&allowed.includes('clients'))return localReply('Tienes '+String(ctx.clients.total)+' clientes activos.');
  if(hasAny(contextual,['cuantos proveedores','cuántos proveedores','numero de proveedores','número de proveedores'])&&ctx.suppliers&&allowed.includes('suppliers'))return localReply('Tienes '+String(ctx.suppliers.total)+' proveedores.');
  if(hasAny(contextual,['tickets abiertos','ticket abierto','soporte pendiente'])&&ctx.support&&allowed.includes('support'))return localReply('Hay '+String(ctx.support.open)+' tickets de soporte abiertos.');
  if(hasAny(contextual,['facturas abiertas','facturas por cobrar','facturas emitidas pendientes'])&&ctx.sales&&allowed.includes('sales'))return localReply('Tienes '+String(ctx.sales.open)+' facturas emitidas abiertas.');

  if(ctx.amazon&&allowed.includes('amazon')&&hasAny(contextual,['amazon','marketplace'])){
    const products=Array.isArray(ctx.amazon.products)?ctx.amazon.products:[];
    const top=products[0];
    const rangeLabel=ctx.amazon.range?.label||'el periodo consultado';
    if(top&&hasAny(contextual,['mas vendido','más vendido','producto vendido','unidades','vende mas','vende más'])){
      const name=String(top.productName||top.sellerSku||top.asin||'Producto');
      return localReply(`El producto más vendido en Amazon en ${rangeLabel} es ${name}, con ${Number(top.units||0).toLocaleString('es-ES')} unidades en ${Number(top.orders||0).toLocaleString('es-ES')} pedidos. Ventas brutas: ${euroLocal(top.grossSales)}.`);
    }
    if(top&&hasAny(contextual,['mas rentable','más rentable','beneficio','margen'])){
      const name=String(top.productName||top.sellerSku||top.asin||'Producto');
      return localReply(`El producto con mayor beneficio antes de publicidad en Amazon en ${rangeLabel} es ${name}: ${euroLocal(top.profitBeforeAds)} de beneficio y ${top.marginPct==null?'margen no disponible':Number(top.marginPct).toLocaleString('es-ES')+' % de margen'}.`);
    }
    if(top&&hasAny(contextual,['mas factura','más factura','facturacion','facturación','ventas'])){
      const name=String(top.productName||top.sellerSku||top.asin||'Producto');
      return localReply(`El producto con más ventas brutas en Amazon en ${rangeLabel} es ${name}: ${euroLocal(top.grossSales)}, ${Number(top.units||0).toLocaleString('es-ES')} unidades.`);
    }
    if(ctx.amazon.summary){
      const s=ctx.amazon.summary;
      return localReply(`Resumen de Amazon de ${rangeLabel}: ${Number(s.orders||0).toLocaleString('es-ES')} pedidos, ${Number(s.units||0).toLocaleString('es-ES')} unidades y ${euroLocal(s.grossSales)} de ventas brutas.`);
    }
  }

  const entitySearch=(items:any[],fields:string[])=>{
    const meaningful=text.split(' ').filter(word=>word.length>=4&&!['cliente','producto','proveedor','busca','dime','sobre','datos','cual','cuál','tiene'].includes(word));
    return items.filter(item=>meaningful.some(word=>fields.some(field=>norm(String(item?.[field]||'')).includes(word)))).slice(0,5);
  };
  if(ctx.products&&allowed.includes('products')&&hasAny(text,['producto','sku','ean'])){
    const matches=entitySearch(ctx.products.items||[],['name','sku','ean','category']);
    if(matches.length===1){const p=matches[0];return localReply(`${p.name}: SKU ${p.sku||'—'}, coste ${p.last_cost==null?'sin coste':euroLocal(p.last_cost)}, precio de venta ${p.sale_price==null?'sin precio':euroLocal(p.sale_price)}.`);}
    if(matches.length>1)return localReply('He encontrado varios productos: '+matches.map((p:any)=>String(p.name)).join(', ')+'.');
  }
  if(ctx.clients&&allowed.includes('clients')&&hasAny(text,['cliente'])){
    const matches=entitySearch(ctx.clients.items||[],['name','tax_id','email','city']);
    if(matches.length===1){const p=matches[0];return localReply(`${p.name}: ${p.tax_id||'sin NIF/CIF'}, ${p.email||'sin email'}, ${p.city||'sin ciudad'}.`);}
    if(matches.length>1)return localReply('He encontrado varios clientes: '+matches.map((p:any)=>String(p.name)).join(', ')+'.');
  }
  if(ctx.suppliers&&allowed.includes('suppliers')&&hasAny(text,['proveedor'])){
    const matches=entitySearch(ctx.suppliers.items||[],['name','tax_id','email']);
    if(matches.length===1){const p=matches[0];return localReply(`${p.name}: ${p.tax_id||'sin NIF/CIF'}, tipo ${p.supplier_type||'sin clasificar'}, ${p.email||'sin email'}.`);}
    if(matches.length>1)return localReply('He encontrado varios proveedores: '+matches.map((p:any)=>String(p.name)).join(', ')+'.');
  }

  if(hasAny(text,['sincroniza los pedidos','sincronizar pedidos','actualiza los pedidos','trae los pedidos'])&&allowed.includes('orders'))return localReply('He preparado la sincronización de pedidos. Te pediré confirmación antes de ejecutarla.',localAction('sync_orders','orders'));

  if(hasAny(text,['crea un proveedor','crear proveedor','nuevo proveedor','añade un proveedor','anade un proveedor'])&&allowed.includes('suppliers')){
    const name=extractNamed(raw,'supplier');if(!name)return localReply('Dime al menos el nombre del proveedor que quieres crear.');
    return localReply('He preparado el alta del proveedor “'+name+'”.',localAction('create_supplier','suppliers',{name,taxId:taxIdFrom(raw)||null,email:emailFrom(raw)||null}));
  }
  if(hasAny(text,['crea un cliente','crear cliente','nuevo cliente','añade un cliente','anade un cliente'])&&allowed.includes('clients')){
    const name=extractNamed(raw,'client');if(!name)return localReply('Dime al menos el nombre del cliente que quieres crear.');
    return localReply('He preparado el alta del cliente “'+name+'”.',localAction('create_client','clients',{name,taxId:taxIdFrom(raw)||null,email:emailFrom(raw)||null}));
  }
  if(hasAny(text,['crea un producto','crear producto','nuevo producto','añade un producto','anade un producto'])&&allowed.includes('products')){
    const name=extractNamed(raw,'product');if(!name)return localReply('Dime al menos el nombre del producto que quieres crear.');
    return localReply('He preparado el alta del producto “'+name+'”.',localAction('create_product','products',{name}));
  }

  const targetStatus:LocalActionParams['status']=hasAny(text,['contabilizada','contabilizado','contabilizar'])?'accounted':hasAny(text,['revisada','revisado','revisar'])?'reviewed':null;
  if(targetStatus&&hasAny(text,['factura','gasto'])&&ctx.expenses&&allowed.includes('invoices')){
    const matches=(ctx.expenses.recent||[]).filter((inv:any)=>{
      const number=norm(String(inv.invoice_number||'')),supplier=norm(String(inv.supplier_name||''));
      return (number&&text.includes(number))||(supplier&&text.includes(supplier));
    });
    if(matches.length===1){
      const inv=matches[0];
      return localReply('He preparado el cambio de estado de la factura '+String(inv.invoice_number||'seleccionada')+'.',localAction('set_expense_status','invoices',{invoiceId:String(inv.id),status:targetStatus}));
    }
    return localReply(matches.length>1?'Encuentro varias facturas que coinciden. Indícame el número exacto.':'No he podido identificar con seguridad la factura. Indícame su número exacto o el proveedor.');
  }

  if(hasAny(text,['que puedes hacer','qué puedes hacer','para que sirves','para qué sirves','ayuda'])){
    return localReply('Puedo conversar sobre cómo funciona ZENVIA Gestión, explicar cada módulo, consultar tus datos reales de pedidos, gastos y pagos, facturación, productos, clientes, proveedores, Amazon y soporte, navegar por la aplicación y preparar con confirmación acciones como sincronizar pedidos o crear maestros.');
  }
  if(hasAny(text,['que puedo hacer desde aqui','qué puedo hacer desde aquí','esta pantalla','esta seccion','esta sección']))return localReply(helpForPage(currentPage));
  if(hasAny(text,['importar factura','importo una factura','subir factura','cargar factura']))return localReply('Puedo abrirte el importador de Gastos. También puedes importar desde Gmail si lo tienes conectado.',localAction('open_expense_upload','invoices'));
  if(hasAny(text,['modo oscuro','tema oscuro','modo claro']))return localReply('En Configuración defines el tema global preferido. El botón rápido de claro/oscuro aplica un cambio local al dispositivo actual, sin modificar los demás equipos.');
  if(hasAny(text,['sendcloud','envia.com','envia com','transportista','logistica','logística'])&&hasAny(text,['configurar','conectar','integracion','integración','donde']))return localReply('Sendcloud y Envia.com se gestionan en Configuración → Integraciones y pueden convivir.',localAction('open_settings','settings'));

  const mentionedPage=pageAlias(text);
  if(mentionedPage&&hasAny(text,['como funciona','cómo funciona','explica','explicame','explícame','para que sirve','para qué sirve','que hace','qué hace'])){
    if(!allowed.includes(mentionedPage))return localReply('No tienes acceso a '+pageTitle(mentionedPage)+'.');
    return localReply(helpForPage(mentionedPage));
  }

  if(hasAny(text,['llevame','llévame','ve a','abre','ir a','quiero ir','muestrame','muéstrame'])){
    const page=pageAlias(text);
    if(page&&!allowed.includes(page))return localReply('No tienes acceso a '+pageTitle(page)+'.');
    if(page==='settings')return localReply('Abro Configuración.',localAction('open_settings','settings'));
    if(page)return localReply('Te llevo a '+pageTitle(page)+'.',localAction('navigate',page));
  }

  if(mentionedPage&&allowed.includes(mentionedPage))return localReply(helpForPage(mentionedPage));

  const grounded=knowledgeAnswer(contextual,currentPage);
  if(grounded)return localReply(grounded,localAction(),routeAgentDomain(contextual,currentPage));
  return localReply('No tengo documentada una respuesta fiable para eso dentro de ZENVIA Gestión. Dime la pantalla, campo o mensaje exacto y te indicaré la alternativa disponible sin inventar funciones.');
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  if(req.method!=='POST')return response({error:'Método no permitido.'},405);
  try{
    const supabaseUrl=clean(Deno.env.get('SUPABASE_URL'),500),adminKey=getAdminKey();
    if(!supabaseUrl||!adminKey)return response({error:'Configuración interna no disponible.'},503);
    const admin=createClient(supabaseUrl,adminKey,{auth:{persistSession:false,autoRefreshToken:false}});

    const token=clean(req.headers.get('Authorization'),4000).replace(/^Bearer\s+/i,'');
    if(!token)return response({error:'Sesión no válida.'},401);
    const {data:userData,error:userError}=await admin.auth.getUser(token);
    if(userError||!userData?.user)return response({error:'Sesión no válida.'},401);

    const {data:profile,error:profileError}=await admin.from('app_users')
      .select('user_id,data_owner_id,role,active,permissions,full_name,email')
      .eq('user_id',userData.user.id).maybeSingle();
    if(profileError)throw profileError;
    if(!profile?.active)return response({error:'Tu acceso está desactivado.'},403);

    const {data:workspace,error:workspaceError}=await admin.from('workspaces')
      .select('id,name,status').eq('id',profile.data_owner_id).maybeSingle();
    if(workspaceError)throw workspaceError;
    if(!workspace||!['active','trialing'].includes(String(workspace.status)))return response({error:'El acceso de tu empresa está suspendido.'},403);

    const body=await req.json().catch(()=>({}));
    const message=clean(body?.message,4000);
    if(!message)return response({error:'Escribe una pregunta para ZENVIA IA.'},400);
    const allowedPages=authorizedPages(profile,body?.allowedPages);
    const ui=body?.context&&typeof body.context==='object'&&!Array.isArray(body.context)?body.context:{};
    const currentPage=clean(ui?.currentPage,50)||'dashboard';
    const {data:preferenceRow,error:preferenceError}=await admin.from('user_preferences')
      .select('preferences').eq('user_id',profile.user_id).maybeSingle();
    if(preferenceError)throw preferenceError;
    const periods=resolveAgentPeriods(preferenceRow?.preferences||{},currentPage);
    const businessContext=await loadBusinessContext(admin,String(profile.data_owner_id),allowedPages,periods);
    const history=sanitizedHistory(body?.history);
    const normalizedMessage=norm(message);
    if(allowedPages.includes('amazon')&&hasAny(normalizedMessage,['amazon','marketplace'])){
      const publicKey=clean(Deno.env.get('SUPABASE_ANON_KEY')||Deno.env.get('SUPABASE_PUBLISHABLE_KEY'),4000);
      if(publicKey){
        const userClient=createClient(supabaseUrl,publicKey,{
          global:{headers:{Authorization:`Bearer ${token}`}},
          auth:{persistSession:false,autoRefreshToken:false},
        });
        (businessContext as any).amazon=await loadAmazonAgentContext(userClient,normalizedMessage);
      }
    }

    return response(processLocalAgent(message,businessContext,allowedPages,ui,history));
  }catch(error){
    return response({error:error instanceof Error?error.message:'Error interno del agente.'},500);
  }
});
