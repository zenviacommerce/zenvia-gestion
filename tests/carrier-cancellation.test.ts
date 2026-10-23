import {it,expect} from 'vitest';
import {parseSendcloudCancellation,parseEnviaCancellation,parseMrwCancellation} from '../supabase/functions/_shared/carrierCancellationPolicy';
it('Sendcloud only confirms an explicit completed cancellation',()=>{
 expect(parseSendcloudCancellation(200,{status:'cancelled'}).status).toBe('confirmed');
 expect(parseSendcloudCancellation(202,{status:'cancelled'}).status).toBe('pending');
 expect(parseSendcloudCancellation(200,{cancelled:true}).status).toBe('pending');
 expect(parseSendcloudCancellation(200,{status:'queued'}).status).toBe('pending');
 expect(parseSendcloudCancellation(200,{status:'rejected'}).status).toBe('rejected');
 expect(parseSendcloudCancellation(200,{message:'not cancelled'}).status).toBe('unknown');
});
it('Envia confirms its documented cancel envelope with matching identity, independently of refund timing',()=>{
 for(const balanceReturned of [true,false])expect(parseEnviaCancellation({meta:'cancel',data:{carrier:'correos',trackingNumber:'OLD-123',balanceReturned}},'OLD-123','correos').status).toBe('confirmed');
 expect(parseEnviaCancellation({meta:'cancel',data:[{carrier:'correos',trackingNumber:'OLD-123'}]},'OLD-123','correos').status).toBe('confirmed');
});
it.each([
 {meta:'cancel',data:{carrier:'correos',trackingNumber:'OTHER'}},
 {meta:'cancel',data:{carrier:'gls',trackingNumber:'OLD-123'}},
 {status:'success'}, {message:'Cancellation pending, not cancelled'}, {meta:'cancel',data:[]},
])('never infers an Envia cancellation from an unrelated/ambiguous response %j',payload=>expect(parseEnviaCancellation(payload,'OLD-123','correos').status).toBe('unknown'));
it('Envia reports explicit failure without reflecting provider text or credentials',()=>{
 const result=parseEnviaCancellation({meta:'error',error:{message:'PRIVATE-TOKEN-CANARY'}},'OLD','correos');expect(result.status).toBe('rejected');expect(result.message).not.toContain('CANARY');
});
const soap=(reference='OLD-123')=>`<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><CancelarEnvioResponse xmlns="http://www.mrw.es/"><CancelarEnvioResult><NumeroSolicitud>REQ</NumeroSolicitud><NumeroEnvio>${reference}</NumeroEnvio></CancelarEnvioResult></CancelarEnvioResponse></s:Body></s:Envelope>`;
it('MRW requires the official operation result and the exact previous shipment reference',()=>{
 expect(parseMrwCancellation(soap(),'OLD-123').status).toBe('confirmed');
 expect(parseMrwCancellation(soap('OTHER'),'OLD-123').status).toBe('unknown');
});
it.each(['<NumeroEnvio>OLD-123</NumeroEnvio>',soap().replace('</s:Envelope>',''),'<a><b></a></b>',`<!DOCTYPE a [<!ENTITY x SYSTEM "file:///etc/passwd">]>${soap()}`])('refuses malformed/unscoped XML',xml=>expect(parseMrwCancellation(xml,'OLD-123').status).toBe('unknown'));
it('MRW distinguishes a client rejection from an uncertain server failure and never reflects the fault text',()=>{
 const fault=(code:string)=>`<s:Envelope xmlns:s="s"><s:Body><s:Fault><faultcode>s:${code}</faultcode><faultstring>SECRET-CANARY</faultstring></s:Fault></s:Body></s:Envelope>`;
 expect(parseMrwCancellation(fault('Client'),'OLD-123').status).toBe('rejected');expect(parseMrwCancellation(fault('Server'),'OLD-123').status).toBe('unknown');expect(parseMrwCancellation(fault('Client'),'OLD-123').message).not.toContain('CANARY');
});
it('requires the MRW result inside a SOAP body and rejects multiple operation results',()=>{
 expect(parseMrwCancellation('<CancelarEnvioResponse><CancelarEnvioResult><NumeroEnvio>OLD-123</NumeroEnvio></CancelarEnvioResult></CancelarEnvioResponse>','OLD-123').status).toBe('unknown');
 const duplicate=soap().replace('</CancelarEnvioResponse>','<CancelarEnvioResult><NumeroEnvio>OTHER</NumeroEnvio></CancelarEnvioResult></CancelarEnvioResponse>');
 expect(parseMrwCancellation(duplicate,'OLD-123').status).toBe('unknown');
});
