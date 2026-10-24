// Independently decode the QR from the rendered synthetic PDF, not its source matrix.
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import jsQR from 'jsqr';
const require=createRequire(import.meta.url);const {PNG}=require('pngjs');
const file=process.argv[2]||'docs/deploy/20261024-verifactu-next/screenshots/05-pdf-test-qr.png';
const png=PNG.sync.read(readFileSync(file));
const decoded=jsQR(new Uint8ClampedArray(png.data),png.width,png.height);
assert.ok(decoded,'Rendered QR must decode');
assert.equal(decoded.data,'https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR?nif=89890001K&numserie=TEST-QR-2026-0001&fecha=24-10-2026&importe=121.00');
console.log('PASS: independently decoded PDF QR, exact four fields and AEAT test host');
