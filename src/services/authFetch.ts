/** Only GoTrue endpoints have a 10-second transport deadline. Storage and RPCs are untouched. */
export const AUTH_FETCH_TIMEOUT_MS=10_000;
export const fetchWithAuthTimeout:typeof fetch=async(input,init)=>{
  const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
  if(!new URL(url,typeof window!=='undefined'?window.location.href:'https://localhost').pathname.startsWith('/auth/v1/'))
    return fetch(input,init);
  const controller=new AbortController();
  const upstream=init?.signal??(input instanceof Request?input.signal:undefined);
  if(upstream?.aborted)controller.abort(upstream.reason);
  const onAbort=()=>controller.abort(upstream?.reason);
  upstream?.addEventListener('abort',onAbort,{once:true});
  const timer=setTimeout(()=>controller.abort(new DOMException('Auth request timed out','TimeoutError')),AUTH_FETCH_TIMEOUT_MS);
  try{return await fetch(input,{...init,signal:controller.signal});}
  finally{clearTimeout(timer);upstream?.removeEventListener('abort',onAbort);}
};
