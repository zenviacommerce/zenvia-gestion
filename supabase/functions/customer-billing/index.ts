import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
};
const jsonHeaders={...corsHeaders,'Content-Type':'application/json'};

function getAdminKey(){
  const secretKeys=Deno.env.get('SUPABASE_SECRET_KEYS');
  if(secretKeys){try{const parsed=JSON.parse(secretKeys);if(parsed?.default)return parsed.default as string;}catch{}}
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
}
function fail(message:string,status=400){return new Response(JSON.stringify({error:message}),{status,headers:jsonHeaders});}
function ok(data:unknown){return new Response(JSON.stringify(data),{headers:jsonHeaders});}
function clean(value:unknown,max=250){return typeof value==='string'?value.trim().slice(0,max):'';}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  if(req.method!=='POST')return fail('Método no permitido.',405);
  try{
    const url=Deno.env.get('SUPABASE_URL')||'';
    const adminKey=getAdminKey();
    if(!url||!adminKey)return fail('Configuración de facturación no disponible.',500);
    const token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'').trim();
    if(!token)return fail('Sesión no válida.',401);

    const admin=createClient(url,adminKey,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:userData,error:userError}=await admin.auth.getUser(token);
    if(userError||!userData.user)return fail('Sesión no válida.',401);

    const {data:caller,error:callerError}=await admin.from('app_users')
      .select('user_id,workspace_id,data_owner_id,role,active')
      .eq('user_id',userData.user.id).maybeSingle();
    if(callerError)throw callerError;
    if(!caller?.active||caller.role!=='admin')return fail('Solo un administrador puede consultar el plan y la facturación.',403);
    const workspaceId=caller.workspace_id||caller.data_owner_id;
    if(!workspaceId)return fail('Workspace no configurado.',403);

    const {data:workspace,error:workspaceError}=await admin.from('workspaces')
      .select('id,status').eq('id',workspaceId).maybeSingle();
    if(workspaceError)throw workspaceError;
    if(!workspace||!['active','trialing','suspended','cancelled'].includes(workspace.status))return fail('La facturación de tu empresa no está disponible.',403);

    const body=await req.json().catch(()=>({}));
    const action=clean(body?.action,80)||'overview';

    if(action==='record_paypal_subscription'){
      const subscriptionId=clean(body?.subscriptionId,180);
      const targetPlanKey=clean(body?.targetPlanKey,80);
      const cycle=clean(body?.cycle,20);
      if(!subscriptionId||!targetPlanKey||!['monthly','yearly'].includes(cycle))return fail('Datos de suscripción incompletos.');
      if(!/^[A-Z0-9-]{5,180}$/i.test(subscriptionId))return fail('Identificador de suscripción PayPal no válido.');

      const [{data:config,error:configError},{data:plan,error:planError}]=await Promise.all([
        admin.from('workspace_billing_config').select('provider,mode,public_client_id').eq('workspace_id',workspaceId).maybeSingle(),
        admin.from('billing_plans').select('plan_key,active,is_public,metadata').eq('plan_key',targetPlanKey).maybeSingle(),
      ]);
      if(configError)throw configError;if(planError)throw planError;
      if(config?.provider!=='paypal'||!config?.mode||!config?.public_client_id)return fail('PayPal todavía no está preparado para tu workspace.');
      if(!plan?.active||!plan?.is_public)return fail('El plan seleccionado ya no está disponible.');
      const providerConfig=plan.metadata?.paypal?.[config.mode]||{};
      const expectedPlanId=cycle==='yearly'?providerConfig.yearly_plan_id:providerConfig.monthly_plan_id;
      if(!expectedPlanId)return fail('El plan todavía no está sincronizado con PayPal.');

      const {error:updateError}=await admin.from('workspace_subscriptions').update({
        billing_provider:'paypal',
        provider_subscription_id:subscriptionId,
        billing_cycle:cycle,
        updated_at:new Date().toISOString(),
      }).eq('workspace_id',workspaceId);
      if(updateError)throw updateError;
      return ok({ok:true,subscriptionId,pendingConfirmation:true});
    }

    if(action!=='overview')return fail('Acción no válida.',404);

    const now=new Date();
    const monthStart=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1)).toISOString();
    const nextMonthStart=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+1,1)).toISOString();

    const [
      {data:plans,error:plansError},
      {data:entitlements,error:entitlementsError},
      {data:subscription,error:subscriptionError},
      {data:billingConfig,error:billingConfigError},
      {count:userCount,error:userCountError},
      {data:amazonAccounts,error:amazonError},
      {count:monthlyOrders,error:ordersError},
    ]=await Promise.all([
      admin.from('billing_plans')
        .select('plan_key,name,description,is_public,active,monthly_price_cents,yearly_price_cents,sort_order,metadata')
        .eq('active',true).order('sort_order',{ascending:true}),
      admin.from('plan_entitlements')
        .select('plan_key,entitlement_key,enabled,limit_value,config')
        .order('entitlement_key',{ascending:true}),
      admin.from('workspace_subscriptions')
        .select('workspace_id,plan_key,status,billing_provider,provider_subscription_id,billing_cycle,trial_ends_at,current_period_ends_at,cancel_at_period_end')
        .eq('workspace_id',workspaceId).maybeSingle(),
      admin.from('workspace_billing_config')
        .select('provider,mode,public_client_id,updated_at').eq('workspace_id',workspaceId).maybeSingle(),
      admin.from('app_users').select('user_id',{count:'exact',head:true}).eq('workspace_id',workspaceId).eq('active',true),
      admin.from('amazon_accounts').select('id,status').eq('owner_id',workspaceId),
      admin.from('fulfillment_orders').select('id',{count:'exact',head:true})
        .eq('owner_id',workspaceId).gte('order_created_at',monthStart).lt('order_created_at',nextMonthStart),
    ]);
    if(plansError)throw plansError;
    if(entitlementsError)throw entitlementsError;
    if(subscriptionError)throw subscriptionError;
    if(billingConfigError)throw billingConfigError;
    if(userCountError)throw userCountError;
    if(amazonError)throw amazonError;
    if(ordersError)throw ordersError;

    return ok({
      plans:plans||[],
      entitlements:entitlements||[],
      subscription:subscription||null,
      billingConfig:billingConfig||null,
      usage:{
        users:Number(userCount||0),
        amazonAccounts:(amazonAccounts||[]).filter((row:any)=>row.status!=='disabled').length,
        monthlyOrders:Number(monthlyOrders||0),
      },
    });
  }catch(error){
    console.error(error);
    return fail(error instanceof Error?error.message:'No se pudo cargar la facturación.',500);
  }
});
