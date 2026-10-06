import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('global toast host escapes modal stacking contexts and stays above every overlay',async()=>{
  const [host,css,dialog]=await Promise.all([
    read('src/components/ToastHost.tsx'),
    read('src/toast.css'),
    read('src/action-dialog.css'),
  ]);
  assert.match(host,/createPortal/);
  assert.match(host,/document\.body/);
  const toastZ=Number(css.match(/\.toastHost\{[^}]*z-index:(\d+)/)?.[1]||0);
  const dialogZ=Number(dialog.match(/\.actionDialogBackdrop\{[^}]*z-index:(\d+)/)?.[1]||0);
  assert.ok(toastZ>dialogZ,`toast z-index ${toastZ} must be above dialog ${dialogZ}`);
});

test('MRW connection validation uses read-only SOAP operations and never exposes raw HTML runtime pages',async()=>{
  const [edge,shipping]=await Promise.all([
    read('supabase/functions/integration-accounts/index.ts'),
    read('supabase/functions/mrw-shipping/index.ts'),
  ]);
  const validation=edge.slice(edge.indexOf('async function testMrw('),edge.indexOf('async function enviaCarriers('));
  assert.match(validation,/GetPointsDB/);
  assert.match(validation,/codigoPoint><\/codigoPoint/);
  assert.match(validation,/mrwGatewayRequest/);
  assert.match(validation,/soapVersion:'1.1'/);
  assert.match(validation,/text\/xml/);
  assert.match(validation,/sanitize\(title\|\|bodyText/);
  assert.doesNotMatch(validation,/TransmitirEnvio|GetEtiquetaEnvio|return.*raw/);
  assert.match(shipping,/application\/soap\+xml/);
  assert.match(shipping,/text\/xml/);
});


test('integration client preserves structured Edge Function error messages instead of generic non-2xx text',async()=>{
  const service=await read('src/services/integrationAccounts.ts');
  assert.match(service,/functionErrorMessage/);
  assert.match(service,/error\?\.context/);
  assert.match(service,/payload\?\.error\|\|payload\?\.message/);
  assert.match(service,/Edge Function returned a non-2xx status code/);
});
