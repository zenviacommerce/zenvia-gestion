import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('central mailer sends subscription invoice PDF attachments through the existing Resend service',async()=>{
  const mailer=await read('supabase/functions/platform-mailer/index.ts');
  assert.match(mailer,/billing_invoice/);
  assert.match(mailer,/attachments/);
  assert.match(mailer,/Factura .* ZENVIA Gestión/);
  assert.match(mailer,/application\/json/);
});

test('subscription invoice history exposes PDF download and direct expense import',async()=>{
  const [billing,settings]=await Promise.all([read('src/services/billing.ts'),read('src/pages/Settings.tsx')]);
  assert.match(billing,/download_url/);
  assert.match(billing,/importCustomerSubscriptionInvoiceAsExpense/);
  assert.match(billing,/createInvoice/);
  assert.match(billing,/updateInvoicePaymentStatus/);
  assert.match(billing,/zenvia-subscription-billing/);
  assert.match(settings,/Añadir a Gastos/);
  assert.match(settings,/Download size=/);
  assert.match(settings,/invoice\.download_url/);
});

test('direct expense import preserves supplier identity, currency and fiscal amounts',async()=>{
  const billing=await read('src/services/billing.ts');
  assert.match(billing,/supplierName:billingText\(issuer\.issuer_legal_name\)/);
  assert.match(billing,/supplierTaxId:billingText\(issuer\.issuer_tax_id\)/);
  assert.match(billing,/subtotal:invoice\.subtotal_cents\/100/);
  assert.match(billing,/vat:invoice\.tax_cents\/100/);
  assert.match(billing,/currency:invoice\.currency/);
  assert.match(billing,/payment_status|updateInvoicePaymentStatus/);
});
