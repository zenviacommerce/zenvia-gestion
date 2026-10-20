import {cleanup,render,screen} from '@testing-library/react';
import {afterEach,expect,it} from 'vitest';
import {KpiGrid} from '../src/components/KpiGrid';
import {StatCard} from '../src/components/StatCard';
afterEach(cleanup);
for(const [count,normal,wide] of [[7,4,4],[5,3,5],[12,4,6],[3,3,3]])it(`balances ${count} cards without changing their information or variants`,()=>{
 render(<KpiGrid label="Balance" dense>{Array.from({length:count},(_,i)=><StatCard key={i} label={`KPI ${i}`} value={i} icon={<span/>} variant={i===0?'warning':'default'}/>)}</KpiGrid>);
 const grid=screen.getByRole('group',{name:'Balance'});
 expect(grid.style.getPropertyValue('--kpi-columns')).toBe(String(normal));
 expect(grid.style.getPropertyValue('--kpi-columns-wide')).toBe(String(wide));
 expect(grid.querySelectorAll('.stat')).toHaveLength(count);
 expect(screen.getByText('KPI 0').closest('.stat')?.classList.contains('dashboardPendingOrders')).toBe(true);
});
