import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const compile=source=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
const dataUrl=source=>`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const policyUrl=dataUrl(compile(await readFile(new URL('../supabase/functions/_shared/mfa-policy.ts',import.meta.url),'utf8')));
export const {assertMfaWithClient}=await import(policyUrl);
// Keep the production guard in endpoint fixtures; only replace the SDK transport.
export async function mfaFixtureUrl(globalAdminName){
 const source=(await readFile(new URL('../supabase/functions/_shared/mfa.ts',import.meta.url),'utf8'))
  .replace(/import \{createClient\} from [^;]+;/,`const createClient=()=>globalThis[${JSON.stringify(globalAdminName)}];`)
  .replaceAll("'./mfa-policy.ts'",JSON.stringify(policyUrl));
 return dataUrl(compile(source));
}
