type Job={id:string;status:string};
type Options={load:(ids:string[])=>Promise<Job[]>;now?:()=>number;pause?:(ms:number)=>Promise<void>;timeoutMs?:number};
export async function waitForAmazonJobs(ids:string[],options:Options){
  const requested=[...new Set(ids)];
  if(!requested.length)return;
  const now=options.now||Date.now;
  const pause=options.pause||(ms=>new Promise<void>(resolve=>setTimeout(resolve,ms)));
  const deadline=now()+(options.timeoutMs??360000);
  while(true){
    const jobs=await options.load(requested);
    if(requested.some(id=>!jobs.some(job=>job.id===id)))throw new Error('No se pudo comprobar el estado de todos los trabajos de Amazon.');
    if(jobs.some(job=>requested.includes(job.id)&&job.status==='failed'))throw new Error('La sincronización de pedidos de Amazon ha fallado. Reintenta la sincronización.');
    if(requested.every(id=>jobs.find(job=>job.id===id)?.status==='success'))return;
    if(now()>=deadline)throw new Error('La sincronización de Amazon sigue en curso. El listado se actualizará cuando termine.');
    await pause(2000);
  }
}
