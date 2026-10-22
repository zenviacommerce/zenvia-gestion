// @vitest-environment node
import {describe,it,expect,vi} from 'vitest';
import {probeMrwTrackingAccount} from '../supabase/functions/_shared/tracking/accountProbe';

const account={id:'account',owner_id:'owner',provider:'mrw',secret_id:'vault-secret',config:{}};
const shipment={id:'order',owner_id:'owner',shipping_provider:'mrw',shipping_integration_account_id:'account',pii_purged_at:null,tracking_number:'PRIVATE-TRACKING'};
const now='2026-10-22T10:00:00.000Z';
function database(accounts:any[]=[account],shipments:any[]=[shipment],credentials:any={trackingPassword:'PRIVATE-TRACKING-PASSWORD',password:'PRIVATE-SAGEC-PASSWORD',franchiseCode:'0000',subscriberCode:'000001'}){
 const reads:string[]=[]; const rpc=vi.fn(async(name:string)=>{if(name!=='integration_read_secret')throw Error('Write forbidden');return {data:JSON.stringify(credentials),error:null}});
 const admin={rpc,from(table:string){reads.push(table);let rows=table==='integration_accounts'?accounts:shipments;const query:any={
 select(){return query},eq(key:string,value:any){rows=rows.filter(row=>row[key]===value);return query},is(key:string,value:any){rows=rows.filter(row=>row[key]===value);return query},
 not(key:string,operator:string,value:any){rows=rows.filter(row=>operator==='is'?row[key]!==value:row[key]!==value);return query},
 neq(key:string,value:any){rows=rows.filter(row=>row[key]!==value);return query},limit(n:number){rows=rows.slice(0,n);return query},
 maybeSingle:async()=>({data:rows[0]||null,error:null}),then(resolve:any,reject:any){return Promise.resolve({data:rows,error:null}).then(resolve,reject)},
 update(){throw Error('Write forbidden')},insert(){throw Error('Write forbidden')},upsert(){throw Error('Write forbidden')},delete(){throw Error('Write forbidden')},
 };return query}};return {admin,rpc,reads};
}
function successfulRequest(){return vi.fn(async(_input:RequestInfo|URL,_init?:RequestInit)=>new Response('<Estado>true</Estado><Envio><Numero>PRIVATE-TRACKING</Numero><Estado>1</Estado><EstadoDescripcion>PRIVATE RECIPIENT EVENT</EstadoDescripcion></Envio>'))}
const result=(code:string,ok=false)=>({ok,code,checkedAt:now});
describe('read-only MRW account tracking probe',()=>{
 it('selects one owned, account-scoped, MRW nonpurged shipment and returns no provider or shipment data',async()=>{
  const db=database([account],[{...shipment,id:'foreign',owner_id:'foreign',tracking_number:'FOREIGN'}, {...shipment,id:'other-account',shipping_integration_account_id:'other',tracking_number:'OTHER'}, {...shipment,id:'other-provider',shipping_provider:'sendcloud',tracking_number:'SENDCLOUD'}, {...shipment,id:'purged',pii_purged_at:now,tracking_number:'PURGED'}, {...shipment,id:'empty',tracking_number:''},{...shipment,id:'null',tracking_number:null},shipment]);
  const request=successfulRequest();expect(await probeMrwTrackingAccount(db.admin,'owner','account',request,now)).toEqual(result('MRW_TRACKING_OK',true));
  expect(request).toHaveBeenCalledTimes(1);const body=String(request.mock.calls[0]?.[1]?.body);expect(body).toContain('<NumeroMRW>PRIVATE-TRACKING</NumeroMRW>');expect(body).toContain('PRIVATE-TRACKING-PASSWORD');expect(body).not.toContain('PRIVATE-SAGEC-PASSWORD');
  expect(db.rpc).toHaveBeenCalledExactlyOnceWith('integration_read_secret',{p_secret_id:'vault-secret'});
 });
 it('a foreign account cannot reach Vault or shipment/provider reads',async()=>{
  const db=database([{...account,owner_id:'foreign'}]);const request=successfulRequest();expect(await probeMrwTrackingAccount(db.admin,'owner','account',request,now)).toEqual(result('MRW_TRACKING_ACCOUNT_NOT_FOUND'));expect(db.rpc).not.toHaveBeenCalled();expect(request).not.toHaveBeenCalled();expect(db.reads).toEqual(['integration_accounts']);
 });
 it.each([{...account,provider:'sendcloud'},{...account,config:{archivedAt:now}}])('rejects unsupported or archived accounts before Vault',async(row)=>{
  const db=database([row]);const request=successfulRequest();const outcome=await probeMrwTrackingAccount(db.admin,'owner','account',request,now);expect(outcome.ok).toBe(false);expect(db.rpc).not.toHaveBeenCalled();expect(request).not.toHaveBeenCalled();
 });
 it('does not fetch when only SAGEC password exists',async()=>{
  const db=database(undefined,undefined,{password:'PRIVATE-SAGEC-PASSWORD'});const request=successfulRequest();expect(await probeMrwTrackingAccount(db.admin,'owner','account',request,now)).toEqual(result('MRW_TRACKING_PASSWORD_REQUIRED'));expect(request).not.toHaveBeenCalled();
 });
 it('accepts the dedicated tracking_password alias',async()=>{
  const db=database(undefined,undefined,{tracking_password:'ALIAS-SECRET'});expect(await probeMrwTrackingAccount(db.admin,'owner','account',successfulRequest(),now)).toEqual(result('MRW_TRACKING_OK',true));
 });
 it('returns a safe code without Vault/provider when no eligible shipment exists',async()=>{
  const db=database(undefined,[]);const request=successfulRequest();expect(await probeMrwTrackingAccount(db.admin,'owner','account',request,now)).toEqual(result('MRW_TRACKING_NO_SHIPMENT'));expect(db.rpc).not.toHaveBeenCalled();expect(request).not.toHaveBeenCalled();
 });
 it.each([['<Estado>false</Estado><Mensaje>PRIVATE CREDENTIALS</Mensaje>','MRW_TRACKING_ACCESS_DENIED'],['<soap:Fault><faultstring>PRIVATE ERROR</faultstring></soap:Fault>','MRW_TRACKING_REJECTED'],['PRIVATE XML','MRW_TRACKING_FAILED']])('only returns fixed codes for provider rejection',async(xml,code)=>{
  const db=database();const request=vi.fn(async()=>new Response(xml));expect(await probeMrwTrackingAccount(db.admin,'owner','account',request,now)).toEqual(result(code));
 });
 it('does not expose arbitrary transport or Vault errors',async()=>{
  const db=database();const request=vi.fn(async()=>{throw Error('PRIVATE PASSWORD AND SHIPMENT')});expect(await probeMrwTrackingAccount(db.admin,'owner','account',request,now)).toEqual(result('MRW_TRACKING_FAILED'));
  db.rpc.mockRejectedValueOnce(Error('PRIVATE VAULT ERROR'));expect(await probeMrwTrackingAccount(db.admin,'owner','account',request,now)).toEqual(result('MRW_TRACKING_FAILED'));
 });
});
