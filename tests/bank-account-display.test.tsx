import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {BankAccountSelect,BankAccountSnapshotView} from '../src/components/BankAccountSelect';
import {formatBankAccountIban} from '../src/components/bankAccountDisplay';
import type {BusinessBankAccount} from '../src/services/businessBankAccounts';
afterEach(cleanup);
const accounts=[{id:'a',alias:'Principal',iban:'ES9121000418450200051332',validationStatus:'valid',archivedAt:null,isDefault:true},{id:'b',alias:'Ventas',iban:'DE89370400440532013000',validationStatus:'valid',archivedAt:null,isDefault:false}] as BusinessBankAccount[];
it('groups valid IBAN for presentation and leaves invalid legacy text intact',()=>{
 expect(formatBankAccountIban('es91 2100 0418 4502 0005 1332')).toBe('ES91 2100 0418 4502 0005 1332');expect(formatBankAccountIban('LEGADO INVÁLIDO')).toBe('LEGADO INVÁLIDO');expect(formatBankAccountIban('ES000000')).toBe('ES000000');
});
it('shows grouped account choices while selecting the stable account ID',async()=>{
 const choose=vi.fn();render(<BankAccountSelect accounts={accounts} value="a" onChange={choose}/>);const control=screen.getByRole('combobox',{name:'Cuenta bancaria'});expect(control.textContent).toContain('ES91 2100 0418 4502 0005 1332');fireEvent.click(control);fireEvent.click(await screen.findByRole('option',{name:'Ventas · DE89 3704 0044 0532 0130 00'}));expect(choose).toHaveBeenCalledWith('b');expect(accounts[0].iban).toBe('ES9121000418450200051332');
});
it('keeps the historical snapshot presentation literal and read only',()=>{
 render(<BankAccountSnapshotView snapshot={{version:1,accountId:'a',alias:'Histórica',iban:'ES9121000418450200051332',bic:null,holder:null}} source="receipt_created"/>);expect(screen.getByText('ES9121000418450200051332')).toBeTruthy();expect(screen.queryByRole('combobox')).toBeNull();
});
