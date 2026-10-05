import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';
const source=fs.readFileSync('supabase/functions/mrw-shipping/index.ts','utf8');
const functions=source.slice(source.indexOf('function xmlValue('),source.indexOf('function envelope12('));
const parse=vm.runInNewContext(ts.transpile(functions,{target:ts.ScriptTarget.ES2022})+'\nsoapError');
test('MRW error includes explanation after numbered Message',()=>{
 const result=parse('<Errors><Message>1)</Message><Message>El peso no es válido</Message></Errors>');
 assert.match(result,/El peso no es válido/);
});
test('MRW success with informational message is not a SOAP fault',()=>{
 assert.equal(parse('<Result><Estado>1</Estado><Mensaje>El separador no coincide</Mensaje><EtiquetaFile>JVBERi0=</EtiquetaFile></Result>'),'');
});
