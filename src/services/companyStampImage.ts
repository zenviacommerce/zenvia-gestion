export type StampPixels={width:number;height:number;data:Uint8ClampedArray};
/** Keep all coloured ink, including pale blue. Remove only neutral paper and
 * neutral scanner edges connected to the outside; interior black ink survives. */
export function prepareStampPixels(image:StampPixels):StampPixels {
 const {width,height}=image,data=new Uint8ClampedArray(image.data);
 const neutral=(p:number)=>Math.max(data[p],data[p+1],data[p+2])-Math.min(data[p],data[p+1],data[p+2])<12;
 const paper=(p:number)=>neutral(p)&&Math.min(data[p],data[p+1],data[p+2])>=235;
 const border=(p:number)=>neutral(p)&&Math.min(data[p],data[p+1],data[p+2])>=100;
 const visited=new Uint8Array(width*height),queue:number[]=[];
 const add=(n:number)=>{if(!visited[n]&&border(n*4)){visited[n]=1;queue.push(n)}};
 for(let x=0;x<width;x++){add(x);add((height-1)*width+x)}
 for(let y=0;y<height;y++){add(y*width);add(y*width+width-1)}
 for(let i=0;i<queue.length;i++){const n=queue[i],x=n%width,y=Math.floor(n/width);if(x)add(n-1);if(x+1<width)add(n+1);if(y)add(n-width);if(y+1<height)add(n+width)}
 let left=width,top=height,right=-1,bottom=-1;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const n=y*width+x,p=n*4;if(visited[n]||paper(p))data[p+3]=0;if(data[p+3]>0){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y)}}
 if(right<left)throw new Error('No se ha detectado tinta en el sello.');
 // Small transparent padding keeps antialiased outer strokes clear of the PDF frame.
 const padding=Math.max(1,Math.round(Math.max(right-left+1,bottom-top+1)*0.02));
 const resultWidth=right-left+1+padding*2,resultHeight=bottom-top+1+padding*2,result=new Uint8ClampedArray(resultWidth*resultHeight*4);
 for(let y=top;y<=bottom;y++)for(let x=left;x<=right;x++)result.set(data.subarray((y*width+x)*4,(y*width+x)*4+4),((y-top+padding)*resultWidth+x-left+padding)*4);
 return {width:resultWidth,height:resultHeight,data:result};
}

export async function prepareCompanyStamp(file:Blob):Promise<Blob>{
 const url=URL.createObjectURL(file);
 try{
  const image=new Image();await new Promise<void>((resolve,reject)=>{image.onload=()=>resolve();image.onerror=()=>reject(new Error('No se pudo leer el sello.'));image.src=url});
  if(image.naturalWidth*image.naturalHeight>24_000_000)throw new Error('El sello tiene demasiada resolución (máximo 24 megapíxeles).');
  const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
  const context=canvas.getContext('2d');if(!context)throw new Error('No se pudo preparar el sello.');
  context.drawImage(image,0,0);const pixels=prepareStampPixels(context.getImageData(0,0,canvas.width,canvas.height));
  canvas.width=pixels.width;canvas.height=pixels.height;
  const output=context.createImageData(pixels.width,pixels.height);output.data.set(pixels.data);context.putImageData(output,0,0);
  return await new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('No se pudo preparar el sello.')),'image/png'));
 }finally{URL.revokeObjectURL(url)}
}
