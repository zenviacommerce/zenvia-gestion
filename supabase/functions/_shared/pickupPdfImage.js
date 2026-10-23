import {WebPDecoder} from './vendor/WebPDecoder.js';
const documents=new WeakMap();
/** jsPDF 2.5.1 converts WebP RGBA to JPEG without compositing alpha.
 * Use its pinned decoder directly and flatten onto the white PDF page instead.
 * PNG/JPEG keep the native jsPDF path; no canvas, network or stored-asset mutation.
 */
/** @param {any} doc @param {string} dataUrl */
export function pickupPdfImage(doc,dataUrl){
 let cache=documents.get(doc);if(!cache){cache=new Map();documents.set(doc,cache)}
 if(cache.has(dataUrl))return cache.get(dataUrl);
 const save=image=>{if(image.width*image.height>8_000_000)throw Error('PICKUP_IMAGE_TOO_LARGE');const result={...image,alias:'pickup-image-'+cache.size};cache.set(dataUrl,result);return result};
 if(/^data:image\/png;base64,/i.test(dataUrl)){
  const raw=atob(dataUrl.slice(dataUrl.indexOf(',')+1,dataUrl.indexOf(',')+1+44));
  const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));if(bytes.length<24||bytes[0]!==137||bytes[1]!==80||String.fromCharCode(...bytes.slice(12,16))!=='IHDR')throw Error('PICKUP_INVALID_IMAGE');
  const view=new DataView(bytes.buffer),width=view.getUint32(16),height=view.getUint32(20);if(!width||!height)throw Error('PICKUP_INVALID_IMAGE');return save({data:dataUrl,format:'PNG',width,height});
 }
 if(/^data:image\/webp;base64,/i.test(dataUrl)){
  const raw=atob(dataUrl.slice(dataUrl.indexOf(',')+1));
  const bytes=Uint8Array.from(raw,char=>char.charCodeAt(0));
  // The vendor constructor decodes immediately: reject oversized/unknown headers first.
  const four=(offset)=>String.fromCharCode(...bytes.slice(offset,offset+4));
  if(bytes.length<25||four(0)!=='RIFF'||four(8)!=='WEBP')throw Error('PICKUP_INVALID_IMAGE');
  const view=new DataView(bytes.buffer),end=view.getUint32(4,true)+8;
  if(end!==bytes.length)throw Error('PICKUP_INVALID_IMAGE');
  let canvas=null,frame=null;
  const checked=(width,height)=>{if(!width||!height)throw Error('PICKUP_INVALID_IMAGE');if(width*height>8_000_000)throw Error('PICKUP_IMAGE_TOO_LARGE');return{width,height}};
  for(let offset=12;offset<end;){
   if(offset+8>end)throw Error('PICKUP_INVALID_IMAGE');
   const kind=four(offset),size=view.getUint32(offset+4,true),data=offset+8,next=data+size+(size&1);
   if(next>end)throw Error('PICKUP_INVALID_IMAGE');
   if(kind==='ANIM'||kind==='ANMF')throw Error('PICKUP_INVALID_IMAGE');
   if(kind==='VP8X'){
    if(canvas||frame||size!==10||(bytes[data]&2))throw Error('PICKUP_INVALID_IMAGE');
    canvas=checked(1+bytes[data+4]+bytes[data+5]*256+bytes[data+6]*65536,1+bytes[data+7]+bytes[data+8]*256+bytes[data+9]*65536);
   }else if(kind==='VP8L'||kind==='VP8 '){
    if(frame)throw Error('PICKUP_INVALID_IMAGE');
    if(kind==='VP8L'){if(size<5||bytes[data]!==0x2f)throw Error('PICKUP_INVALID_IMAGE');const bits=view.getUint32(data+1,true);frame=checked(1+(bits&0x3fff),1+((bits>>>14)&0x3fff));}
    else{if(size<10||bytes[data]&1||bytes[data+3]!==0x9d||bytes[data+4]!==1||bytes[data+5]!==0x2a)throw Error('PICKUP_INVALID_IMAGE');frame=checked(view.getUint16(data+6,true)&0x3fff,view.getUint16(data+8,true)&0x3fff);}
   }
   offset=next;
  }
  if(!frame||canvas&&(canvas.width!==frame.width||canvas.height!==frame.height))throw Error('PICKUP_INVALID_IMAGE');
  const preWidth=frame.width,preHeight=frame.height;
  const decoder=new WebPDecoder(bytes);
  const width=Number(decoder.width[0]),height=Number(decoder.height[0]);if(width!==preWidth||height!==preHeight)throw Error('PICKUP_INVALID_IMAGE');if(width*height>8_000_000)throw Error('PICKUP_IMAGE_TOO_LARGE');const pixels=decoder.getData();
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||pixels.length!==width*height*4)throw Error('PICKUP_INVALID_IMAGE');
  const data=new Uint8ClampedArray(pixels.length);
  for(let i=0;i<pixels.length;i+=4){const alpha=pixels[i+3]/255;for(let channel=0;channel<3;channel++)data[i+channel]=Math.round(pixels[i+channel]*alpha+255*(1-alpha));data[i+3]=255;}
  return save({data:{data,width,height},format:'RGBA',width,height});
 }
 const properties=doc.getImageProperties(dataUrl);
 return save({data:dataUrl,format:properties.fileType,width:properties.width,height:properties.height});
}
