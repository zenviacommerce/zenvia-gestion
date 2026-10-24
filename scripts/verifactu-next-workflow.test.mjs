import {readFileSync} from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
test('integrity implementation-only changes trigger the fiscal verification gate',()=>{
 const yaml=readFileSync(new URL('../.github/workflows/verifactu-next.yml',import.meta.url),'utf8');
 for(const path of ['src/services/verifactuMonitor.ts','src/components/VerifactuIntegrityModal*','supabase/migrations/*verifactu*.sql'])assert.ok(yaml.includes("'"+path+"'"),'missing verification path: '+path);
});
