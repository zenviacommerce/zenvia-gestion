// Swift ISO 13616 registry release 103 (Sep 2026), 89 country lengths.
// Source: https://www.swift.com/resource/iban-registry-pdf (verified 2026-10-21).
// Keep TS and SQL fixtures aligned.
export const IBAN_COUNTRY_LENGTHS:Readonly<Record<string,number>>={AD:24,AE:23,AL:28,AT:20,AZ:28,BA:20,BE:16,BG:22,BH:22,BI:27,BR:29,BY:28,CH:21,CR:22,CY:28,CZ:24,DE:22,DJ:27,DK:18,DO:28,EE:20,EG:29,ES:24,FI:18,FK:18,FO:18,FR:27,GB:22,GE:22,GI:23,GL:18,GR:27,GT:28,HN:28,HR:21,HU:28,IE:22,IL:23,IQ:23,IS:26,IT:27,JO:30,KW:30,KZ:20,LB:28,LC:32,LI:21,LT:20,LU:20,LV:21,LY:25,MC:27,MD:24,ME:22,MK:19,MN:20,MR:27,MT:31,MU:30,NI:28,NL:18,NO:15,OM:23,PK:24,PL:28,PS:29,PT:25,QA:29,RO:24,RS:22,RU:33,SA:24,SC:31,SD:18,SE:24,SI:19,SK:24,SM:27,SO:23,ST:25,SV:28,TL:23,TN:24,TR:26,UA:29,VA:22,VG:24,XK:20,YE:30};
export const normalizeIban=(value?:string|null)=>String(value??'').replace(/\s/g,'').toUpperCase();
export const normalizeBic=(value?:string|null)=>String(value??'').trim().toUpperCase();
export function validateIban(value?:string|null){
 const iban=normalizeIban(value);
 if(!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(iban)||IBAN_COUNTRY_LENGTHS[iban.slice(0,2)]!==iban.length)return false;
 let remainder=0;
 for(const char of iban.slice(4)+iban.slice(0,4))for(const digit of /[A-Z]/.test(char)?String(char.charCodeAt(0)-55):char)remainder=(remainder*10+Number(digit))%97;
 return remainder===1;
}
export const validateBic=(value?:string|null)=>!normalizeBic(value)||/^[A-Z0-9]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(normalizeBic(value));
export function validateBankAccountInput(input:{alias:string;iban:string;bic?:string|null;holder?:string|null}){
 if(!input.alias.trim()||input.alias.trim().length>100)throw new Error('Indica un alias de hasta 100 caracteres para la cuenta bancaria.');
 if(!validateIban(input.iban))throw new Error('El IBAN no es válido. Revisa el país, la longitud y los dígitos de control.');
 if(!validateBic(input.bic))throw new Error('El BIC debe contener 8 u 11 caracteres válidos.');
 if((input.holder?.trim().length??0)>200)throw new Error('El titular no puede superar 200 caracteres.');
}
