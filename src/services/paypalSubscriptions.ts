import type { BillingCycle, CustomerBillingPlan, CustomerBillingOverview } from './billing';

type PayPalSubscriptionActions={
  subscription:{
    create:(input:{plan_id:string;custom_id?:string;start_time?:string;application_context?:Record<string,unknown>})=>Promise<string>;
    revise:(subscriptionId:string,input:{plan_id:string;application_context?:Record<string,unknown>})=>Promise<string>;
  };
};

type PayPalButtonData={subscriptionID?:string};
type PayPalButtonsOptions={
  style?:Record<string,unknown>;
  createSubscription:(data:unknown,actions:PayPalSubscriptionActions)=>Promise<string>;
  onApprove:(data:PayPalButtonData)=>Promise<void>|void;
  onCancel?:()=>void;
  onError?:(error:unknown)=>void;
};
type PayPalButtonsInstance={
  render:(selector:string|HTMLElement)=>Promise<void>;
  close?:()=>Promise<void>|void;
};
type PayPalNamespace={Buttons:(options:PayPalButtonsOptions)=>PayPalButtonsInstance};

declare global{
  interface Window{paypal?:PayPalNamespace}
}

let loadedKey='';
let loadingPromise:Promise<PayPalNamespace>|null=null;

function sdkKey(clientId:string){
  return clientId.trim();
}

export async function loadPayPalSubscriptionsSdk(clientId:string):Promise<PayPalNamespace>{
  const key=sdkKey(clientId);
  if(!key)throw new Error('PayPal no está configurado para este workspace.');
  if(window.paypal&&loadedKey===key)return window.paypal;
  if(loadingPromise&&loadedKey===key)return loadingPromise;

  const existing=document.querySelector<HTMLScriptElement>('script[data-zenvia-paypal-sdk="subscriptions"]');
  if(existing&&existing.dataset.clientId!==key){
    existing.remove();
    window.paypal=undefined;
  }

  loadedKey=key;
  loadingPromise=new Promise<PayPalNamespace>((resolve,reject)=>{
    if(window.paypal){resolve(window.paypal);return;}
    const script=document.createElement('script');
    script.dataset.zenviaPaypalSdk='subscriptions';
    script.dataset.clientId=key;
    const params=new URLSearchParams({
      'client-id':key,
      components:'buttons',
      vault:'true',
      intent:'subscription',
      currency:'EUR',
    });
    script.src=`https://www.paypal.com/sdk/js?${params.toString()}`;
    script.async=true;
    script.onload=()=>{
      if(window.paypal)resolve(window.paypal);
      else reject(new Error('PayPal se cargó sin exponer el SDK de suscripciones.'));
    };
    script.onerror=()=>reject(new Error('No se pudo cargar PayPal. Comprueba la conexión e inténtalo de nuevo.'));
    document.head.appendChild(script);
  }).catch(error=>{
    loadingPromise=null;
    throw error;
  });
  return loadingPromise;
}

export function paypalPlanId(plan:CustomerBillingPlan,cycle:BillingCycle){
  return cycle==='yearly'?plan.paypalYearlyPlanId:plan.paypalMonthlyPlanId;
}

export function futureTrialStart(overview:CustomerBillingOverview){
  if(overview.subscription.status!=='trialing'||!overview.subscription.trialEndsAt)return undefined;
  const timestamp=Date.parse(overview.subscription.trialEndsAt);
  if(!Number.isFinite(timestamp)||timestamp<=Date.now()+10*60*1000)return undefined;
  return new Date(timestamp).toISOString();
}

export function canRevisePayPalSubscription(overview:CustomerBillingOverview){
  return overview.subscription.billingProvider==='paypal'
    &&Boolean(overview.subscription.providerSubscriptionId)
    &&['active','trialing','past_due'].includes(overview.subscription.status);
}

export function createPayPalButtons(options:{
  paypal:PayPalNamespace;
  container:HTMLElement;
  workspaceId:string;
  targetPlan:CustomerBillingPlan;
  cycle:BillingCycle;
  overview:CustomerBillingOverview;
  onApprove:(subscriptionId:string)=>Promise<void>;
  onCancel?:()=>void;
  onError:(error:unknown)=>void;
}){
  const planId=paypalPlanId(options.targetPlan,options.cycle);
  if(!planId)throw new Error('Este plan todavía no está sincronizado con PayPal.');

  const existingSubscriptionId=canRevisePayPalSubscription(options.overview)
    ?options.overview.subscription.providerSubscriptionId
    :null;
  const startTime=existingSubscriptionId?undefined:futureTrialStart(options.overview);

  const buttons=options.paypal.Buttons({
    style:{layout:'vertical',shape:'rect',label:'subscribe',height:44},
    createSubscription:async(_data,actions)=>{
      const applicationContext={
        user_action:'SUBSCRIBE_NOW',
        shipping_preference:'NO_SHIPPING',
      };
      if(existingSubscriptionId){
        return actions.subscription.revise(existingSubscriptionId,{
          plan_id:planId,
          application_context:applicationContext,
        });
      }
      return actions.subscription.create({
        plan_id:planId,
        custom_id:options.workspaceId,
        ...(startTime?{start_time:startTime}:{}),
        application_context:applicationContext,
      });
    },
    onApprove:async data=>{
      const subscriptionId=String(data?.subscriptionID||existingSubscriptionId||'').trim();
      if(!subscriptionId)throw new Error('PayPal no devolvió el identificador de la suscripción.');
      await options.onApprove(subscriptionId);
    },
    onCancel:options.onCancel,
    onError:options.onError,
  });

  return buttons;
}
