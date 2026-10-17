import {expect,it} from 'vitest';
import {publishOrdersSnapshot,resetOrdersSnapshot,readOrdersSnapshot} from '../src/services/ordersSnapshot';
import type {FulfillmentOrder} from '../src/services/orders';
it('does not persist operational buyer data in browser session storage',()=>{resetOrdersSnapshot();publishOrdersSnapshot([{id:'synthetic',customerName:'SYNTHETIC BUYER'} as FulfillmentOrder]);expect(window.sessionStorage.getItem('zenvia-view-cache:dashboard:orders')).toBeNull();expect(readOrdersSnapshot()).toHaveLength(1);});
