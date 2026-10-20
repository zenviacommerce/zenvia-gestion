import {test} from 'node:test';import assert from 'node:assert/strict';import {contractViolations,legacyWrappers} from './check-design-contract.mjs';
test('rejects a new page with isolated header and KPI wrappers',()=>{
 const source='export const P=()=> <div><div className="pageHead"/><div className={true?"stats":"stat"}/></div>';
 assert.equal(legacyWrappers(source).pageHead,1);assert.ok(contractViolations({'src/pages/New.tsx':source},{}).length>=3);
});
test('accepts shared primitives and prevents growth in grandfathered screens',()=>{
 assert.deepEqual(contractViolations({'src/pages/New.tsx':'<PageHeader/><KpiGrid><StatCard/></KpiGrid>'},{}),[]);
 assert.equal(contractViolations({'src/pages/Old.tsx':'<div className="stats"/>'},{'src/pages/Old.tsx':{stats:1}}).length,0);
 assert.equal(contractViolations({'src/pages/Old.tsx':'<><div className="stats"/><div className="stats"/></>'},{'src/pages/Old.tsx':{stats:1}}).length,1);
});

test('new KPI components also require the shared grid',()=>{
 assert.equal(contractViolations({'src/components/NewKpis.tsx':'<StatCard label="Ventas"/>'},{}).length,1);
 assert.deepEqual(contractViolations({'src/components/NewKpis.tsx':'<KpiGrid><StatCard label="Ventas"/></KpiGrid>'},{}),[]);
});
