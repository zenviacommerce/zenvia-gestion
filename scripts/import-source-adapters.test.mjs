import test from 'node:test';import assert from 'node:assert/strict';
const api=await import('../shared/imports/sourceRules.ts').catch(()=>({}));
test('discovers nested attachments without downloading or treating logos as invoices',()=>{
 assert.equal(typeof api.gmailAttachments,'function');
 const parts=api.gmailAttachments({parts:[{filename:'logo.png',mimeType:'image/png',body:{attachmentId:'logo',size:1024}},{parts:[{filename:'factura.pdf',mimeType:'application/pdf',body:{attachmentId:'invoice',size:5120}}]}]});
 assert.deepEqual(parts.map(p=>p.attachmentId),['invoice']);
});
test('browser-session credentials cannot promise independent Gmail processing',()=>{
 assert.equal(typeof api.persistentGmailReady,'function');
 assert.equal(api.persistentGmailReady({credential_source:'session'},{refreshToken:'secret',clientId:'client'},'client'),false);
 assert.equal(api.persistentGmailReady({credential_source:'vault'},{refreshToken:'secret',clientId:'client'},'client'),true);
 assert.equal(api.persistentGmailReady({credential_source:'vault'},{refreshToken:'secret',clientId:'old'},'client'),false);
});
test('Shopify updates preserve locally created shipping labels when remote tracking is absent',async()=>{const fn=(await import('../shared/imports/orderRules.ts').catch(()=>({}))).preserveImportedShipping;assert.equal(typeof fn,'function');const existing={shipping_provider:'envia',shipping_integration_account_id:'local-account',tracking_number:'LOCAL-123',carrier_name:'MRW',label_created_at:'2026-10-01'};const row=fn(existing,{shipping_integration_account_id:null,tracking_number:null,carrier_name:null,customer_name:'Updated'});assert.equal(row.shipping_integration_account_id,'local-account');assert.equal(row.tracking_number,'LOCAL-123');assert.equal(row.customer_name,'Updated')});
