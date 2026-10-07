import test from 'node:test';
import assert from 'node:assert/strict';
import {errorMessage} from '../src/services/toast.ts';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
const source=fs.readFileSync('src/services/gmailBulkImport.ts','utf8').replace(/^import[\s\S]*?;\n/gm,'').replaceAll('export ','');
const runGmailImportBatch=vm.runInNewContext(stripTypeScriptTypes(source)+'\nrunGmailImportBatch',{errorMessage});
test('bulk import isolates failures, keeps reviews and runs one document at a time',async()=>{
 const sources=['ok','fail','review','last'].map(id=>({id,status:'found',attachmentName:id}));let active=0,maximum=0;const seen=[];
 const result=await runGmailImportBatch(sources,async source=>{active++;maximum=Math.max(maximum,active);await Promise.resolve();seen.push(source.id);active--;if(source.id==='fail')throw {message:'No se pudo descargar'};return source.id==='review'?{kind:'review',candidate:{invoiceDate:''}}:{kind:'imported',invoiceId:source.id};});
 assert.equal(maximum,1);assert.deepEqual(seen,['ok','fail','review','last']);assert.equal(result.imported,2);assert.equal(result.reviews.length,1);assert.equal(result.failures.length,1);assert.equal(result.failures[0].message,'No se pudo descargar');
});
test('bulk import excludes imported and ignored attachments and deduplicates selected IDs',async()=>{
 const seen=[];const items=[{id:'a',status:'found'},{id:'a',status:'found'},{id:'b',status:'imported'},{id:'c',status:'ignored'},{id:'d',status:'error'},{status:'found'}];
 await runGmailImportBatch(items,async source=>{seen.push(source.id);return {kind:'imported',invoiceId:source.id};});assert.deepEqual(seen,['a','d']);
});
