import {AuthRetryableFetchError} from '@supabase/supabase-js';

/** Only GoTrue endpoints have a 6-second transport deadline. Storage and RPCs are untouched. */
export const AUTH_FETCH_TIMEOUT_MS=6_000;
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
  try{
    const response=await fetch(input,{...init,signal:controller.signal});
    // auth-js 2.105.0 treats HTTP 500 as AuthApiError and removes the session
    // on refresh. A server outage must reach its retryable transport-error path.
    if(response.status>=500&&response.status<=599)
      throw new AuthRetryableFetchError(`Auth service temporarily unavailable (HTTP ${response.status})`,response.status);
    return response;
  }
  finally{clearTimeout(timer);upstream?.removeEventListener('abort',onAbort);}
};
