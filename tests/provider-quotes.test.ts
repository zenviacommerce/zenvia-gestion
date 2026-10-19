import {it,expect,vi} from 'vitest';
import {collectProviderQuotes} from '../src/services/providerQuotes';
it('publishes fast results while a failed or hung provider remains visible; retries independently',async()=>{
 vi.useFakeTimers();
 try{
  const updates:any[]=[];let view:any={};
  const work=collectProviderQuotes({sendcloud:async()=>({options:[{code:'one'}]}),envia:()=>new Promise(()=>{}),mrw:async()=>{throw Error('MRW 500')}},s=>{view={...view,...s};updates.push(view)},100);
  await Promise.resolve();await Promise.resolve();
  expect(updates.some(s=>s.sendcloud.state==='ready'&&s.envia.state==='loading')).toBe(true);
  await vi.advanceTimersByTimeAsync(101);const result=await work;
  expect(result.mrw).toMatchObject({state:'error',message:'MRW 500'});
  expect(result.envia.state).toBe('error');expect(result.sendcloud.options).toHaveLength(1);
  const retry=await collectProviderQuotes({mrw:async()=>({options:[{code:'recovered'}]})},()=>{},100);
  expect(retry.mrw.state).toBe('ready');expect(retry.sendcloud).toBeUndefined();
 }finally{vi.useRealTimers()}
});
it('an independent retry is not overwritten when another original provider finishes',async()=>{
 let resolve!:any,view:any={};const publish=(s:any)=>{view={...view,...s}};
 const original=collectProviderQuotes({mrw:async()=>{throw Error('failed')},envia:()=>new Promise(r=>{resolve=r})},publish);
 await Promise.resolve();await Promise.resolve();
 await collectProviderQuotes({mrw:async()=>({options:[{code:'recovered'}]})},publish);
 resolve({options:[{code:'slow'}]});await original;
 expect(view.mrw.state).toBe('ready');expect(view.mrw.options[0].code).toBe('recovered');
});
it('preserves successful options and actual diagnostics for partial provider failures',async()=>{
 const result=await collectProviderQuotes({envia:async()=>({options:[{code:'good'}],diagnostics:[{carrier:'correos',message:'HTTP 503'}]})},()=>{});
 expect(result.envia).toMatchObject({state:'partial',options:[{code:'good'}],diagnostics:['correos · HTTP 503']});
});
it('route exclusions remain visible as not applicable while successful rates keep no Retry',async()=>{
 const result=await collectProviderQuotes({envia:async()=>({options:[{code:'good'}],message:'2 cotizaciones de transportista han fallado.',diagnostics:[{carrier:'DHL',message:'Envia.com (400): solo pueden partir con origen en Madrid'},{carrier:'Cainiao',message:'sin cobertura para el origen'}]})},()=>{});
 expect(result.envia).toMatchObject({state:'ready',retryable:false});expect(result.envia.message).toContain('no aplicables');expect(result.envia.message).not.toContain('fallado');expect(result.envia.diagnostics?.every(d=>d.startsWith('No aplica a esta ruta'))).toBe(true);
});
it('a route with no applicable rates does not become a retryable error',async()=>{
 const result=await collectProviderQuotes({envia:async()=>({options:[],diagnostics:[{carrier:'Cainiao',message:'sin cobertura para el origen'}]})},()=>{});expect(result.envia).toMatchObject({state:'not_applicable',retryable:false});
});
it('retries only temporary failures even when route exclusions are also returned',async()=>{
 const result=await collectProviderQuotes({envia:async()=>({options:[{code:'good'}],diagnostics:[{carrier:'Cainiao',message:'sin cobertura para el origen'},{carrier:'DHL',message:'Envia.com (503): temporary failure'}]}),sendcloud:async()=>{throw Error('HTTP 401: invalid credentials')},mrw:async()=>{throw Error('HTTP 500')}},()=>{});
 expect(result.envia).toMatchObject({state:'partial',retryable:true});expect(result.sendcloud).toMatchObject({state:'error',retryable:false});expect(result.mrw).toMatchObject({state:'error',retryable:true});
});
