// Canonical identities and provider codes live here; never infer ownership from
// quote success. An enabled direct account reserves all services of its carrier.
const carriers=[
 {id:'mrw',direct:['mrw'],aliases:['mrw','mrw_es','mrw_urgent','mrw-spain']},
 {id:'correos',direct:['correos'],aliases:['correos','correos_es','correos-spain']},
 {id:'correosexpress',direct:['correosexpress','correos_express','cex'],aliases:['correosexpress','correos_express','correos express','cex','correos-express']},
 {id:'dhl',direct:['dhl'],aliases:['dhl','dhl_express','dhl_parcel']},
 {id:'ups',direct:['ups'],aliases:['ups']},
 {id:'seur',direct:['seur'],aliases:['seur','seur_es']},
 {id:'gls',direct:['gls'],aliases:['gls','gls_es']},
];
const normalize=(s:unknown)=>String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
export function normalizedCarrierId(value:unknown):string|null{
 const key=normalize(value);if(!key)return null;
 // Match specific identities first (Correos Express before Correos).
 for(const carrier of [...carriers].sort((a,b)=>b.id.length-a.id.length)){
  if(carrier.aliases.some(alias=>key===normalize(alias)||key.startsWith(normalize(alias))))return carrier.id;
 }
 return null;
}
export function directCarrierIds(accounts:any[]):Set<string>{
 return new Set(accounts.filter(a=>a.enabled===true&&a.status!=='disabled').flatMap(a=>{
  const carrier=carriers.find(c=>c.direct.some(p=>normalize(p)===normalize(a.provider)));
  return carrier?[carrier.id]:[];
 }));
}
export async function loadDirectCarrierIds(admin:any,ownerId:string){
 const {data,error}=await admin.from('integration_accounts').select('provider,enabled,status').eq('owner_id',ownerId).eq('enabled',true).neq('status','disabled');
 if(error)throw error;return directCarrierIds(data||[]);
}
export function filterAggregatorOptions<T extends {carrierCode?:unknown;carrierName?:unknown}>(options:T[],direct:Set<string>,_aggregator:string):T[]{
 return options.filter(option=>![normalizedCarrierId(option.carrierCode),normalizedCarrierId(option.carrierName)].some(id=>id!==null&&direct.has(id)));
}
