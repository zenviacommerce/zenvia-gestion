import {cleanup,render,screen} from '@testing-library/react';
import {afterEach,expect,it} from 'vitest';
import {OrderProductLines} from '../src/components/OrderProductLines';
afterEach(cleanup);
it('renders each visible product with its own quantity using the same element and class',()=>{
 const {container}=render(<OrderProductLines lines={[{name:'Bolsa 10x20',quantity:3},{name:'Bolsa 15x30',quantity:4},{name:'Film',quantity:1}]}/>);
 expect(screen.getByLabelText('Bolsa 10x20 ×3')).toBeTruthy();expect(screen.getByLabelText('Bolsa 15x30 ×4')).toBeTruthy();expect(screen.getByLabelText('Film ×1')).toBeTruthy();
 const rows=[...container.querySelectorAll('.ordersProductLine')];expect(rows).toHaveLength(3);expect(new Set(rows.map(r=>r.tagName+':'+r.className)).size).toBe(1);
});
it('limits many items and exposes the complete remainder without treating visible rows as secondary',()=>{
 const {container}=render(<OrderProductLines lines={Array.from({length:5},(_,i)=>({name:'Producto '+(i+1),quantity:i+1}))}/>);
 expect(container.querySelectorAll('.ordersProductLine')).toHaveLength(3);expect(screen.getByText('+2 más').getAttribute('title')).toBe('Producto 4 ×4\nProducto 5 ×5');
});
