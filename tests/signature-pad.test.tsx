import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {SignaturePad} from '../src/components/SignaturePad';
const context={setTransform:vi.fn(),clearRect:vi.fn(),fillRect:vi.fn(),beginPath:vi.fn(),moveTo:vi.fn(),lineTo:vi.fn(),stroke:vi.fn(),arc:vi.fn(),fill:vi.fn()};
beforeEach(()=>{
 vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(context as any);vi.spyOn(HTMLCanvasElement.prototype,'toDataURL').mockReturnValue('data:image/png;base64,SYNTHETIC');
 Object.defineProperty(window,'devicePixelRatio',{value:2,configurable:true});
 vi.spyOn(HTMLCanvasElement.prototype,'getBoundingClientRect').mockReturnValue({width:300,height:180,left:10,top:20,right:310,bottom:200,x:10,y:20,toJSON(){}});
 window.PointerEvent=MouseEvent as any;
});
afterEach(()=>{cleanup();vi.restoreAllMocks()});
it('draws at retina resolution, emits ink only after a stroke and clears it',()=>{
 const change=vi.fn();render(<SignaturePad onChange={change}/>);const canvas=screen.getByLabelText('Firma del conductor') as HTMLCanvasElement;
 expect(canvas.width).toBe(600);expect(canvas.height).toBe(360);
 fireEvent.pointerDown(canvas,{clientX:30,clientY:50,button:0});fireEvent.pointerMove(canvas,{clientX:140,clientY:90,button:0});fireEvent.pointerUp(canvas,{clientX:150,clientY:90,button:0});
 expect(context.lineTo).toHaveBeenCalled();expect(change).toHaveBeenLastCalledWith('data:image/png;base64,SYNTHETIC');
 fireEvent.click(screen.getByRole('button',{name:'Borrar'}));expect(change).toHaveBeenLastCalledWith(null);
});
it('never accepts an accidental tap or a disabled stroke as a signature',()=>{
 const change=vi.fn();const view=render(<SignaturePad onChange={change}/>);const canvas=screen.getByLabelText('Firma del conductor');
 fireEvent.pointerDown(canvas,{clientX:30,clientY:50,button:0});fireEvent.pointerUp(canvas,{clientX:30,clientY:50,button:0});expect(change).not.toHaveBeenCalledWith(expect.any(String));
 view.rerender(<SignaturePad onChange={change} disabled/>);fireEvent.pointerDown(canvas,{clientX:30,clientY:50,button:0});fireEvent.pointerMove(canvas,{clientX:140,clientY:90,button:0});fireEvent.pointerUp(canvas);expect(change).not.toHaveBeenCalledWith(expect.any(String));
});
it('redraws but never replaces the submitted PNG when a disabled canvas resizes',()=>{const change=vi.fn(),view=render(<SignaturePad onChange={change}/>);const canvas=screen.getByLabelText('Firma del conductor');fireEvent.pointerDown(canvas,{clientX:30,clientY:50,button:0});fireEvent.pointerMove(canvas,{clientX:140,clientY:90,button:0});fireEvent.pointerUp(canvas,{clientX:150,clientY:90,button:0});expect(change).toHaveBeenCalledWith(expect.any(String));view.rerender(<SignaturePad onChange={change} disabled/>);change.mockClear();fireEvent(window,new Event('resize'));expect(change).not.toHaveBeenCalled()});
