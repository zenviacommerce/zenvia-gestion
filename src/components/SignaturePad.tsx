import {useEffect,useId,useRef,type PointerEvent} from 'react';
import './signature-pad.css';
type Point={x:number;y:number};type Stroke=Point[];
export function SignaturePad({onChange,disabled=false}:{onChange:(value:string|null)=>void;disabled?:boolean}){
 const canvas=useRef<HTMLCanvasElement>(null),strokes=useRef<Stroke[]>([]),active=useRef(false),pointer=useRef<number|null>(null),change=useRef(onChange),locked=useRef(disabled),help=useId();change.current=onChange;locked.current=disabled;
 const ink=()=>strokes.current.reduce((sum,line)=>sum+line.slice(1).reduce((n,p,i)=>n+Math.hypot(p.x-line[i].x,p.y-line[i].y),0),0)>.03;
 const emit=()=>change.current(ink()?canvas.current!.toDataURL('image/png'):null);
 const redraw=()=>{
  const el=canvas.current,ctx=el?.getContext('2d');if(!el||!ctx)return;
  const {width,height}=el.getBoundingClientRect();if(!width||!height)return;
  const ratio=Math.min(3,Math.max(1,window.devicePixelRatio||1));if(el.width!==Math.round(width*ratio))el.width=Math.round(width*ratio);if(el.height!==Math.round(height*ratio))el.height=Math.round(height*ratio);ctx.setTransform(ratio,0,0,ratio,0,0);
  ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);ctx.strokeStyle='#172033';ctx.fillStyle='#172033';ctx.lineWidth=2.5;ctx.lineCap='round';ctx.lineJoin='round';
  for(const line of strokes.current){if(!line.length)continue;ctx.beginPath();ctx.moveTo(line[0].x*width,line[0].y*height);for(const p of line.slice(1))ctx.lineTo(p.x*width,p.y*height);ctx.stroke();if(line.length===1){ctx.beginPath();ctx.arc(line[0].x*width,line[0].y*height,1.25,0,Math.PI*2);ctx.fill()}}
 };
 useEffect(()=>{redraw();const resize=()=>{redraw();if(ink()&&!locked.current)emit()};const observer=typeof ResizeObserver!=='undefined'?new ResizeObserver(resize):null;observer?.observe(canvas.current!);window.addEventListener('resize',resize);return()=>{observer?.disconnect();window.removeEventListener('resize',resize)}},[]);
 const point=(event:PointerEvent<HTMLCanvasElement>)=>{const r=event.currentTarget.getBoundingClientRect();return {x:Math.max(0,Math.min(1,(event.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(event.clientY-r.top)/r.height))}};
 const start=(event:PointerEvent<HTMLCanvasElement>)=>{if(disabled||event.isPrimary===false||event.button!==0||active.current)return;event.preventDefault();active.current=true;pointer.current=event.pointerId;strokes.current.push([point(event)]);event.currentTarget.setPointerCapture?.(event.pointerId);redraw()};
 const move=(event:PointerEvent<HTMLCanvasElement>)=>{if(disabled||!active.current||event.pointerId!==pointer.current)return;event.preventDefault();strokes.current.at(-1)!.push(point(event));redraw()};
 const end=(event:PointerEvent<HTMLCanvasElement>,cancelled=false)=>{if(!active.current||event.pointerId!==pointer.current)return;active.current=false;pointer.current=null;if(cancelled)strokes.current.pop();else if(!disabled)strokes.current.at(-1)!.push(point(event));if(event.currentTarget.hasPointerCapture?.(event.pointerId))event.currentTarget.releasePointerCapture?.(event.pointerId);redraw();emit()};
 const clear=()=>{strokes.current=[];active.current=false;pointer.current=null;redraw();change.current(null);canvas.current?.focus({preventScroll:true})};
 return <div className="signaturePad"><p id={help}>Firma dentro del recuadro con el ratón, el dedo o un lápiz.</p><canvas ref={canvas} aria-label="Firma del conductor" aria-describedby={help} tabIndex={disabled?-1:0} aria-disabled={disabled} style={{touchAction:'none'}} onPointerDown={start} onPointerMove={move} onPointerUp={event=>end(event)} onPointerCancel={event=>end(event,true)} onLostPointerCapture={event=>end(event,true)}/><div><span>La firma quedará incorporada al PDF.</span><button className="secondary" type="button" disabled={disabled} onClick={clear}>Borrar</button></div></div>;
}
