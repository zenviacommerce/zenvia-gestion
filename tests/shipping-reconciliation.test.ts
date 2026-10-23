// @vitest-environment node
import {it,expect} from 'vitest';
import {reconcileShipmentCreation} from '../supabase/functions/_shared/shippingReconciliation';
const attempt={id:'attempt',ownerId:'owner',orderId:'order',accountId:'account',provider:'mrw',reference:'SYNTHETIC-REF',startedAt:'2026-10-23T07:25:00Z',token:'token',context:{},canRelease:true};
function fixture(patch:any={},accountPatch:any={},credentials:any={username:'fixture',password:'fixture',subscriberCode:'s',franchiseCode:'f'}){const calls:any[]=[];const admin={rpc:async(name:string,p:any)=>{calls.push({name,p});return {data:name==='shipping_creation_reconcile_claim'?{...attempt,...patch}:name==='integration_read_secret'?JSON.stringify(credentials):{status:p.p_result==='found'?'recovered':p.p_result==='absent'?'released':'pending',provider:'mrw'},error:null}},from(){const q:any={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{id:'account',owner_id:'owner',provider:'mrw',enabled:true,status:'connected',secret_id:'secret',config:{},...accountPatch},error:null})};return q}};return{admin,calls}}
const result=(number='')=>new Response(`<Envelope><GetEnviosResult><MensajeSeguimiento>Busqueda correcta por Referencia de Envío.</MensajeSeguimiento><Seguimiento>${number?`<Seguimiento><NumAlbaran>${number}</NumAlbaran><Referencia>SYNTHETIC-REF</Referencia><Publicado>2026-10-23T07:25:10Z</Publicado></Seguimiento>`:''}</Seguimiento></GetEnviosResult></Envelope>`);
it('recovers a unique provider identity through guarded SQL without ever creating a shipment',async()=>{const f=fixture();const value=await reconcileShipmentCreation(f.admin,'owner','order',async(_url:any,init:any)=>{expect(init.body).toContain('<GetEnvios ');expect(init.body).not.toContain('TransmEnvio');return result('SYNTHETIC-TRACK')});expect(value.status).toBe('recovered');expect(f.calls.at(-1)).toMatchObject({name:'shipping_creation_resolve',p:{p_id:'attempt',p_token:'token',p_result:'found',p_shipment:{trackingNumber:'SYNTHETIC-TRACK',remoteId:'SYNTHETIC-TRACK'}}})});
it.each([true,false])('releases confirmed absence only when the server grace period permits (canRelease=%s)',async canRelease=>{const f=fixture({canRelease});expect((await reconcileShipmentCreation(f.admin,'owner','order',async()=>result())).status).toBe(canRelease?'released':'pending');expect(f.calls.at(-1).p.p_result).toBe(canRelease?'absent':'unknown')});
it('records unknown after provider failure, preserves the lock, and does not expose error text or credentials',async()=>{const f=fixture();const value=await reconcileShipmentCreation(f.admin,'owner','order',async()=>{throw Error('PRIVATE RECIPIENT fixture-password')});expect(value.status).toBe('pending');expect(f.calls.at(-1).p.p_result).toBe('unknown');expect(JSON.stringify(value)).not.toMatch(/PRIVATE|fixture-password/)});

it('does not query a changed Envia environment even if its token stayed the same',async()=>{const f=fixture({provider:'envia',context:{environment:'production'}},{provider:'envia',config:{environment:'test'}},{token:'fixture-token'});let http=0;const result=await reconcileShipmentCreation(f.admin,'owner','order',async()=>{http++;return Response.json({data:[]})});expect(result.status).toBe('pending');expect(http).toBe(0)});
it('returns already persisted acceptance without reading credentials or calling a carrier',async()=>{
 const f=fixture({alreadyAccepted:true,provider:'mrw',orderId:'order'});let http=0;
 expect(await reconcileShipmentCreation(f.admin,'owner','order',async()=>{http++;throw Error('forbidden')})).toEqual({status:'recovered',provider:'mrw',orderId:'order'});
 expect(http).toBe(0);expect(f.calls).toHaveLength(1);
});
it('merges a stored Sendcloud public key with the environment secret before authenticated lookup',async()=>{
 const before=(globalThis as any).Deno;(globalThis as any).Deno={env:{get:(key:string)=>key==='SENDCLOUD_SECRET_KEY'?'env-secret':undefined}};
 try{const f=fixture({provider:'sendcloud'},{provider:'sendcloud',credential_source:'environment'},{public_key:'stored-public'});let authorization='';
 const r=await reconcileShipmentCreation(f.admin,'owner','order',async(_url:any,options:any)=>{authorization=options.headers.Authorization;return Response.json({data:[]})});
 expect(r.status).toBe('released');expect(authorization).toBe('Basic '+btoa('stored-public:env-secret'));
 }finally{(globalThis as any).Deno=before}
});
