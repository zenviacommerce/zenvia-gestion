import { supabase } from './supabase';

export type AgentActionType=
  |'navigate'
  |'open_expense_upload'
  |'open_product_create'
  |'open_supplier_create'
  |'open_settings'
  |'none';

export type AgentReply={
  answer:string;
  action:{type:AgentActionType;target:string|null};
  model?:string;
};

export type AgentMessage={role:'user'|'assistant';content:string};

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
  return {
    answer:String(data.answer||''),
    action:{
      type:(data.action?.type||'none') as AgentActionType,
      target:data.action?.target==null?null:String(data.action.target),
    },
    model:data.model?String(data.model):undefined,
  };
}
