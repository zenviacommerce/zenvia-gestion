export type AmazonAppKey='private_v1'|'public_v1';
export function readAmazonLwaApplication(appKey:AmazonAppKey,envGet:(name:string)=>string|undefined):{clientId:string;clientSecret:string}{
  if(appKey!=='private_v1'&&appKey!=='public_v1')throw new Error('Aplicación Amazon no válida.');
  const prefix=appKey==='private_v1'?'AMAZON_SPAPI_PRIVATE_V1':'AMAZON_SPAPI_PUBLIC_V1';
  const clientId=String(envGet(`${prefix}_CLIENT_ID`)||'').trim();
  const clientSecret=String(envGet(`${prefix}_CLIENT_SECRET`)||'').trim();
  if(!clientId||!clientSecret)throw new Error('La aplicación Amazon no está configurada.');
  return {clientId,clientSecret};
}
