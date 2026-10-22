import {it,expect} from 'vitest';
import {runMrwDiagnostic} from '../supabase/functions/_shared/tracking/mrwDiagnostic';
function fixture(){
 const tables:any={integration_accounts:[{id:'account',owner_id:'owner',provider:'mrw',enabled:true,status:'active',secret_id:'vault'}],workspaces:[{id:'owner',status:'active'}],fulfillment_orders:[{id:'a',owner_id:'owner',shipping_integration_account_id:'account',shipping_provider:'mrw',tracking_number:'01009F045714',tracking_status_code:null,pii_purged_at:null,label_cancelled_at:null},{id:'b',owner_id:'owner',shipping_integration_account_id:'account',shipping_provider:'mrw',tracking_number:'01009F045715',tracking_status_code:'SHIPPED',pii_purged_at:null,label_cancelled_at:null},{id:'c',owner_id:'owner',shipping_integration_account_id:'account',shipping_provider:'mrw',tracking_number:'TERMINAL',tracking_status_code:'DELIVERED',pii_purged_at:null,label_cancelled_at:null}],shipment_tracking_state:[{order_id:'b',normalized_state:'in_transit',owner_id:'owner',account_id:'account',provider:'mrw'}]};
 const reads:any[]=[];const admin={from(table:string){const predicates:any[]=[],q:any={select:()=>q,eq(k:string,v:any){predicates.push((r:any)=>r[k]===v);return q},neq(k:string,v:any){predicates.push((r:any)=>r[k]!==v);return q},is(k:string,v:any){predicates.push((r:any)=>r[k]===v);return q},not:()=>q,in(k:string,v:any[]){predicates.push((r:any)=>v.includes(r[k]));return q},order:()=>q,limit(n:number){q.cap=n;return q},maybeSingle:async()=>({data:tables[table].filter((r:any)=>predicates.every(p=>p(r)))[0]||null,error:null}),then(resolve:any){reads.push(table);return Promise.resolve({data:tables[table].filter((r:any)=>predicates.every(p=>p(r))).slice(0,q.cap||100),error:null}).then(resolve)}};return q},rpc:async(name:string)=>{reads.push(name);return {data:JSON.stringify({username:'USER-SECRET-SENTINEL',password:'PASSWORD-SECRET-SENTINEL',subscriberCode:'123456',franchiseCode:'01009'}),error:null}}};
 return {admin,tables,reads};
}
const xml='<GetEnviosResponse><GetEnviosResult><MensajeSeguimiento>PASSWORD-SECRET-SENTINEL</MensajeSeguimiento><Seguimiento><Abonado><SeguimientoAbonado><Seguimiento><NumAlbaran>01009F045714</NumAlbaran><Estado>3</Estado><EstadoDescripcion>Entregado USER-SECRET-SENTINEL</EstadoDescripcion><Publicado>2026-10-22T08:00:00Z</Publicado><FechaEntrega>22/10/2026</FechaEntrega><HoraEntrega>10:00</HoraEntrega><Intentos>1</Intentos><PersonaEntrega>PRIVATE RECIPIENT</PersonaEntrega><Referencia>PRIVATE REFERENCE</Referencia></Seguimiento></SeguimientoAbonado></Abonado></Seguimiento></GetEnviosResult></GetEnviosResponse>';
it('runs only read-only bounded MRW SOAP probes and returns a strict sanitized whitelist',async()=>{
 const f=fixture(),requests:any[]=[];const result=await runMrwDiagnostic(f.admin,async(url,init)=>{requests.push({url,init});return new Response(xml)});
 expect(requests).toHaveLength(5);expect(requests.every(r=>r.url==='https://trackingservice.mrw.es/TrackingService.svc/TrackingServices')).toBe(true);
 expect(requests.filter(r=>r.init.body.includes('<tipoInformacion>0</tipoInformacion>'))).toHaveLength(2);
 expect(requests.filter(r=>r.init.body.includes('<tipoInformacion>1</tipoInformacion>'))).toHaveLength(3);
 expect(requests.every(r=>!r.init.body.includes('TERMINAL'))).toBe(true);
 expect(result.results[0]).toMatchObject({httpStatus:200,MensajeSeguimiento:'OK',historyCount:1,shipments:[{NumAlbaran:'01009F045714',Estado:'3',EstadoDescripcion:'Entregado [REDACTED]',Publicado:'2026-10-22T08:00:00Z',FechaEntrega:'22/10/2026',HoraEntrega:'10:00',Intentos:1}]});
 expect(JSON.stringify(result)).not.toMatch(/SECRET-SENTINEL|PRIVATE|PersonaEntrega|Referencia|<GetEnvios/);
 expect(f.reads.every(n=>['integration_accounts','workspaces','fulfillment_orders','shipment_tracking_state','integration_read_secret'].includes(n))).toBe(true);
});
it('fails closed without workspace eligibility or required SAGEC credentials and never sends HTTP',async()=>{
 const f=fixture();f.tables.workspaces[0].status='disabled';let calls=0;const result=await runMrwDiagnostic(f.admin,async()=>{calls++;throw Error('SECRET')});expect(calls).toBe(0);expect(result.code).toBe('MRW_DIAGNOSTIC_UNAVAILABLE');
});
it('contains provider failures without returning SOAP fault content',async()=>{
 const f=fixture();const result=await runMrwDiagnostic(f.admin,async()=>new Response('<Fault>PASSWORD-SECRET-SENTINEL PRIVATE</Fault>',{status:500}));expect(result.results.every(r=>r.httpStatus===500&&r.MensajeSeguimiento==='REJECTED'&&r.FaultCode==='SOAP_FAULT')).toBe(true);expect(JSON.stringify(result)).not.toMatch(/SECRET|PRIVATE/);
});

