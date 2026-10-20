import {expect,it} from 'vitest';
import {prepareStampPixels} from '../src/services/companyStampImage';
it('crops neutral scanner border and paper while retaining faint blue ink and transparency',()=>{
 const width=12,height=10,data=new Uint8ClampedArray(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const p=(y*width+x)*4;data.set(x===0||y===0||x===11||y===9?[160,160,160,255]:[255,255,255,255],p)}
 data.set([25,70,180,255],(4*width+4)*4);data.set([210,220,245,255],(5*width+7)*4);
 const result=prepareStampPixels({width,height,data});
 expect(result.width).toBeLessThan(width);expect(result.height).toBeLessThan(height);
 const pixels=Array.from({length:result.data.length/4},(_,i)=>Array.from(result.data.slice(i*4,i*4+4)));
 expect(pixels).toContainEqual([25,70,180,255]);expect(pixels).toContainEqual([210,220,245,255]);expect(pixels.some(p=>p[3]===0)).toBe(true);expect(pixels.some(p=>p[0]===160)).toBe(false);
});
it('retains black ink on white paper and rejects a blank image',()=>{
 const data=new Uint8ClampedArray(8*8*4).fill(255);data.set([15,15,15,255],(3*8+3)*4);
 expect(prepareStampPixels({width:8,height:8,data}).data.some((v,i)=>i%4===0&&v===15)).toBe(true);
 expect(()=>prepareStampPixels({width:8,height:8,data:new Uint8ClampedArray(8*8*4).fill(255)})).toThrow('tinta');
});
