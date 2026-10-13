/** Keep deliberate login and authentication callbacks separate from the public entry. */
export function shouldShowPresentation(authenticated:boolean,search:string,hash:string){
  if(authenticated)return false;
  const query=new URLSearchParams(search);
  if(query.get('acceso')==='1')return false;
  if(['invite_token','recovery_token','code'].some(key=>query.has(key)))return false;
  if(query.has('shop')&&query.has('hmac'))return false;
  const fragment=new URLSearchParams(hash.replace(/^#/,''));
  return !['access_token','error','type'].some(key=>fragment.has(key));
}
