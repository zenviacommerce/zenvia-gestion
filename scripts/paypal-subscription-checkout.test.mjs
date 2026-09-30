import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('Gestion plan changes use PayPal checkout instead of support tickets',async()=>{
  const [billing,settings]=await Promise.all([read('src/services/billing.ts'),read('src/pages/Settings.tsx')]);
  assert.match(billing,/startCustomerPayPalCheckout/);
  assert.match(billing,/customer-billing-api/);
  assert.match(settings,/Contratar con PayPal/);
  assert.match(settings,/Activar con PayPal/);
  assert.match(settings,/window\.location\.assign\(result\.approveUrl\)/);
  assert.doesNotMatch(billing,/createSupportTicket/);
});

test('Gestion Plan y facturacion surfaces PayPal as provider and subscription invoice history',async()=>{
  const [billing,settings]=await Promise.all([read('src/services/billing.ts'),read('src/pages/Settings.tsx')]);
  assert.match(settings,/billingProvider==='paypal'\?'PayPal'/);
  assert.match(settings,/Facturas de la suscripción/);
  assert.match(billing,/loadCustomerSubscriptionInvoices/);
  assert.match(settings,/billingInvoiceHistory/);
});
