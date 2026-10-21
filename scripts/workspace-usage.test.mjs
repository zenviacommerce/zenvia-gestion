import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../supabase/functions/_shared/workspace-usage.ts',import.meta.url),'utf8');
const code=ts.transpile(source,{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext});
const {readWorkspaceUsage}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));

test('workspace counts are scoped, exact, and preserve partial failures as unknown',async()=>{
  const calls=[];
  const admin={from(table){const call={table,filters:[]};calls.push(call);const q={
    select(columns,options){call.columns=columns;call.options=options;return q;},
    eq(...args){call.filters.push(['eq',...args]);return q;},
    neq(...args){call.filters.push(['neq',...args]);return q;},
    gte(...args){call.filters.push(['gte',...args]);return q;},
    lt(...args){call.filters.push(['lt',...args]);return q;},
    then(resolve){return Promise.resolve(table==='amazon_accounts'?{count:null,error:{code:'57014'}}:{count:table==='app_users'?5:164,error:null}).then(resolve);}
  };return q;}};
  const result=await readWorkspaceUsage(admin,'workspace-a',new Date('2026-10-21T07:00:00Z'));
  assert.equal(result.users,5);assert.equal(result.amazonAccounts,null);assert.equal(result.monthlyOrders,164);
  assert.equal(result.observedAt,'2026-10-21T07:00:00.000Z');
  for(const call of calls){assert.deepEqual(call.options,{count:'exact',head:true});assert.ok(call.filters.some(x=>x[2]==='workspace-a'));}
  assert.ok(calls[0].filters.some(x=>x[1]==='active'&&x[2]===true));
  assert.ok(calls[1].filters.some(x=>x[0]==='neq'&&x[1]==='status'&&x[2]==='disabled'));
  assert.ok(calls[2].filters.some(x=>x[0]==='gte'&&x[2]==='2026-10-01T00:00:00.000Z'));
  assert.ok(calls[2].filters.some(x=>x[0]==='lt'&&x[2]==='2026-11-01T00:00:00.000Z'));
});

test('missing workspace is rejected before querying',async()=>{
  await assert.rejects(()=>readWorkspaceUsage({from(){throw Error('must not query');}},''),/cliente/);
});
