import type {ProviderQuotes,QuoteProvider} from '../services/providerQuotes';
export function ShippingProviderStatus<T>({states,onRetry}:{states:ProviderQuotes<T>;onRetry:(provider:QuoteProvider)=>void}){
 return <div className="ordersProviderStates" aria-live="polite">{(['sendcloud','envia','mrw'] as QuoteProvider[]).map(provider=>{
  const result=states[provider];
  const name=provider==='envia'?'Envia.com':provider==='mrw'?'MRW directo':'Sendcloud';
  return <div className="ordersQuoteMessage" key={provider}>
   <strong>{name}</strong>
   <span>{!result||result.state==='loading'?'Cargando…':result.state==='error'?`Error · ${result.message}`:result.state==='not_applicable'?`No aplica: ${result.message}`:`${result.options.length} ${result.options.length===1?'opción':'opciones'}${result.message?' · '+result.message:''}`}</span>
   {result?.diagnostics?.length?<span>{result.diagnostics.join(' · ')}</span>:null}
   {(result?.state==='error'||result?.state==='partial')&&result.retryable!==false&&<button type="button" className="secondary" aria-label={`Reintentar ${name}`} onClick={()=>onRetry(provider)}>Reintentar</button>}
  </div>;
 })}</div>;
}
