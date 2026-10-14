// Coalesce carousel/list reads and protect the database from parallel period scans.
export function createAmazonReadQueue(maxConcurrent=2,ttlMs=60_000){
  let active=0,generation=0;
  const waiting:Array<()=>void>=[];
  const requests=new Map<string,Promise<unknown>>();
  const cached=new Map<string,{value:unknown;until:number}>();
  const acquire=()=>new Promise<void>(resolve=>{
    const start=()=>{active++;resolve();};
    if(active<maxConcurrent)start();else waiting.push(start);
  });
  const release=()=>{active--;waiting.shift()?.();};
  return {
    clear(){generation++;cached.clear();requests.clear();},
    read<T>(key:string,load:()=>Promise<T>):Promise<T>{
      const fullKey=`${generation}:${key}`;
      const entry=cached.get(fullKey);
      if(entry&&entry.until>Date.now())return Promise.resolve(entry.value as T);
      const pending=requests.get(fullKey);
      if(pending)return pending as Promise<T>;
      const currentGeneration=generation;
      const request=(async()=>{
        await acquire();
        try{
          if(generation!==currentGeneration)throw new Error('La consulta ha sido sustituida por una actualización más reciente.');
          const value=await load();
          if(generation===currentGeneration){
            if(cached.size>=100)cached.delete(cached.keys().next().value!);
            cached.set(fullKey,{value,until:Date.now()+ttlMs});
          }
          return value;
        }finally{release();requests.delete(fullKey);}
      })();
      requests.set(fullKey,request);
      return request;
    },
  };
}
