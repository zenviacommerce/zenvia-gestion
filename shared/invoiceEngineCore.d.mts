export interface EngineLine {description:string;reference?:string;kind:'product'|'expense';unit?:string;quantity:number;unitPrice:number;discountPercent?:number;net:number;vatRate:number;vat:number;total:number;confidence?:number}
export interface EngineTax {rate:number;base:number;amount:number;exempt?:boolean}
export interface EngineDocument {supplier:{name:string;taxId?:string;address?:string;postalCode?:string;city?:string;province?:string;countryCode?:string;email?:string;phone?:string;iban?:string};type:'complete'|'simplified'|'rectification'|'credit';number:string;series?:string;issueDate:string;dueDate?:string;paymentMethod?:string;currency:string;orderNumber?:string;deliveryNoteNumber?:string;qrVerifactu?:string;qrTicketBai?:string;rectifiesNumber?:string;categoryId?:string;subtotal:number;vat:number;surcharge:number;withholding:number;withholdingRate?:number;total:number;intraCommunity?:boolean;reverseCharge?:boolean;lines:EngineLine[];taxes:EngineTax[];surcharges?:EngineTax[];confidence:Record<string,number>;pages:number[];segmentationWarning?:string;segmentationResolved?:boolean;extractionWarning?:string}
export function normalizeTaxId(value:unknown):string;
export function normalizeIdentity(value:unknown):string;
export function validSpanishTaxId(value:unknown):boolean;
export function fullInvoiceNumber(d:EngineDocument):string;
export function fingerprint(d:EngineDocument):string;
export function validateDocument(d:EngineDocument,options?:{threshold?:number;reviewed?:boolean}):{document:EngineDocument;status:'ready'|'needs_review';reasons:string[];corrections:string[];confidence:number};
export function mergeDocuments(d:EngineDocument[]):EngineDocument[];
export const documentSchema:Record<string,unknown>;
export const extractionSchema:Record<string,unknown>;
