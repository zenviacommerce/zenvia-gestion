import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildAltaHashInput, buildAnulacionHashInput, sha256Hex, type AltaHashFields } from '../supabase/functions/_shared/verifactu/hash';
const { vectors } = JSON.parse(readFileSync('docs/deploy/20261023-verifactu-phase0/hash-vectors.json','utf8'));
const alta: AltaHashFields = { IDEmisorFactura:'89890001K', NumSerieFactura:'12345678/G33', FechaExpedicionFactura:'01-01-2024', TipoFactura:'F1', CuotaTotal:'12.35', ImporteTotal:'123.45', Huella:'', FechaHoraHusoGenRegistro:'2024-01-01T19:20:30+01:00' };
let db: PGlite;
beforeAll(async () => {
 db = new PGlite();
 await db.exec(readFileSync('tests/fixtures/verifactu-before.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20261024075749_verifactu_shadow_phase1.sql','utf8'));
}, 30000);
afterAll(async () => { if(db) await db.close(); });
async function sqlInput(kind: string, input: object): Promise<string> {
 const result=await db.query<{canonical:string}>('select private.vf_hash_input($1,$2::jsonb) as canonical',[kind,JSON.stringify(input)]);
 return result.rows[0].canonical;
}
async function compareAlta(input: AltaHashFields) {
 const expected=buildAltaHashInput(input);
 expect(await sqlInput('alta',input)).toBe(expected);
 const result=await db.query<{hash:string}>('select private.vf_sha256($1) as hash',[expected]);
 expect(result.rows[0].hash).toBe(await sha256Hex(expected));
}
describe('real PostgreSQL / TypeScript AEAT canonical and hash parity', () => {
 it('matches all three exact official examples with real SQL SHA256', async () => {
  const inputs=[alta,{...alta,NumSerieFactura:'12345679/G34',Huella:vectors[0].sha256,FechaHoraHusoGenRegistro:'2024-01-01T19:20:35+01:00'}, {IDEmisorFacturaAnulada:'89890001K',NumSerieFacturaAnulada:'12345679/G34',FechaExpedicionFacturaAnulada:'01-01-2024',Huella:vectors[1].sha256,FechaHoraHusoGenRegistro:'2024-01-01T19:20:40+01:00'}];
  for(let i=0;i<3;i++) {
   const canonical=await sqlInput(i===2?'anulacion':'alta',inputs[i]);
   expect(canonical).toBe(vectors[i].canonical);
   expect(i===2?buildAnulacionHashInput(inputs[i] as never):buildAltaHashInput(inputs[i] as never)).toBe(canonical);
   expect((await db.query<{hash:string}>('select private.vf_sha256($1) as hash',[canonical])).rows[0].hash).toBe(vectors[i].sha256);
  }
 });
 it('preserves UTF8, delimiters and compositions while trimming ECMAScript whitespace', async () => {
  const edges='\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff';
  await compareAlta({...alta,NumSerieFactura:`${edges}á / 你好 & = e\u0301${edges}`});
 });
 it.each(['0','-0','+0000.00','00012.3','+999999999999.99','-999999999999.99','123.'])('matches decimal2 normalization of %s', async money => {
  const input={...alta,CuotaTotal:money,ImporteTotal:money};
  await compareAlta(input);
  const value=(await db.query<{money:string}>('select private.vf_money($1) as money',[money])).rows[0].money;
  expect(buildAltaHashInput(input)).toContain(`&CuotaTotal=${value}&ImporteTotal=${value}&`);
 });
 it.each(['12.345','1e2','1,25','NaN','','1000000000000'])('both reject invalid money %s', async value => {
  expect(()=>buildAltaHashInput({...alta,CuotaTotal:value})).toThrow();
  await expect(sqlInput('alta',{...alta,CuotaTotal:value})).rejects.toThrow();
  await expect(db.query('select private.vf_money($1)',[value])).rejects.toThrow();
 });
 it.each(['31-02-2024','2024-01-01','01-01-0000'])('both reject invalid issue date %s', async value => {
  const input={...alta,FechaExpedicionFactura:value};
  expect(()=>buildAltaHashInput(input)).toThrow();
  await expect(sqlInput('alta',input)).rejects.toThrow();
 });
 it.each(['2024-02-29T23:59:59-05:30','2024-02-29T00:00:00+14:00','2024-02-29T00:00:00-14:00'])('preserves valid explicit offset %s', async value => compareAlta({...alta,FechaHoraHusoGenRegistro:value}));
 it.each(['2024-02-30T19:20:30+01:00','2024-01-01T24:00:00+01:00','2024-01-01T19:20:30+14:01','2024-01-01T19:20:30Z','2024-01-01T19:20:30','0000-01-01T19:20:30+01:00'])('both reject invalid generation timestamp %s', async value => {
  const input={...alta,FechaHoraHusoGenRegistro:value};
  expect(()=>buildAltaHashInput(input)).toThrow();
  await expect(sqlInput('alta',input)).rejects.toThrow();
 });
 it.each(['bad','a'.repeat(64),undefined])('both reject invalid predecessor %s',async value => {
  const input={...alta,Huella:value} as AltaHashFields;
  expect(()=>buildAltaHashInput(input)).toThrow();
  await expect(sqlInput('alta',input)).rejects.toThrow();
 });
 it('both reject JSON numeric money instead of silently coercing its source type', async()=>{
  const input={...alta,CuotaTotal:12.35};
  expect(()=>buildAltaHashInput(input as never)).toThrow();
  await expect(sqlInput('alta',input)).rejects.toThrow();
 });
 it('both reject interior ASCII controls',async()=>{
  const input={...alta,NumSerieFactura:'A\u0009B'};
  expect(()=>buildAltaHashInput(input)).toThrow();
  await expect(sqlInput('alta',input)).rejects.toThrow();
 });
 it.each([
  ['2024-01-15T12:20:30Z','2024-01-15T13:20:30+01:00'],
  ['2024-07-15T12:20:30Z','2024-07-15T14:20:30+02:00'],
  ['2024-03-31T00:59:59Z','2024-03-31T01:59:59+01:00'],
  ['2024-03-31T01:00:00Z','2024-03-31T03:00:00+02:00'],
  ['2024-10-27T00:59:59Z','2024-10-27T02:59:59+02:00'],
  ['2024-10-27T01:00:00Z','2024-10-27T02:00:00+01:00'],
 ])('renders Madrid offset at instant %s and hashes its exact lexical timestamp',async(instant,expected)=>{
  const result=await db.query<{timestamp:string}>('select private.vf_offset_time($1::timestamptz) as timestamp',[instant]);
  expect(result.rows[0].timestamp).toBe(expected);
  await compareAlta({...alta,FechaHoraHusoGenRegistro:result.rows[0].timestamp});
 });
});
