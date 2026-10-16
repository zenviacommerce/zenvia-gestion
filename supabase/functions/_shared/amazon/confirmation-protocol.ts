// The database owns submission authorization. This module never rearms it.
type Operation={state:'pending_verification'|'confirmed'|'rejected'|'needs_review';send:boolean;verify:boolean;payload:any;revision?:number;[key:string]:any};
export type ConfirmationStore={begin:(intent:any)=>Promise<Operation>;authorizePost:(operation:Operation)=>Promise<boolean>;finish:(operation:Operation,state:string,message?:string,status?:number)=>Promise<Operation>};
type Effects={read:()=>Promise<any[]>;post:(payload:any)=>Promise<unknown>};
const clean=(value:unknown)=>String(value??'').trim();
function exactPackage(packages:any[],expected:any){
 const items=(value:any)=>Array.isArray(value)?value.map((i:any)=>`${clean(i.orderItemId)}:${Number(i.quantity)}`).sort().join('|'):null;
 return packages.some(p=>clean(p.packageReferenceId)===clean(expected.packageReferenceId)&&!!clean(expected.packageReferenceId)&&clean(p.trackingNumber)===clean(expected.trackingNumber)&&clean(p.carrier).toLowerCase()===clean(expected.carrierCode==='Other'?expected.carrierName:expected.carrierCode).toLowerCase()&&['SHIPPED','IN_TRANSIT','DELIVERED'].includes(p.packageStatus?.status)&&items(p.packageItems)!==null&&items(p.packageItems)===items(expected.orderItems));
}
export async function executeAmazonConfirmation(store:ConfirmationStore,intent:any,effects:Effects):Promise<Operation>{
 const operation=await store.begin(intent);
 if(!operation.send&&!operation.verify)return operation;
 let posted=false;
 const pending=async(message:string,status?:number):Promise<Operation>=>{
  // A failed outcome write must not erase the pre-send pending state or trigger a resend.
  try{return await store.finish(operation,'pending_verification',message,status)}catch{return {...operation,state:'pending_verification',send:false,verify:false,message:'Verificando confirmación en Amazon'};}
 };
 try{
  const packages=await effects.read();
  if(!Array.isArray(packages))throw new Error('Amazon no devolvió evidencia completa de paquetes');
  if(exactPackage(packages,operation.payload.packageDetail))return await store.finish(operation,'confirmed');
  if(!operation.send){
   if(packages.length)return await store.finish(operation,'needs_review','Los paquetes no prueban la confirmación exacta');
   return await pending('Amazon todavía no muestra el paquete; no se reenvía la confirmación');
  }
  if(packages.length&&!(Number(operation.revision)>1))return await store.finish(operation,'needs_review','Existe un paquete distinto; requiere revisión antes de modificar Amazon');
  if(!await store.authorizePost(operation))return await pending('El propietario del envío ha cambiado; solo se verificará');
  posted=true;
  await effects.post(operation.payload);
  return await store.finish(operation,'confirmed',undefined,200);
 }catch(error){
  const status=Number((error as any)?.status)||undefined;
  // Only definitive POST rejection is terminal. Read errors and uncertain responses stay pending.
  if(posted&&status&&[400,401,403,404,422].includes(status)){
   try{return await store.finish(operation,'rejected','Amazon rechazó la confirmación; revisa los datos',status)}catch{/* pending already durable */}
  }
  return await pending('Verificando confirmación en Amazon',status);
 }
}
