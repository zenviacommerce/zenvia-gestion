// @vitest-environment node
import {it,expect,vi,afterEach} from 'vitest';
import {cancelCarrier} from '../supabase/functions/_shared/cancelCarriers';
afterEach(()=>vi.unstubAllGlobals());
const order=(provider:string)=>({owner_id:'owner',shipping_provider:provider,shipping_integration_account_id:'account',sendcloud_parcel_id:123,shipping_remote_id:'OLD-123',tracking_number:'OLD-123',carrier_code:'correos'});
function admin(provider:string,wrongOwner=false){const row={id:'account',owner_id:wrongOwner?'other':'owner',provider,enabled:true,status:'connected',secret_id:'vault',config:{environment:'production'}};return{rpc:async()=>({data:JSON.stringify({publicKey:'fixture',secretKey:'fixture',token:'fixture',franchiseCode:'1',subscriberCode:'2',username:'fixture',password:'fixture'})}),from(){const filters:Array<[string,unknown]>=[];const q:any={select:()=>q,eq:(k:string,v:unknown)=>{filters.push([k,v]);return q},neq:()=>q,maybeSingle:async()=>({data:filters.every(([k,v])=>(row as any)[k]===v)?row:null})};return q}}}
const statuses=[{id:1000,message:'Ready to send'},{id:2000,message:'Cancelled'},{id:2001,message:'Cancelled upstream'},{id:11,message:'Delivered'}];
const parcel=(patch:any={})=>({parcel:{id:123,tracking_number:'OLD-123',status:{id:1000},label:{label_printer:'https://fixture.test/label.pdf'},...patch}});
function sendcloud(response:any,status=200,preflight=parcel()){
 const calls:Array<{url:string;method:string}>=[];vi.stubGlobal('Deno',{env:{get:()=>undefined}});vi.stubGlobal('fetch',vi.fn(async(url:any,init:any={})=>{calls.push({url:String(url),method:init.method||'GET'});return Response.json(String(url).endsWith('/statuses')?statuses:String(url).endsWith('/cancel')?response:preflight,{status:String(url).endsWith('/cancel')?status:200})}));return calls;
}
it('Sendcloud confirms HTTP200/status cancelled and keeps HTTP202 pending',async()=>{
 for(const status of [200,202]){const calls=sendcloud({status:'cancelled'},status);const result=await cancelCarrier(admin('sendcloud'),order('sendcloud'));expect(result.status).toBe(status===200?'confirmed':'pending');expect(calls.filter(c=>c.method==='POST')).toHaveLength(1)}
});
it('Sendcloud refuses an unannounced parcel so cancel can never delete it',async()=>{
 const calls=sendcloud({status:'cancelled'},200,parcel({label:null}));await expect(cancelCarrier(admin('sendcloud'),order('sendcloud'))).rejects.toThrow();expect(calls.filter(c=>c.method==='POST')).toHaveLength(0);
});
it('Sendcloud checks cancellation without issuing another POST and does not treat upstream as final',async()=>{
 for(const [code,expected] of [[2000,'confirmed'],[2001,'pending']] as const){const calls=sendcloud({},200,parcel({status:{id:code}}));expect((await cancelCarrier(admin('sendcloud'),order('sendcloud'),true)).status).toBe(expected);expect(calls.every(c=>c.method==='GET')).toBe(true)}
});
it('does not send a cancellation with a mismatched account owner',async()=>{
 const calls=sendcloud({status:'cancelled'});await expect(cancelCarrier(admin('sendcloud',true),order('sendcloud'))).rejects.toThrow(/cuenta/i);expect(calls).toHaveLength(0);
});
it('Envia accepts the official cancel envelope and refreshes using tracking without re-cancelling',async()=>{
 const calls:string[]=[];vi.stubGlobal('fetch',vi.fn(async(url:any)=>{calls.push(String(url));return Response.json(String(url).includes('generaltrack')?{data:[{trackingNumber:'OLD-123',status:{id:4,name:'Cancelado'}}]}:{meta:'cancel',data:{carrier:'correos',trackingNumber:'OLD-123',balanceReturned:true}})}));
 expect((await cancelCarrier(admin('envia'),order('envia'))).status).toBe('confirmed');calls.length=0;
 expect((await cancelCarrier(admin('envia'),order('envia'),true)).status).toBe('confirmed');expect(calls.some(c=>c.includes('ship/cancel'))).toBe(false);expect(calls.some(c=>c.includes('ship/generaltrack'))).toBe(true);
});
it('MRW only confirms a response for the cancelled reference, and its refresh is a tracking query',async()=>{
 const calls:Array<{url:string;body:string}>=[];vi.stubGlobal('Deno',{env:{get:()=>undefined}});vi.stubGlobal('fetch',vi.fn(async(url:any,init:any)=>{calls.push({url:String(url),body:init.body});return new Response(String(url).includes('TrackingService')?'<s:Envelope xmlns:s="s"><s:Body><GetEnviosResult><Seguimiento><NumAlbaran>OLD-123</NumAlbaran><Estado>99</Estado><EstadoDescripcion>Anulado</EstadoDescripcion></Seguimiento></GetEnviosResult></s:Body></s:Envelope>':'<s:Envelope xmlns:s="s"><s:Body><CancelarEnvioResponse><CancelarEnvioResult><NumeroEnvio>OLD-123</NumeroEnvio></CancelarEnvioResult></CancelarEnvioResponse></s:Body></s:Envelope>')}));
 expect((await cancelCarrier(admin('mrw'),order('mrw'))).status).toBe('confirmed');calls.length=0;
 expect((await cancelCarrier(admin('mrw'),order('mrw'),true)).status).toBe('confirmed');expect(calls).toHaveLength(1);expect(calls[0].body).toContain('<GetEnvios');expect(calls[0].body).not.toContain('<CancelarEnvio');
});
it('refuses a delivered Sendcloud parcel before mutating it',async()=>{
 const calls=sendcloud({status:'cancelled'},200,parcel({status:{id:11}}));await expect(cancelCarrier(admin('sendcloud'),order('sendcloud'))).rejects.toThrow(/red del transportista/);expect(calls.every(c=>c.method==='GET')).toBe(true);
});
it('does not retry a timed-out POST, and reports that the mutation was attempted',async()=>{
 const calls=sendcloud({status:'cancelled'});const original=globalThis.fetch;vi.stubGlobal('fetch',vi.fn(async(...args:Parameters<typeof fetch>)=>{if(String(args[0]).endsWith('/cancel')){calls.push({url:String(args[0]),method:'POST'});throw new DOMException('timed out','TimeoutError')}return original(...args)}));const started=vi.fn();
 await expect(cancelCarrier(admin('sendcloud'),order('sendcloud'),false,started)).rejects.toThrow();expect(started).toHaveBeenCalledTimes(1);expect(calls.filter(c=>c.method==='POST')).toHaveLength(1);
});
it('MRW does not confirm a successful-looking body carried by a failed gateway response',async()=>{
 vi.stubGlobal('Deno',{env:{get:(name:string)=>name==='MRW_GATEWAY_URL'?'https://fixture.test/gateway':name==='MRW_GATEWAY_SECRET'?'fixture':undefined}});
 const xml='<s:Envelope xmlns:s="s"><s:Body><CancelarEnvioResponse><CancelarEnvioResult><NumeroEnvio>OLD-123</NumeroEnvio></CancelarEnvioResult></CancelarEnvioResponse></s:Body></s:Envelope>';
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({status:500,bodyBase64:btoa(xml)})));
 expect((await cancelCarrier(admin('mrw'),order('mrw'))).status).toBe('unknown');
});
