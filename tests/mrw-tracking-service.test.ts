import {expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {parseMrw,pollShipment} from '../supabase/functions/_shared/tracking/adapters';
import {normalizeStatus,reduceMovement} from '../supabase/functions/_shared/tracking/policy';
const history=readFileSync('tests/fixtures/mrw-tracking-service/history.xml','utf8');
const response=(fields:string)=>`<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><GetEnviosResponse xmlns="http://tempuri.org/"><GetEnviosResult><Seguimiento><Abonado><SeguimientoAbonado><Seguimiento><NumAlbaran>TEST-T1</NumAlbaran>${fields}</Seguimiento></SeguimientoAbonado></Abonado></Seguimiento></GetEnviosResult></GetEnviosResponse></s:Body></s:Envelope>`;
it('uses the WSDL SOAP 1.1 GetEnvios endpoint with the same escaped SAGEC username/password',async()=>{
 const request=vi.fn(async()=>new Response(history));
 const event=await pollShipment({provider:'mrw'},{username:'sagec<&user',password:'sagec<&pass',trackingPassword:'MUST-NOT-BE-USED'},'TEST-T1',request);
 expect(event.state).toBe('delivered');
 const [url,opts]=request.mock.calls[0] as unknown as [string,RequestInit];expect(url).toBe('https://trackingservice.mrw.es/TrackingService.svc/TrackingServices');
 expect(opts.headers).toEqual({'Content-Type':'text/xml; charset=utf-8',SOAPAction:'"http://tempuri.org/ITrackingService/GetEnvios"'});
 expect(opts.body).toContain('<GetEnvios xmlns="http://tempuri.org/">');expect(opts.body).toContain('<login>sagec&lt;&amp;user</login><pass>sagec&lt;&amp;pass</pass>');
 for(const field of ['<codigoIdioma>3082</codigoIdioma>','<tipoFiltro>0</tipoFiltro>','<valorFiltroDesde>TEST-T1</valorFiltroDesde>','<valorFiltroHasta></valorFiltroHasta>','<fechaDesde></fechaDesde>','<fechaHasta></fechaHasta>','<tipoInformacion>1</tipoInformacion>'])expect(opts.body).toContain(field);
 expect(opts.body).not.toContain('MUST-NOT-BE-USED');expect(opts.redirect).toBe('error');
});
it('requires username/password before HTTP and never substitutes a tracking-only password',async()=>{
 for(const credentials of [{password:'test'},{username:'test',trackingPassword:'old'},{username:'test',password:' '}]){const request=vi.fn();await expect(pollShipment({provider:'mrw'},credentials,'TEST-T1',request)).rejects.toThrow('MRW_CREDENTIALS_REQUIRED');expect(request).not.toHaveBeenCalled()}
});
it('parses nested local names, selects the newest exact NumAlbaran, and never returns recipient/account/reference data',()=>{
 const event=parseMrw(history,'TEST-T1');expect(event).toMatchObject({state:'delivered',code:'00',eventAt:'2026-10-21T10:35:00.000Z'});expect(JSON.stringify(event)).not.toContain('PRIVATE');expect(()=>parseMrw(history,'TEST')).toThrow('TRACKING_RESPONSE_MISMATCH');
});
it('uses code 00 as delivered even with attempts and an unfamiliar description',()=>{
 expect(normalizeStatus('mrw','00','text unfamiliar')).toBe('delivered');expect(parseMrw(response('<Estado>00</Estado><EstadoDescripcion>Desconocido</EstadoDescripcion><Intentos>3</Intentos>'),'TEST-T1').state).toBe('delivered');
});
it('uses positive attempts as exception unless delivered and keeps unknown states explicit',()=>{
 expect(parseMrw(response('<Estado>42</Estado><EstadoDescripcion>EN REPARTO</EstadoDescripcion><Intentos>1</Intentos>'),'TEST-T1').state).toBe('exception');
 const event=parseMrw(response('<Estado>87</Estado><EstadoDescripcion>Unmapped state</EstadoDescripcion>'),'TEST-T1');expect(event).toMatchObject({state:null,code:'87',warningCode:'MRW_UNKNOWN_STATUS_87'});
 expect(parseMrw(response('<Estado>PRIVATE TRACKING OR PASSWORD</Estado>'),'TEST-T1')).toMatchObject({state:null,code:'UNKNOWN',warningCode:'MRW_UNKNOWN_STATUS_UNKNOWN'});
 expect(reduceMovement({state:'in_transit',code:'known',message:'known',eventAt:null},event,'2026-10-22T10:00:00Z').state).toBe('in_transit');
});
it.each([['21102026','1230','2026-10-21T10:30:00.000Z'],['21122026','1230','2026-12-21T11:30:00.000Z']])('uses Madrid delivery civil time only when Publicado has no timezone', (day,hour,expected)=>{
 expect(parseMrw(response(`<Estado>00</Estado><FechaEntrega>${day}</FechaEntrega><HoraEntrega>${hour}</HoraEntrega><Publicado>2026-10-21T12:00:00</Publicado>`),'TEST-T1').eventAt).toBe(expected);
});
it('does not invent dates from invalid provider civil times',()=>{
 for(const [day,hour] of [['32102026','1230'],['21022026','2500'],['29032026','0230'],['25102026','0230']])expect(parseMrw(response(`<Estado>00</Estado><FechaEntrega>${day}</FechaEntrega><HoraEntrega>${hour}</HoraEntrega>`),'TEST-T1').eventAt).toBeNull();
});
it('handles SOAP denial/fault/malformed XML without leaking provider text',()=>{
 expect(()=>parseMrw('<s:Envelope xmlns:s="x"><s:Fault><faultstring>PRIVATE</faultstring></s:Fault></s:Envelope>','TEST-T1')).toThrow('MRW_TRACKING_REJECTED');
 expect(()=>parseMrw('<GetEnviosResponse><GetEnviosResult><MensajeSeguimiento>Error de acceso PRIVATE</MensajeSeguimiento></GetEnviosResult></GetEnviosResponse>','TEST-T1')).toThrow('MRW_TRACKING_ACCESS_DENIED');
 expect(()=>parseMrw('<invalid>','TEST-T1')).toThrow('TRACKING_INVALID_XML');
});
it.each([false,true])('records unknown history codes even with a known latest state without PII (%s)',async(unknownOlder)=>{
 const {runTrackingWorker}=await import('../supabase/functions/_shared/tracking/worker');
 const health:any[]=[],finished:any[]=[];
 const admin:any={from(table:string){const q:any={select:()=>q,eq:()=>q,neq:()=>q,single:()=>q,insert:()=>q,update:()=>q,upsert:(item:any)=>{if(table==='shipment_tracking_account_health')health.push(item);return q},then:(ok:any)=>Promise.resolve({error:null,data:table==='shipment_tracking_settings'?{enabled:true,mode:'active'}:table==='integration_accounts'?{id:'ACCOUNT',owner_id:'OWNER',provider:'mrw',secret_id:'SECRET'}:null}).then(ok)};return q},rpc:async(name:string,args:any)=>({error:null,data:name==='tracking_claim'?[{order_id:'ORDER',owner_id:'OWNER',account_id:'ACCOUNT',provider:'mrw',tracking_number:'TEST-T1',identity_key:'IDENTITY',label_created_at:'2026-10-20',failures:0,normalized_state:'in_transit',raw_code:'known',raw_message:'Known',observed_at:'2026-10-20T10:00:00Z'}]:name==='integration_read_secret'?JSON.stringify({username:'PRIVATE USER',password:'PRIVATE PASSWORD'}):name==='tracking_finish'?(finished.push(args),true):0})};
 const warning=vi.spyOn(console,'warn').mockImplementation(()=>{}),info=vi.spyOn(console,'info').mockImplementation(()=>{});
 try{
 await runTrackingWorker(admin,async()=>new Response(unknownOlder?history.replace('<a:Estado>42</a:Estado>','<a:Estado>87</a:Estado>').replace('EN REPARTO','Unmapped'):response('<Estado>87</Estado><EstadoDescripcion>Unmapped</EstadoDescripcion><Publicado>2026-10-21T10:00:00Z</Publicado>')));
 expect(health[0].last_error).toBe('MRW_UNKNOWN_STATUS_87');expect(health[0].paused_until).toBeNull();expect(finished[0]).toMatchObject({p_error:'MRW_UNKNOWN_STATUS_87',p_event:unknownOlder?{state:'delivered',code:'00',eventAt:'2026-10-21T10:35:00.000Z'}:{state:'in_transit',code:'87',eventAt:'2026-10-21T10:00:00.000Z'}});
 expect(warning).toHaveBeenCalled();const logs=JSON.stringify(warning.mock.calls);expect(logs).not.toContain('TEST-T1');expect(logs).not.toContain('PRIVATE');expect(logs).not.toContain('<');
 }finally{warning.mockRestore();info.mockRestore()}
});
it('returns bounded chronological exact-shipment history and retains it when an older observation cannot replace current state',()=>{
 const event=parseMrw(history,'TEST-T1');expect(event.history).toHaveLength(2);expect(event.history?.map(row=>row.code)).toEqual(['42','00']);expect(JSON.stringify(event.history)).not.toContain('PRIVATE');
 const previous={state:'delivered' as const,code:'00',message:'Delivered',eventAt:'2026-10-22T10:00:00Z'};
 expect(reduceMovement(previous,event,'2026-10-22T11:00:00Z')).toMatchObject({...previous,history:event.history});
 const rows=Array.from({length:220},(_,i)=>`<Seguimiento><NumAlbaran>TEST-T1</NumAlbaran><Estado>00</Estado><Publicado>${new Date(Date.UTC(2026,9,20,0,i)).toISOString()}</Publicado></Seguimiento>`).join('');
 const batch=parseMrw(`<GetEnviosResult><Seguimiento><Abonado><SeguimientoAbonado>${rows}</SeguimientoAbonado></Abonado></Seguimiento></GetEnviosResult>`,'TEST-T1');expect(batch.history).toHaveLength(200);expect(batch.history?.[0].eventAt).toBe('2026-10-20T00:20:00.000Z');expect(batch.eventAt).toBe('2026-10-20T03:39:00.000Z');
});
it.each(['userName','usuario'])('uses SAGEC %s username aliases with the same password',async(alias)=>{
 const request=vi.fn(async()=>new Response(history));await pollShipment({provider:'mrw'},{[alias]:'existing-sagec-user',password:'existing-sagec-pass'},'TEST-T1',request);
 expect(String((request.mock.calls[0] as unknown as [string,RequestInit])[1].body)).toContain('<login>existing-sagec-user</login><pass>existing-sagec-pass</pass>');
});
it.each([
 ['00','Envío entregado','delivered'],['16','Envío en reparto','out_for_delivery'],['79','Paso por plataforma','in_transit'],
 ['57','Salida de franquicia de origen a plataforma','in_transit'],['17','Envío recogido en origen','in_transit'],
 ['47','Pendiente de recoger','pre_transit'],['48','Pendiente de recoger','pre_transit'],
])('normalizes observed TrackingService code %s with Spanish history description', (code,description,state)=>{
 expect(normalizeStatus('mrw',code,description)).toBe(state);expect(normalizeStatus('mrw',code,'')).toBe(state);
 expect(parseMrw(response(`<Estado>${code}</Estado><EstadoDescripcion>${description}</EstadoDescripcion><Intentos>0</Intentos>`),'TEST-T1')).toMatchObject({state,code});
});
it.each([
 ['33','Entrega concertada','in_transit'],
 ['33','Concertada próxima entrega','in_transit'],
 ['35','Entrega aplazada pendiente de cobro o cita previa','exception'],
 ['59','Llegada a franquicia destino','in_transit'],
 ['72','Recogido en plataforma','in_transit'],
 ['91','Pendiente de recibir en destino','in_transit'],
])('normalizes requested MRW code %s while retaining provider description %s',(code,description,state)=>{
 expect(normalizeStatus('mrw',code,'')).toBe(state);
 const event=parseMrw(response(`<Estado>${code}</Estado><EstadoDescripcion>${description}</EstadoDescripcion><Intentos>0</Intentos>`),'TEST-T1');
 expect(event).toMatchObject({state,code,message:description});expect(event.warningCode).toBeUndefined();
 expect(event.history?.[0]).toMatchObject({state,code,message:description});
});
it.each(['33','59','72','91'])('keeps positive delivery attempts as an exception for MRW transit code %s',(code)=>{
 expect(parseMrw(response(`<Estado>${code}</Estado><EstadoDescripcion>Movimiento confirmado</EstadoDescripcion><Intentos>1</Intentos>`),'TEST-T1').state).toBe('exception');
});
