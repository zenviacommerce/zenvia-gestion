import { supabase } from './supabase';

export type AgentActionType=
  |'navigate'
  |'open_expense_upload'
  |'open_product_create'
  |'open_supplier_create'
  |'open_settings'
  |'refresh_data'
  |'sync_orders'
  |'create_client'
  |'create_product'
  |'create_supplier'
  |'set_expense_payment'
  |'create_support_ticket'
  |'sync_amazon'
  |'set_expense_status'
  |'none';

export type AgentActionParams={
  name:string|null;
  taxId:string|null;
  email:string|null;
  phone:string|null;
  city:string|null;
  countryCode:string|null;
  unit:string|null;
  sku:string|null;
  ean:string|null;
  category:string|null;
  price:number|null;
  salePrice:number|null;
  salesTaxRate:number|null;
  supplierType:'unclassified'|'goods'|'service'|'both'|null;
  invoiceId:string|null;
  status:'pending'|'reviewed'|'accounted'|null;
  paymentStatus:'paid'|'unpaid'|null;subject:string|null;description:string|null;
};

export type AgentAction={
  type:AgentActionType;
  target:string|null;
  params:AgentActionParams;
};

export type AgentReply={
  answer:string;
  action:AgentAction;
  model?:string;
};

export type AgentMessage={role:'user'|'assistant';content:string};

const emptyParams:AgentActionParams={
  name:null,taxId:null,email:null,phone:null,city:null,countryCode:null,unit:null,sku:null,ean:null,category:null,
  price:null,salePrice:null,salesTaxRate:null,supplierType:null,invoiceId:null,status:null,paymentStatus:null,subject:null,description:null,
};

export async function askAppAgent(input:{
  message:string;
  history:AgentMessage[];
  allowedPages:string[];
  context:Record<string,unknown>;
}):Promise<AgentReply>{
  const {data,error}=await supabase.functions.invoke('app-agent',{body:input});
  if(error){
    let detail='';
    const context=(error as any)?.context;
    if(context instanceof Response){
      try{
        const payload=await context.clone().json();
        detail=String(payload?.error||'').trim();
      }catch{}
    }
    throw new Error(detail||error.message||'No se pudo consultar ZENVIA IA.');
  }
  if(!data||data.error)throw new Error(String(data?.error||'No se pudo consultar ZENVIA IA.'));
  const rawParams=data.action?.params&&typeof data.action.params==='object'?data.action.params:{};
  return {
    answer:String(data.answer||''),
    action:{
      type:(data.action?.type||'none') as AgentActionType,
      target:data.action?.target==null?null:String(data.action.target),
      params:{...emptyParams,...rawParams},
    },
    model:data.model?String(data.model):undefined,
  };
}

export async function authorizeAppAgentAction(type:string,params:Record<string,unknown>){
  const args=Object.fromEntries(Object.entries(params).filter(([,value])=>value!=null));
  const {data,error}=await supabase.functions.invoke('app-agent-tools',{body:{type,args,confirmed:true}});
  if(error||!data?.ok)throw new Error(String(data?.error||error?.message||'La acción no está autorizada.'));
}
