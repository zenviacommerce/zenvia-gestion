import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
test('retired direct printing has no client, account preference or standalone agent',async()=>{
 const orders=await readFile('src/services/orders.ts','utf8');
 const schema=await readFile('src/services/settingsSchema.ts','utf8');
 const settings=await readFile('src/services/settings.ts','utf8');
 assert.doesNotMatch(orders,/127\.0\.0\.1|LocalPrinter|printLabelWithClient|PRINTER_KEY/);
 assert.doesNotMatch(schema,/labelPrinterId\s*:/);assert.doesNotMatch(settings,/legacyPrinter|zenvia-label-printer/);
 await assert.rejects(access('tools/print-agent/server.mjs'));
 assert.match(orders,/export function openLabelForPrint/);
});