it('keeps total batch evidence but returns shipment fields only for owned sampled numbers',async()=>{
 const f=fixture();const outside=xml.replace('01009F045714','OUTSIDE-ACCOUNT-NUMBER');
 const result=await runMrwDiagnostic(f.admin,async()=>new Response(xml.replace('</SeguimientoAbonado>',outside.match(/<Seguimiento><NumAlbaran>[\s\S]*?<\/Seguimiento>/)![0]+'</SeguimientoAbonado>')));
 const batch=result.results.find(r=>r.mode==='range');expect(batch.historyCount).toBe(2);expect(batch.matchedHistoryCount).toBe(1);expect(JSON.stringify(result)).not.toContain('OUTSIDE-ACCOUNT-NUMBER');
});
it('batchOnly sends one range containing two adjacent owned numbers and reports only counts for other numbers',async()=>{
 const f=fixture();f.tables.fulfillment_orders[0].tracking_number='01009F045755';f.tables.fulfillment_orders[1].tracking_number='01009F045756';
 const requests:any[]=[];const first=xml.replace('01009F045714','01009F045755');const second=xml.replace('01009F045714','01009F045756');const outside=xml.replace('01009F045714','PRIVATE-OUTSIDE');
 const combined=first.replace('</SeguimientoAbonado>',second.match(/<Seguimiento><NumAlbaran>[\s\S]*?<\/Seguimiento>/)![0]+outside.match(/<Seguimiento><NumAlbaran>[\s\S]*?<\/Seguimiento>/)![0]+'</SeguimientoAbonado>');
 const result=await runMrwDiagnostic(f.admin,async(url,init)=>{requests.push(init);return new Response(combined)},true);
 expect(requests).toHaveLength(1);expect(requests[0].body).toContain('<valorFiltroDesde>01009F045755</valorFiltroDesde><valorFiltroHasta>01009F045756</valorFiltroHasta>');
 expect(result.results[0]).toMatchObject({mode:'range',batchDistinctCount:3,matchedDistinctCount:2,historyCount:3,matchedHistoryCount:2});expect(result.results[0].shipments).toHaveLength(2);expect(JSON.stringify(result)).not.toContain('PRIVATE-OUTSIDE');
});
it('does not query a batch when the owned sample contains no adjacent pair',async()=>{
 const f=fixture();f.tables.fulfillment_orders[1].tracking_number='01009F045799';let calls=0;
 const result=await runMrwDiagnostic(f.admin,async()=>{calls++;return new Response(xml)},true);expect(calls).toBe(0);expect(result.results).toEqual([]);
});
