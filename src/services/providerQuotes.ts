export type QuoteProvider='sendcloud'|'envia'|'mrw';
export type ProviderQuote<T>={state:'loading'|'ready'|'partial'|'error'|'not_applicable';options:T[];message:string;diagnostics?:string[]};
export type ProviderQuotes<T>=Partial<Record<QuoteProvider,ProviderQuote<T>>>;
type Reply<T>={configured?:boolean;options:T[];message?:string|null;diagnostics?:unknown[]};
export async function collectProviderQuotes<T>(requests:Partial<Record<QuoteProvider,(signal:AbortSignal)=>Promise<Reply<T>>>>,onUpdate:(states:ProviderQuotes<T>)=>void,timeoutMs=20000):Promise<ProviderQuotes<T>>{
 const states:ProviderQuotes<T>={};
 const publish=()=>onUpdate({...states});
 for(const provider of Object.keys(requests) as QuoteProvider[])states[provider]={state:'loading',options:[],message:''};
 publish();
 await Promise.all((Object.keys(requests) as QuoteProvider[]).map(async provider=>{
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  try{
   const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{reject(Error('Tiempo de espera agotado. Reintenta este proveedor.'));controller.abort()},timeoutMs)});
   const reply=await Promise.race([requests[provider]!(controller.signal),deadline]);
   const diagnostics=(reply.diagnostics||[]).map((d:any)=>typeof d==='string'?d:[d.account,d.carrier,d.message].filter(Boolean).join(' · '));
   states[provider]={state:diagnostics.length?(reply.options.length?'partial':'error'):reply.configured===false||!reply.options.length?'not_applicable':'ready',options:reply.options,message:reply.message||(!reply.options.length?'No hay servicios para este envío.':''),diagnostics};
  }catch(error){states[provider]={state:'error',options:[],message:error instanceof Error?error.message:String(error)}}
  // A completed provider publishes only its own state. Other providers may
  // already have been retried independently while this request was pending.
  finally{clearTimeout(timer);onUpdate({[provider]:states[provider]})}
 }));
 return states;
}
