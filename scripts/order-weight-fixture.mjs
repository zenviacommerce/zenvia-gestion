// Load the real shared calculator into Edge VM fixtures. Upstream credentials
// stay unavailable; fixtures must provide persisted weights or use explicit fallback.
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
export function loadOrderWeightFixture(){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('supabase/functions/_shared/orderPackageWeight.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:()=>({loadAmazonSpApiCredentials:async()=>{throw Error('Synthetic fixture has no upstream credentials');}}),console,Map,Set,setTimeout,clearTimeout});return exports;}
