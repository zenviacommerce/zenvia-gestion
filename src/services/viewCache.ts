const PREFIX='zenvia-view-cache:';
const SCOPE_KEY='zenvia-view-cache-scope';

// View keys remain stable within one signed-in workspace. Change the identity
// before rendering another session so legacy and previous-user views cannot leak.
export function ensureViewCacheScope(workspaceId:string|null|undefined,userId:string|null|undefined){
  try{
    const storage=window.sessionStorage;
    const scope=JSON.stringify([workspaceId||null,userId||null]);
    if(storage.getItem(SCOPE_KEY)===scope)return;
    for(let index=storage.length-1;index>=0;index--){
      const key=storage.key(index);
      if(key?.startsWith(PREFIX))storage.removeItem(key);
    }
    storage.setItem(SCOPE_KEY,scope);
  }catch{/* Storage may be disabled; reads and writes already fail safely. */}
}


export function readViewCache<T>(key:string):T|null{
  try{
    const raw=window.sessionStorage.getItem(PREFIX+key);
    if(!raw)return null;
    const parsed=JSON.parse(raw);
    return parsed?.value as T??null;
  }catch{return null;}
}

export function writeViewCache<T>(key:string,value:T){
  try{window.sessionStorage.setItem(PREFIX+key,JSON.stringify({savedAt:Date.now(),value}));}catch{/* cache is best effort */}
}

export function removeViewCache(key:string){
  try{window.sessionStorage.removeItem(PREFIX+key);}catch{/* noop */}
}

export function stableCacheKey(scope:string,input:unknown){
  const normalize=(value:any):any=>{
    if(Array.isArray(value))return value.map(normalize);
    if(value&&typeof value==='object')return Object.keys(value).sort().reduce<Record<string,unknown>>((acc,key)=>{acc[key]=normalize(value[key]);return acc;},{});
    return value;
  };
  return `${scope}:${JSON.stringify(normalize(input))}`;
}
