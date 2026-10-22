import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {Tabs as PageTabs} from '@zenvia/ui';
afterEach(cleanup);
it('uses horizontal arrow navigation on desktop and preserves focus when an async guard cancels',async()=>{
 const change=vi.fn(async()=>false);render(<PageTabs label="Ajustes" value="general" onChange={change} items={[{id:'general',label:'General'},{id:'preferences',label:'Preferencias'}]}/>);
 expect(screen.getByRole('tablist').getAttribute('aria-orientation')).toBe('horizontal');
 const general=screen.getByRole('tab',{name:'General'});general.focus();fireEvent.keyDown(general,{key:'ArrowRight'});
 await waitFor(()=>expect(change).toHaveBeenCalledWith('preferences'));expect(document.activeElement).toBe(general);
});
it('uses horizontal orientation below the responsive breakpoint',()=>{
 const previous=window.innerWidth;Object.defineProperty(window,'innerWidth',{value:390,configurable:true});
 render(<PageTabs label="Ajustes" value="general" onChange={()=>{}} items={[{id:'general',label:'General'}]}/>);
 expect(screen.getByRole('tablist').getAttribute('aria-orientation')).toBe('horizontal');Object.defineProperty(window,'innerWidth',{value:previous,configurable:true});
});
