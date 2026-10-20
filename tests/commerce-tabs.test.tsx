import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {PageTabs} from '../src/components/PageTabs';
afterEach(cleanup);
it('retains analytics tab badges and keyboard navigation in the shared tabs',()=>{
 const changed=vi.fn();render(<PageTabs label="Analytics" value="summary" onChange={changed} className="commerceTabs" panelId="analytics-panel" items={[{id:'summary',label:'Resumen'},{id:'unmapped',label:'Sin vincular',badge:<span>3</span>}]}/>);
 expect(screen.getByRole('tab',{name:'Sin vincular 3'})).toBeTruthy();
 expect(screen.getByRole('tab',{name:'Resumen'}).getAttribute('aria-controls')).toBe('analytics-panel');
 expect(screen.getByRole('tab',{name:'Resumen'}).id).toBe('analytics-panel-tab-summary');
 fireEvent.keyDown(screen.getByRole('tab',{name:'Resumen'}),{key:'ArrowRight'});expect(changed).toHaveBeenCalledWith('unmapped');
 expect(document.activeElement).toBe(screen.getByRole('tab',{name:'Sin vincular 3'}));
});
