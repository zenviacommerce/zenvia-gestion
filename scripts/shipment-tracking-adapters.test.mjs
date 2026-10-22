import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';
const out=await build({entryPoints:['supabase/functions/_shared/tracking/adapters.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {parseSendcloud:sc,parseEnvia:envia,parseMrw:mrw,pollShipment}=await import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64'));
test('Sendcloud selects the newest carrier event, ignores claims and uses event_at rather than updated_at',()=>{const e=sc({updated_at:'2026-10-22T10:00:00Z',events:[{event_type:'claim',phase:'delivered',event_at:'2026-10-22T10:00:00Z'},{event_type:'carrier',phase:'in_delivery',exception:'none',description:'On route',event_at:'2026-10-20T10:00:00Z'}]});assert.equal(e.state,'out_for_delivery');assert.equal(e.eventAt,'2026-10-20T10:00:00.000Z');});
test('Sendcloud does not invent movement dates or carrier delivery',()=>{assert.equal(sc({events:[{event_type:'carrier',phase:'delivery_forced'}]}).state,null);assert.equal(sc({events:[{event_type:'carrier',phase:'accepted'}]}).eventAt,null)});
test('Envia correlates the exact requested tracking number and returns the latest history event',()=>{const p={data:[{trackingNumber:'OTHER',status:{id:3,name:'Delivered'}},{trackingNumber:'T1',status:{id:5,name:'Information'},history:[{statusId:2,status:'Shipped',date:'2026-10-19T10:00:00Z'},{statusId:13,status:'Delivered at Origin',date:'2026-10-20T10:00:00Z'}]}]};const e=envia(p,'T1');assert.equal(e.state,'returned');assert.equal(e.eventAt,'2026-10-20T10:00:00.000Z');assert.throws(()=>envia(p,'UNKNOWN'),/TRACKING_RESPONSE_MISMATCH/)});
test('MRW parses only a matching shipment, ignores outer boolean Estado and uses confirmed delivery date',()=>{const xml='<Result><Estado>true</Estado><Envio><Numero>T1</Numero><Estado>99</Estado><EstadoDescripcion>ENTREGADO</EstadoDescripcion><Fecha>20/10/2026</Fecha><FechaEntrega>21/10/2026</FechaEntrega><HoraEntrega>12:30</HoraEntrega></Envio></Result>';const e=mrw(xml,'T1');assert.equal(e.code,'99');assert.equal(e.state,'delivered');assert.equal(e.eventAt,'2026-10-21T10:30:00.000Z');assert.throws(()=>mrw(xml,'OTHER'),/TRACKING_RESPONSE_MISMATCH/)});
test('MRW current status without a movement timestamp stays detected, never label date',()=>{const e=mrw('<Result><Estado>true</Estado><Envio><Numero>T1</Numero><Estado>3</Estado><EstadoDescripcion>EN REPARTO</EstadoDescripcion><Fecha>20/10/2026</Fecha></Envio></Result>','T1');assert.equal(e.state,'out_for_delivery');assert.equal(e.eventAt,null)});
test('actual Envia eventHistory civil timestamps are preserved without inventing a timezone',()=>{const e=envia({data:[{trackingNumber:'T1',status:'Shipped',content:{status_parent_id:2},eventHistory:[{event:'PICKUP',description:'Recogido',date:'2026-10-14 18:30:24'},{event:'DELAY',description:'Movimiento comunicado',date:'2026-10-21 20:16:11'}],createdAt:'2026-10-14 03:57:38'}]},'T1');assert.equal(e.eventAt,null);assert.equal(e.eventTimeRaw,'2026-10-21 20:16:11');assert.equal(e.message,'Movimiento comunicado');assert.equal(e.state,'in_transit')});

test('MRW uses only the separately configured tracking password',async()=>{
 for(const [credentials,expected] of [[{password:'sagec-test-only',trackingPassword:'override-test-only'},'override-test-only'],[{password:'sagec-test-only',trackingPassword:' ',tracking_password:'alias-test-only'},'alias-test-only']]){
  let body='';const e=await pollShipment({provider:'mrw'},{franchiseCode:'TEST',subscriberCode:'TEST',...credentials},'T1',async(_url,options)=>{body=options.body;return new Response('<Result><Estado>true</Estado><Envio><Numero>T1</Numero><Estado>3</Estado><EstadoDescripcion>EN REPARTO</EstadoDescripcion></Envio></Result>')});
  assert.ok(body.includes('<Password>'+expected+'</Password>'));assert.equal(e.state,'out_for_delivery');
 }
});
test('MRW outer access denial cannot create a movement even if a shipment element exists',()=>{
 for(const xml of ['<Result><Estado>false</Estado><Mensaje>Error de acceso al seguimiento de envíos.</Mensaje><Envio><Numero>T1</Numero><Estado>3</Estado></Envio></Result>','<m:Result><m:Estado>false</m:Estado><m:Mensaje>Error de acceso al seguimiento de envíos.</m:Mensaje><m:Envio /></m:Result>'])assert.throws(()=>mrw(xml,'T1'),/MRW_TRACKING_ACCESS_DENIED/);
});

test('MRW never sends a SAGEC password to the tracking endpoint',async()=>{
 for(const credentials of [{password:'sagec-test-only'},{password:'sagec-test-only',trackingPassword:' ',tracking_password:' '}]){
  let calls=0;await assert.rejects(()=>pollShipment({provider:'mrw'},credentials,'T1',async()=>{calls++;throw Error('must not fetch')}),/MRW_TRACKING_PASSWORD_REQUIRED/);assert.equal(calls,0);
 }
});
