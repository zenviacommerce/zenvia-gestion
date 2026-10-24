import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { buildAltaHashInput, buildAnulacionHashInput, sha256Hex } from '../supabase/functions/_shared/verifactu/hash';
const { vectors } = JSON.parse(readFileSync('docs/deploy/20261023-verifactu-phase0/hash-vectors.json', 'utf8'));
const alta = { IDEmisorFactura: '89890001K', NumSerieFactura: '12345678/G33', FechaExpedicionFactura: '01-01-2024', TipoFactura: 'F1', CuotaTotal: '12.35', ImporteTotal: '123.45', Huella: '', FechaHoraHusoGenRegistro: '2024-01-01T19:20:30+01:00' };
const anulacion = { IDEmisorFacturaAnulada: '89890001K', NumSerieFacturaAnulada: '12345679/G34', FechaExpedicionFacturaAnulada: '01-01-2024', Huella: vectors[1].sha256, FechaHoraHusoGenRegistro: '2024-01-01T19:20:40+01:00' };
it('matches all three official AEAT canonical strings and SHA256 vectors', async () => {
 const canonical = [buildAltaHashInput(alta), buildAltaHashInput({ ...alta, NumSerieFactura: '12345679/G34', Huella: vectors[0].sha256, FechaHoraHusoGenRegistro: '2024-01-01T19:20:35+01:00' }), buildAnulacionHashInput(anulacion)];
 for (let i=0;i<3;i++) { expect(canonical[i]).toBe(vectors[i].canonical); expect(await sha256Hex(canonical[i])).toBe(vectors[i].sha256); }
});
it('trims edges, preserves internal spaces, Unicode and delimiters; hashes UTF8', async () => {
 const canonical = buildAltaHashInput({ ...alta, NumSerieFactura: '  SERIE á / 你好 & = 001  ' });
 expect(canonical).toContain('&NumSerieFactura=SERIE á / 你好 & = 001&');
 expect(await sha256Hex(canonical)).toBe(createHash('sha256').update(canonical,'utf8').digest('hex').toUpperCase());
 expect(await sha256Hex('é')).not.toBe(await sha256Hex('e\u0301'));
});
it('normalizes decimal strings without binary floating point or silent rounding', () => {
 expect(buildAltaHashInput({ ...alta, CuotaTotal: ' +00012.3 ', ImporteTotal: '-999999999999.99' })).toContain('&CuotaTotal=12.30&ImporteTotal=-999999999999.99&');
 expect(buildAltaHashInput({ ...alta, CuotaTotal: '-0', ImporteTotal: '123.' })).toContain('&CuotaTotal=0.00&ImporteTotal=123.00&');
});
it.each(['12.345','1e2','1,25','NaN','','1000000000000',12.35])('rejects invalid money %s', value => expect(() => buildAltaHashInput({ ...alta, CuotaTotal: value } as never)).toThrow());
it.each(['','2024-01-01T19:20:30','2024-01-01T19:20:30Z','2024-02-30T19:20:30+01:00','2024-01-01T24:00:00+01:00','2024-01-01T19:20:30+14:01'])('rejects invalid/missing explicit offset %s', value => expect(() => buildAltaHashInput({ ...alta, FechaHoraHusoGenRegistro: value })).toThrow());
it('preserves valid negative offset and leap date', () => expect(buildAltaHashInput({ ...alta, FechaHoraHusoGenRegistro: '2024-02-29T23:59:59-05:30' })).toContain('FechaHoraHusoGenRegistro=2024-02-29T23:59:59-05:30'));
it.each(['bad','a'.repeat(64),'A'.repeat(63)])('rejects malformed previous hash %s', value => expect(() => buildAnulacionHashInput({ ...anulacion, Huella: value })).toThrow());
it('permits explicitly empty predecessor for a first cancellation', () => expect(buildAnulacionHashInput({ ...anulacion, Huella: '' })).toContain('&Huella=&'));
it.each(['31-02-2024','2024-01-01','01-01-0000'])('rejects invalid issue date %s', value => expect(() => buildAltaHashInput({ ...alta, FechaExpedicionFactura: value })).toThrow());
it('rejects missing data, invalid invoice type and corrupt UTF16', async () => {
 expect(() => buildAltaHashInput({ ...alta, IDEmisorFactura: '' })).toThrow();
 expect(() => buildAltaHashInput({ ...alta, Huella: undefined } as never)).toThrow();
 expect(() => buildAltaHashInput({ ...alta, TipoFactura: 'F9' })).toThrow();
 expect(() => buildAltaHashInput({ ...alta, NumSerieFactura: '\uD800' })).toThrow();
 await expect(sha256Hex('\uD800')).rejects.toThrow();
});
