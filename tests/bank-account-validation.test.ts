import {describe,it,expect} from 'vitest';
import {IBAN_COUNTRY_LENGTHS,normalizeIban,validateIban,normalizeBic,validateBic,validateBankAccountInput} from '../src/services/bankAccountValidation';

describe('bank account validation',()=>{
 it('normalizes whitespace and case while checking country length and MOD97',()=>{
  expect(normalizeIban('es91 2100 0418 4502 0005 1332')).toBe('ES9121000418450200051332');
  for(const iban of ['ES9121000418450200051332','DE89370400440532013000','FR1420041010050500013M02606','GB82WEST12345698765432'])expect(validateIban(iban)).toBe(true);
  for(const iban of ['ES9121000418450200051333','ES91-21000418450200051332','ZZ9121000418450200051332','ES912100041845020005133','', 'ES0021000418450200051332'])expect(validateIban(iban)).toBe(false);
 });
 it('validates optional BIC and required alias without guessing account ownership',()=>{
  expect(normalizeBic(' ab12esmmxxx ')).toBe('AB12ESMMXXX');
  for(const bic of ['',null,'AB12ESMM','AB12ESMMXXX'])expect(validateBic(bic)).toBe(true);
  for(const bic of ['AB12E1MM','AB12ESMMXX','AB12ESMM-XX'])expect(validateBic(bic)).toBe(false);
  expect(()=>validateBankAccountInput({alias:'',iban:'DE89370400440532013000'})).toThrow('alias');
  expect(()=>validateBankAccountInput({alias:'Principal',iban:'ES0021000418450200051332'})).toThrow('IBAN');
  expect(()=>validateBankAccountInput({alias:'Principal',iban:'DE89370400440532013000',bic:'AB12ESMM'})).not.toThrow();
 });
 it('includes all 89 countries from Swift registry release 103, including Yemen',()=>{
  expect(Object.keys(IBAN_COUNTRY_LENGTHS)).toHaveLength(89);
  expect(IBAN_COUNTRY_LENGTHS.YE).toBe(30);
  expect(validateIban('YE15CBYE0001018861234567891234')).toBe(true);
 });
});
