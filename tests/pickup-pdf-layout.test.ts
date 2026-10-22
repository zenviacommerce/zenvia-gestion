// @vitest-environment node
import {execFileSync} from 'node:child_process';
import {expect,it} from 'vitest';

it('renders 9, 25, 30 and 60 shipments into compact real PDFs with signatures beside shipment rows',()=>{
 const result=execFileSync(process.execPath,['scripts/pickup-pdf-compact.test.mjs'],{cwd:process.cwd(),encoding:'utf8'});
 expect(result).toContain('9 shipments: 1 page(s)');
 expect(result).toContain('25 shipments: 1 page(s)');
 expect(result).toContain('30 shipments: 1 page(s)');
 expect(result).toContain('60 shipments: 2 page(s)');
});
