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
async function loadBusinessContext(admin:any,ownerId:string,allowedPages:string[]){
  const can=(page:string)=>allowedPages.includes(page);
  const tasks:Record<string,Promise<any>>={};

  if(can('orders')||can('dashboard')){
    tasks.ordersRecent=safeRows(admin.from('fulfillment_orders')
      .select('id,order_number,source_channel,source_status,customer_name,total_amount,currency,tracking_number,label_created_at,fulfilled_at,order_created_at,carrier_name,shipping_service_name')
      .eq('owner_id',ownerId).order('order_created_at',{ascending:false,nullsFirst:false}).limit(30));
    tasks.ordersTotal=safeCount(admin.from('fulfillment_orders').select('id',{count:'exact',head:true}).eq('owner_id',ownerId));
    tasks.ordersPending=safeCount(admin.from('fulfillment_orders').select('id',{count:'exact',head:true}).eq('owner_id',ownerId).is('fulfilled_at',null).is('label_created_at',null));
  }
  if(can('invoices')||can('dashboard')){
    tasks.expensesRecent=safeRows(admin.from('invoices')
      .select('id,invoice_number,supplier_id,issue_date,received_date,total_amount,net_amount,tax_amount,status')
      .eq('owner_id',ownerId).order('issue_date',{ascending:false,nullsFirst:false}).limit(30));
    tasks.expensesTotal=safeCount(admin.from('invoices').select('id',{count:'exact',head:true}).eq('owner_id',ownerId));
    tasks.expensesPending=safeCount(admin.from('invoices').select('id',{count:'exact',head:true}).eq('owner_id',ownerId).eq('status','pending'));
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
    tasks.salesRecent=safeRows(admin.from('sales_invoices')
      .select('id,invoice_number,client_name,status,issue_date,due_date,total_amount,tax_amount,currency')
      .eq('owner_id',ownerId).order('issue_date',{ascending:false,nullsFirst:false}).limit(30));
    tasks.salesTotal=safeCount(admin.from('sales_invoices').select('id',{count:'exact',head:true}).eq('owner_id',ownerId));
    tasks.salesOpen=safeCount(admin.from('sales_invoices').select('id',{count:'exact',head:true}).eq('owner_id',ownerId).in('status',['issued','sent','partially_paid']));
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
  return {
    orders:raw.ordersRecent?{total:raw.ordersTotal,pending:raw.ordersPending,recent:raw.ordersRecent}:undefined,
    expenses:raw.expensesRecent?{total:raw.expensesTotal,pendingReview:raw.expensesPending,recent:raw.expensesRecent}:undefined,
    products:raw.products?{total:raw.productsTotal,withoutCost:raw.productsWithoutCost,items:raw.products}:undefined,
    suppliers:raw.suppliers?{total:raw.suppliersTotal,items:raw.suppliers}:undefined,
    clients:raw.clients?{total:raw.clientsTotal,items:raw.clients}:undefined,
    sales:raw.salesRecent?{total:raw.salesTotal,open:raw.salesOpen,recent:raw.salesRecent}:undefined,
    support:raw.supportRecent?{open:raw.supportOpen,recent:raw.supportRecent}:undefined,
  };
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
function localReply(answer:string,action=localAction()){
  return {ok:true,answer,action,engine:'zenvia-local-v1'};
}
function norm(value:string){
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[¿?¡!.,;:()[\]{}"]/g,' ').replace(/\s+/g,' ').trim();
}
function hasAny(text:string,terms:string[]){return terms.some(term=>text.includes(norm(term)));}
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
  if(allowed.includes('invoices')&&ctx.expenses)parts.push(String(ctx.expenses.pendingReview)+' facturas de gasto pendientes de revisar');
  if(allowed.includes('sales')&&ctx.sales)parts.push(String(ctx.sales.open)+' facturas emitidas abiertas');
  if(allowed.includes('products')&&ctx.products)parts.push(String(ctx.products.withoutCost)+' productos sin coste');
  if(allowed.includes('support')&&ctx.support)parts.push(String(ctx.support.open)+' tickets abiertos');
  return parts.length?'Ahora mismo veo: '+parts.join('; ')+'.':'No veo tareas pendientes en los módulos a los que tienes acceso.';
}
function processLocalAgent(raw:string,ctx:any,allowed:string[],ui:any){
  const text=norm(raw),currentPage=clean(ui?.currentPage,50)||'dashboard';

  if(hasAny(text,['que tengo pendiente','pendientes ahora','resumen pendiente','cosas pendientes']))return localReply(pendingSummary(ctx,allowed));

  if(hasAny(text,['pedidos pendientes','pedido pendiente','sin etiqueta'])&&ctx.orders&&allowed.includes('orders')){
    const recent=(ctx.orders.recent||[]).filter((o:any)=>!o.fulfilled_at&&!o.label_created_at).slice(0,8);
    const detail=recent.length?' Los más recientes: '+recent.map((o:any)=>String(o.order_number||o.id)+' ('+String(o.customer_name||'sin cliente')+')').join(', ')+'.':'';
    return localReply('Tienes '+String(ctx.orders.pending)+' pedidos pendientes de etiqueta.'+detail);
  }
  if(hasAny(text,['ultimos pedidos','pedidos recientes'])&&ctx.orders&&allowed.includes('orders')){
    const rows=(ctx.orders.recent||[]).slice(0,8);
    return localReply(rows.length?'Últimos pedidos:\n'+rows.map((o:any)=>String(o.order_number||o.id)+' · '+String(o.customer_name||'sin cliente')+' · '+euroLocal(o.total_amount,o.currency)).join('\n'):'No hay pedidos recientes.');
  }
  if(hasAny(text,['facturas pendientes','gastos pendientes','facturas de gasto pendientes'])&&ctx.expenses&&allowed.includes('invoices')){
    const rows=(ctx.expenses.recent||[]).filter((i:any)=>i.status==='pending').slice(0,8);
    return localReply('Tienes '+String(ctx.expenses.pendingReview)+' facturas de gasto pendientes de revisar.'+(rows.length?'\n'+rows.map((i:any)=>String(i.invoice_number||'sin número')+' · '+String(i.supplier_name||'proveedor')+' · '+euroLocal(i.total_amount)).join('\n'):''));
  }
  if(hasAny(text,['productos sin coste','sin coste','productos sin precio de coste'])&&ctx.products&&allowed.includes('products')){
    const rows=(ctx.products.items||[]).filter((p:any)=>p.last_cost==null).slice(0,12);
    return localReply(rows.length?'Tienes '+String(ctx.products.withoutCost)+' productos sin coste. Ejemplos: '+rows.map((p:any)=>String(p.name)).join(', ')+'.':'No veo productos activos sin coste.');
  }
  if(hasAny(text,['cuantos clientes','numero de clientes'])&&ctx.clients&&allowed.includes('clients'))return localReply('Tienes '+String(ctx.clients.total)+' clientes activos.');
  if(hasAny(text,['cuantos proveedores','numero de proveedores'])&&ctx.suppliers&&allowed.includes('suppliers'))return localReply('Tienes '+String(ctx.suppliers.total)+' proveedores.');
  if(hasAny(text,['tickets abiertos','ticket abierto','soporte pendiente'])&&ctx.support&&allowed.includes('support'))return localReply('Hay '+String(ctx.support.open)+' tickets de soporte abiertos.');
  if(hasAny(text,['facturas abiertas','facturas por cobrar','facturas emitidas pendientes'])&&ctx.sales&&allowed.includes('sales'))return localReply('Tienes '+String(ctx.sales.open)+' facturas emitidas abiertas.');

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

  if(hasAny(text,['que puedes hacer','para que sirves','ayuda']))return localReply('Puedo consultar datos reales de ZENVIA Gestión, decirte qué tienes pendiente, navegar por la app y ejecutar con confirmación acciones como sincronizar pedidos, crear clientes, productos o proveedores y cambiar el estado de gastos.');
  if(hasAny(text,['que puedo hacer desde aqui','esta pantalla','esta seccion']))return localReply(helpForPage(currentPage));
  if(hasAny(text,['importar factura','importo una factura','subir factura','cargar factura']))return localReply('Puedo abrirte el importador de Gastos. También puedes importar desde Gmail si lo tienes conectado.',localAction('open_expense_upload','invoices'));
  if(hasAny(text,['modo oscuro','tema oscuro','modo claro']))return localReply('El tema se cambia desde el control de apariencia y queda guardado como preferencia de usuario.');
  if(hasAny(text,['sendcloud','envia.com','envia com','transportista','logistica'])&&hasAny(text,['configurar','conectar','integracion','donde']))return localReply('Sendcloud y Envia.com se gestionan en Configuración → Integraciones y pueden convivir.',localAction('open_settings','settings'));

  if(hasAny(text,['llevame','ve a','abre','ir a','quiero ir','muestrame'])){
    const page=pageAlias(text);
    if(page&&!allowed.includes(page))return localReply('No tienes acceso a '+pageTitle(page)+'.');
    if(page==='settings')return localReply('Abro Configuración.',localAction('open_settings','settings'));
    if(page)return localReply('Te llevo a '+pageTitle(page)+'.',localAction('navigate',page));
  }

  return localReply('Esa petición todavía no la interpreto con suficiente seguridad. Prueba con “qué tengo pendiente”, “sincroniza los pedidos”, “crea un proveedor…”, “productos sin coste” o “llévame a Facturación”.');
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
    const businessContext=await loadBusinessContext(admin,String(profile.data_owner_id),allowedPages);

    const ui=body?.context&&typeof body.context==='object'&&!Array.isArray(body.context)?body.context:{};
    return response(processLocalAgent(message,businessContext,allowedPages,ui));
  }catch(error){
    return response({error:error instanceof Error?error.message:'Error interno del agente.'},500);
  }
});
