import {postalRegion} from './postalLookup';
const clean=(value:unknown)=>typeof value==='string'?value.trim():'';
export function orderProvinceName(address:Record<string,unknown>){
 const savedName=clean(address.state_province_name);if(savedName)return savedName;
 const country=clean(address.country_code).toUpperCase(),postal=clean(address.postal_code);
 const fallback=clean(address.state_province_name)||clean(address.state_province_code);
 return country==='ES'&&/^\d{5}$/.test(postal)?postalRegion(country,postal,fallback):fallback;
}
export function orderProvinceCode(address:Record<string,unknown>,displayedName:string){
 return displayedName.trim()===orderProvinceName(address)?clean(address.state_province_code)||displayedName.trim():displayedName.trim();
}
