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

    const platformUrl=clean(Deno.env.get('PLATFORM_CONTROL_PLANE_URL'),500).replace(/\/$/,'');
    const bridgeToken=clean(Deno.env.get('PLATFORM_BRIDGE_TOKEN'),1000);
    if(!platformUrl||!bridgeToken)return response({error:'El agente IA no está conectado a ZENVIA Platform.',code:'agent_bridge_missing'},503);

    const upstream=await fetch(`${platformUrl}/functions/v1/platform-agent`,{
      method:'POST',
      headers:{'Content-Type':'application/json','x-platform-token':bridgeToken},
      body:JSON.stringify({
        workspaceId:String(profile.data_owner_id),
        message,
        history:Array.isArray(body?.history)?body.history.slice(-10):[],
        context:{
          ui:body?.context&&typeof body.context==='object'&&!Array.isArray(body.context)?body.context:{},
          data:businessContext,
          workspaceName:String(workspace.name||''),
          userName:String(profile.full_name||profile.email||''),
        },
        userRole:String(profile.role||'user'),
        allowedPages,
      }),
    });
    const payload=await upstream.json().catch(()=>({}));
    if(!upstream.ok)return response({error:String(payload?.error||'No se pudo consultar ZENVIA IA.'),code:payload?.code||null},upstream.status);
    return response(payload);
  }catch(error){
    return response({error:error instanceof Error?error.message:'Error interno del agente.'},500);
  }
});
