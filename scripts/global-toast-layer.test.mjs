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
  assert.match(edge,/GetPointsByCP/);
  assert.match(edge,/GetPointsDB/);
  assert.match(edge,/codigoPoint>00000<\/codigoPoint/);
  assert.match(edge,/devolvió un error interno al validar la conexión/);
  assert.match(shipping,/devolvió un error interno/);
  assert.doesNotMatch(edge,/codigoPoint><\/codigoPoint/);
});
