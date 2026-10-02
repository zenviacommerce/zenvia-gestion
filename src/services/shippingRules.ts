import { supabase } from './supabase';
import type { ShippingRule, ShippingRuleAction, ShippingRuleConditions } from './shippingRuleCore';

export type { ShippingRule, ShippingRuleAction, ShippingRuleConditions } from './shippingRuleCore';

export const DEFAULT_SHIPPING_RULES:Array<Omit<ShippingRule,'id'>>=[];

export function defaultShippingRules():ShippingRule[]{
  return [];
}

const mapRule=(row:any):ShippingRule=>({
  id:row.id,
  name:String(row.name||'Regla de envío'),
  priority:Number(row.priority??100),
  active:Boolean(row.active),
  conditions:(row.conditions||{}) as ShippingRuleConditions,
  action:{
    provider:['sendcloud','envia','mrw'].includes(String(row.action?.provider||''))?String(row.action.provider) as ShippingRuleAction['provider']:null,
    integrationAccountId:row.action?.integrationAccountId?String(row.action.integrationAccountId):null,
    carrierContains:String(row.action?.carrierContains||''),
    serviceIncludes:Array.isArray(row.action?.serviceIncludes)?row.action.serviceIncludes.map(String):[],
  },
});

export async function loadShippingRules(_options:{ensureDefaults?:boolean}={}):Promise<ShippingRule[]>{
  const {data,error}=await supabase.from('shipping_rules').select('*').order('priority').order('name');
  if(error)throw error;
  return (data??[]).map(mapRule);
}

export async function addShippingRule(input:Omit<ShippingRule,'id'>){
  const {data,error}=await supabase.from('shipping_rules').insert({
    name:input.name.trim(),
    priority:input.priority,
    active:input.active,
    conditions:input.conditions,
    action:input.action,
  }).select('id').single();
  if(error)throw error;
  return data.id as string;
}

export async function updateShippingRule(id:string,input:Omit<ShippingRule,'id'>){
  const {error}=await supabase.from('shipping_rules').update({
    name:input.name.trim(),
    priority:input.priority,
    active:input.active,
    conditions:input.conditions,
    action:input.action,
  }).eq('id',id);
  if(error)throw error;
}

export async function deleteShippingRule(id:string){
  const {error}=await supabase.from('shipping_rules').delete().eq('id',id);
  if(error)throw error;
}
