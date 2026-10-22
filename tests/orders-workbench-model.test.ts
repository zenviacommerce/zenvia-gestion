import {expect,it} from 'vitest';
import {parseOrdersTab,ordersTabUsesPeriod,ordersTabActions,ordersTabUrl,ordersEntryPage} from '../src/services/ordersWorkbench';
it('validates deep links and supports each requested tab plus secondary all view',()=>{
 for(const tab of ['pending','labelled','shipped','issues','cancelled','reports','all'])expect(parseOrdersTab('?page=orders&tab='+tab)).toBe(tab);
 expect(parseOrdersTab('?page=orders&tab=unknown')).toBeNull();expect(parseOrdersTab('?page=dashboard&tab=pending')).toBeNull();
});
it('applies a period only to shipped and cancelled queues',()=>{
 for(const tab of ['pending','labelled','issues','reports','all'])expect(ordersTabUsesPeriod(tab as any)).toBe(false);
 expect(ordersTabUsesPeriod('shipped')).toBe(true);expect(ordersTabUsesPeriod('cancelled')).toBe(true);
});
it('makes actions contextual without weakening the selection eligibility guard',()=>{
 expect(ordersTabActions('pending')).toEqual({labels:true,pickup:false});
 expect(ordersTabActions('labelled')).toEqual({labels:false,pickup:true});
 expect(ordersTabActions('shipped')).toEqual({labels:false,pickup:true});
 for(const tab of ['issues','cancelled','reports'])expect(ordersTabActions(tab as any).labels).toBe(false);
});
it('retains unrelated URL parameters and hash in a tab link',()=>{
 expect(ordersTabUrl('https://example.test/?keep=1#anchor','issues')).toBe('/?keep=1&page=orders&tab=issues#anchor');
});

it('opens order deep links only when Orders is permitted, leaving normal entry preferences intact',()=>{
 expect(ordersEntryPage('?page=orders&tab=issues',['dashboard','orders'])).toBe('orders');
 expect(ordersEntryPage('?page=orders&tab=issues',['dashboard'])).toBeNull();
 expect(ordersEntryPage('?page=dashboard',['dashboard','orders'])).toBeNull();
});
