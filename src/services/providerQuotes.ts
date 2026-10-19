export type QuoteProvider='sendcloud'|'envia'|'mrw';
export type ProviderQuote<T>={state:'loading'|'ready'|'partial'|'error'|'not_applicable';options:T[];message:string;diagnostics?:string[];retryable?:boolean};
export type ProviderQuotes<T>=Partial<Record<QuoteProvider,ProviderQuote<T>>>;
type Reply<T>={configured?:boolean;options:T[];message?:string|null;diagnostics?:unknown[]};
function quoteIssue(value:any){
 const message=typeof value==='string'?value:String(value?.message||value||'');
 const normalized=message.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 const status=Number(value?.status||value?.statusCode||0);
 if(status>=500&&status<=599||/\bhttp\s*[:(]?\s*5\d\d\b|\(5\d\d\)|(?:mrw|sendcloud|envia.com).{0,16}\b5\d\d\b|timeout|time.?out|tiempo.*agotad/.test(normalized)||value?.name==='TimeoutError')return 'transient';
 if(/sin cobertura|no (?:hay|tiene|existe).*cobertura|solo.*(?:partir|origen)|no coverage|origin.*not supported|origin.*not covered/.test(normalized))return 'not_applicable';
 return 'configuration';
}
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
   const issues=(reply.diagnostics||[]).map((d:any)=>({kind:quoteIssue(d),message:typeof d==='string'?d:[d.account,d.carrier,d.message].filter(Boolean).join(' · ')}));
   const routes=issues.filter(i=>i.kind==='not_applicable').length,temporary=issues.filter(i=>i.kind==='transient').length,configuration=issues.length-routes-temporary;
   const diagnostics=issues.map(i=>i.kind==='not_applicable'?`No aplica a esta ruta · ${i.message}`:i.message);
   const summary=[routes?`${routes} transportista${routes===1?' no aplicable':'s no aplicables'} a esta ruta.`:'',temporary?`${temporary} error${temporary===1?' temporal':'es temporales'}.`:'',configuration?`${configuration} cotización${configuration===1?' requiere':'es requieren'} revisar la configuración.`:''].filter(Boolean).join(' ');
   states[provider]={state:temporary||configuration?(reply.options.length?'partial':'error'):reply.configured===false||!reply.options.length?'not_applicable':'ready',options:reply.options,message:summary||reply.message||(!reply.options.length?'No hay servicios para este envío.':''),diagnostics,retryable:temporary>0};
  }catch(error){states[provider]={state:'error',options:[],message:error instanceof Error?error.message:String(error),retryable:quoteIssue(error)==='transient'}}
  // A completed provider publishes only its own state. Other providers may
  // already have been retried independently while this request was pending.
  finally{clearTimeout(timer);onUpdate({[provider]:states[provider]})}
 }));
 return states;
}
