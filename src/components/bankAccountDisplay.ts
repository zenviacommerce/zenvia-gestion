import {normalizeIban,validateIban} from '../services/bankAccountValidation';

// Presentation only: keep invalid legacy text intact so it can be corrected.
export function formatBankAccountIban(iban:string){
 return validateIban(iban)?normalizeIban(iban).match(/.{1,4}/g)!.join(' '):iban;
}
