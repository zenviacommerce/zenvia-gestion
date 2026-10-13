import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('issued order invoices keep recipient details visible after closing the email composer',()=>{
 const source=readFileSync(new URL('../src/components/OrderInvoiceModal.tsx',import.meta.url),'utf8');
 assert.match(source,/issued&&<section[^>]*className="salesFormSection"/);
 assert.match(source,/invoice\.clientEmail\|\|client\.email/);
 assert.match(source,/invoice\.clientAddress/);
 assert.match(source,/onClose=\{\(\)=>setSending\(false\)\}/);
});
