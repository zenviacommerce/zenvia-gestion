import {WebPDecoder} from './vendor/WebPDecoder.js';
/** jsPDF 2.5.1 converts WebP RGBA to JPEG without compositing alpha.
 * Use its pinned decoder directly and flatten onto the white PDF page instead.
 * PNG/JPEG keep the native jsPDF path; no canvas, network or stored-asset mutation.
 */
/** @param {any} doc @param {string} dataUrl */
export function pickupPdfImage(doc,dataUrl){
 if(/^data:image\/webp;base64,/i.test(dataUrl)){
  const raw=atob(dataUrl.slice(dataUrl.indexOf(',')+1));
  const decoder=new WebPDecoder(Uint8Array.from(raw,char=>char.charCodeAt(0)));
  const width=Number(decoder.width[0]),height=Number(decoder.height[0]),pixels=decoder.getData();
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||pixels.length!==width*height*4)throw Error('PICKUP_INVALID_IMAGE');
  const data=new Uint8ClampedArray(pixels.length);
  for(let i=0;i<pixels.length;i+=4){const alpha=pixels[i+3]/255;for(let channel=0;channel<3;channel++)data[i+channel]=Math.round(pixels[i+channel]*alpha+255*(1-alpha));data[i+3]=255;}
  return{data:{data,width,height},format:'RGBA',width,height};
 }
 const properties=doc.getImageProperties(dataUrl);
 return{data:dataUrl,format:properties.fileType,width:properties.width,height:properties.height};
}
