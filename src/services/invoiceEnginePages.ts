import * as pdfjs from 'pdfjs-dist';
import worker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
pdfjs.GlobalWorkerOptions.workerSrc=worker;
export type EnginePage={number:number;text:string;image?:string};
export function htmlInvoiceText(html:string){
  const doc=new DOMParser().parseFromString(html,'text/html');
  doc.querySelectorAll('script,style,iframe,object,embed,form,svg').forEach(n=>n.remove());
  doc.querySelectorAll('br').forEach(n=>n.replaceWith('\n'));
  doc.querySelectorAll('td,th').forEach(n=>n.append('\t'));
  doc.querySelectorAll('tr,p,div,h1,h2,h3,li').forEach(n=>n.append('\n'));
  return (doc.body.textContent||'').replace(/\u00a0/g,' ').trim();
}
async function imageBlob(file:File):Promise<Blob>{
  if(/\.hei[cf]$/i.test(file.name)||/image\/hei[cf]/.test(file.type)){
    const {heicTo}=await import('heic-to');return await heicTo({blob:file,type:'image/jpeg',quality:.94}) as Blob;
  }
  return file;
}
// Projection profile deskew: choose the small angle yielding the sharpest text rows.
function skew(canvas:HTMLCanvasElement){
  const small=document.createElement('canvas');small.width=400;small.height=Math.max(1,Math.round(canvas.height*400/canvas.width));
  const ctx=small.getContext('2d',{willReadFrequently:true})!;ctx.drawImage(canvas,0,0,small.width,small.height);
  const {data}=ctx.getImageData(0,0,small.width,small.height);const points:Array<[number,number]>=[];
  for(let y=0;y<small.height;y+=2)for(let x=0;x<small.width;x+=2){const k=(y*small.width+x)*4;if(data[k]+data[k+1]+data[k+2]<300)points.push([x,y]);}
  if(points.length<100||points.length>small.width*small.height*.25)return 0;
  let best=0,score=0;
  for(let deg=-7;deg<=7;deg+=.5){const a=deg*Math.PI/180,rows=new Float64Array(small.height+100);for(const [x,y] of points){const r=Math.round(y*Math.cos(a)+x*Math.sin(a))+50;if(r>=0&&r<rows.length)rows[r]++;}const next=rows.reduce((n,v)=>n+v*v,0);if(next>score){score=next;best=deg;}}
  return best;
}
async function cleanedImage(file:File){
  const bitmap=await createImageBitmap(await imageBlob(file),{imageOrientation:'from-image'});
  const canvas=document.createElement('canvas');const ratio=Math.min(1,1800/Math.max(bitmap.width,bitmap.height));canvas.width=Math.round(bitmap.width*ratio);canvas.height=Math.round(bitmap.height*ratio);
  const ctx=canvas.getContext('2d')!;ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
  const angle=skew(canvas)*Math.PI/180;if(Math.abs(angle)>.005){const rotated=document.createElement('canvas');rotated.width=Math.ceil(canvas.width*Math.cos(angle)+canvas.height*Math.abs(Math.sin(angle)));rotated.height=Math.ceil(canvas.height*Math.cos(angle)+canvas.width*Math.abs(Math.sin(angle)));const r=rotated.getContext('2d')!;r.fillStyle='white';r.fillRect(0,0,rotated.width,rotated.height);r.translate(rotated.width/2,rotated.height/2);r.rotate(angle);r.filter='contrast(1.12)';r.drawImage(canvas,-canvas.width/2,-canvas.height/2);return rotated;}
  return canvas;
}
function jpeg(canvas:HTMLCanvasElement){let q=.88,image=canvas.toDataURL('image/jpeg',q).split(',')[1];while(image.length>1200000&&q>.35){q-=.1;image=canvas.toDataURL('image/jpeg',q).split(',')[1];}if(image.length>1250000)throw new Error('Imagen demasiado grande: reduce su resolución.');return image;}
export async function prepareEnginePages(file:File,onProgress?:(m:string)=>void):Promise<EnginePage[]>{
  if(file.size>25*1024*1024)throw new Error('El archivo supera 25 MB.');
  if(file.type==='text/html'||/\.html?$/i.test(file.name))return [{number:1,text:htmlInvoiceText(await file.text()).slice(0,80000)}];
  if(file.type.startsWith('image/')||/\.(jpe?g|png|webp|hei[cf])$/i.test(file.name))return [{number:1,text:'',image:jpeg(await cleanedImage(file))}];
  if(file.type!=='application/pdf'&&!/\.pdf$/i.test(file.name))throw new Error('Formato no admitido. Usa PDF, JPG, PNG, HEIC o WEBP.');
  const pdf=await pdfjs.getDocument({data:await file.arrayBuffer()}).promise;
  try{
    if(pdf.numPages>60)throw new Error('El PDF supera 60 páginas. Divide el archivo para importarlo.');
    const pages:EnginePage[]=[];
    for(let n=1;n<=pdf.numPages;n++){
      onProgress?.(`Preparando página ${n} de ${pdf.numPages}…`);const page=await pdf.getPage(n),v=page.getViewport({scale:1}),viewport=page.getViewport({scale:Math.min(2,1800/Math.max(v.width,v.height))});
      const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
      await page.render({canvasContext:canvas.getContext('2d')!,viewport}).promise;const text=await page.getTextContent();
      pages.push({number:n,text:text.items.map(x=>'str' in x?x.str+('hasEOL' in x&&x.hasEOL?'\n':' '):'').join('').slice(0,80000),image:jpeg(canvas)});page.cleanup();
    }
    return pages;
  }finally{await pdf.destroy();}
}
