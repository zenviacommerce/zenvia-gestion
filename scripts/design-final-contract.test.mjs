import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,readFileSync} from 'node:fs';
import {legacyWrappers} from './check-design-contract.mjs';
test('all Gestión screens use shared KPI and page-header primitives after migration',()=>{
 const variants=[];
 for(const dir of ['src/pages','src/components'])for(const name of readdirSync(dir,{recursive:true}).filter(n=>n.endsWith('.tsx'))){const path=dir+'/'+name;if(['src/components/PageHeader.tsx','src/components/StatCard.tsx'].includes(path))continue;
 const source=readFileSync(path,'utf8');for(const [token,count] of Object.entries(legacyWrappers(source)))if(count)variants.push(`${path}: ${token} x${count}`);
 if(/className="(?:supportStats|adminStats|adminAuditStats|gmailStats)"/.test(source))variants.push(path+': bespoke KPI family');}
 assert.deepEqual(variants,[],'Migrate wrappers to shared components; no grandfathered screen exceptions');
});
