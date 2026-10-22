import {describe,it,expect} from 'vitest';
import {withOrderQuote,withOrderLabelCreation} from '../supabase/functions/_shared/amazonPiiRead';
import {filterAggregatorOptions,directCarrierIds} from '../supabase/functions/_shared/carrierPolicy';

describe('concurrent quotes and label creation',()=>{
 const order={id:'order',owner_id:'owner',source_channel:'amazon',pii_purged_at:null};
 const denied=(message:string,status:number)=>({message,status});
 it('never purchases a label for an externally registered shipment after re-reading the lease',async()=>{
  let calls=0;const chain:any={eq(){return this},maybeSingle:async()=>({data:{...order,external_shipment:{registeredAt:'now'}},error:null}),then(resolve:any){return Promise.resolve({error:null}).then(resolve)}};
  const admin={rpc:async()=>({data:true,error:null}),from:()=>({select:()=>chain,update:()=>chain})};
  expect(await withOrderLabelCreation(admin,{...order},async()=>++calls,denied)).toMatchObject({status:409});expect(calls).toBe(0);
 });
 it('two quotes return identical options without RPCs or writes',async()=>{
  const admin={rpc:()=>{throw Error('quote acquired a lock')},from:()=>{throw Error('quote wrote to DB')}};
  const quote=()=>withOrderQuote(admin,order,async()=>['mrw','correos'],denied);
  expect(await Promise.all([quote(),quote()])).toEqual([['mrw','correos'],['mrw','correos']]);
 });
 it('purged data never reaches the quote operation',async()=>{
  let calls=0;expect(await withOrderQuote({}, {...order,pii_purged_at:'now'},async()=>++calls,denied)).toMatchObject({status:410});expect(calls).toBe(0);
 });
 it.each(['amazon','shopify','manual'])('only one simultaneous label can be created for %s',async source_channel=>{
  let locked=false,created=0,finish!:()=>void;
  const wait=new Promise<void>(r=>{finish=r});
  const row={...order,source_channel};
  const chain:any={eq(){return this},select(){return this},maybeSingle:async()=>({data:row,error:null}),then(resolve:any){locked=false;return Promise.resolve({error:null}).then(resolve)}};
  const admin={rpc:async()=>{if(locked)return {data:false,error:null};locked=true;return {data:true,error:null}},from:()=>({select:()=>chain,update:()=>chain})};
  const create=()=>withOrderLabelCreation(admin,{...row},async()=>{created++;await wait;return 'label'},denied);
  const first=create();await Promise.resolve();await Promise.resolve();
  expect(await create()).toMatchObject({status:409});finish();expect(await first).toBe('label');expect(created).toBe(1);expect(locked).toBe(false);
 });
 it('a stale cross-provider creation cannot transmit after the earlier label was saved',async()=>{
  let calls=0;
  const chain:any={eq(){return this},maybeSingle:async()=>({data:{...order,shipping_provider:'envia',shipping_remote_id:'saved'},error:null}),then(resolve:any){return Promise.resolve({error:null}).then(resolve)}};
  const admin={rpc:async()=>({data:true,error:null}),from:()=>({select:()=>chain,update:()=>chain})};
  expect(await withOrderLabelCreation(admin,{...order},async()=>++calls,denied)).toMatchObject({status:409});expect(calls).toBe(0);
 });
});
describe('workspace direct contracts override every aggregator',()=>{
 const options=[{carrierCode:'mrw_urgent',carrierName:'MRW',code:'0200'},{carrierCode:'correos',carrierName:'Correos',code:'paq'}];
 it.each(['sendcloud','envia','future'])('excludes all MRW services via %s even if its direct provider is unavailable',aggregator=>{
  const direct=directCarrierIds([{provider:'mrw',enabled:true,status:'error'}]);
  expect(filterAggregatorOptions(options,direct,aggregator)).toEqual([options[1]]);
 });
 it('disabled direct integration does not suppress aggregator services; workspace policies remain independent',()=>{
  expect(filterAggregatorOptions(options,directCarrierIds([{provider:'mrw',enabled:false,status:'active'}]),'envia')).toEqual(options);
  expect(filterAggregatorOptions(options,directCarrierIds([]),'sendcloud')).toEqual(options);
 });
});
