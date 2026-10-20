import {expect,it} from 'vitest';
import {countLabel} from '../src/services/pluralization';
it.each([[0,'0 reembolsos'],[1,'1 reembolso'],[2,'2 reembolsos'],[1234,'1234 reembolsos']])('formats refund count %s without changing its number',(n,label)=>expect(countLabel(n as number,'reembolso','reembolsos')).toBe(label));
it('uses explicit Spanish plurals for options and service phrases',()=>{
 expect(countLabel(1,'opción','opciones')).toBe('1 opción');
 expect(countLabel(2,'opción','opciones')).toBe('2 opciones');
 expect(countLabel(1,'servicio detectado automáticamente.','servicios detectados automáticamente.')).toBe('1 servicio detectado automáticamente.');
});
