import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
const invoke=vi.hoisted(()=>vi.fn());
vi.mock('../src/services/supabase',()=>({supabase:{functions:{invoke}}}));
import {MrwTrackingPasswordField,MrwTrackingTestButton} from '../src/components/MrwTrackingConnection';
afterEach(()=>{cleanup();invoke.mockReset()});
it('uses a dedicated masked tracking field and explains franchise activation',()=>{
 const change=vi.fn();render(<MrwTrackingPasswordField value="" editing onChange={change}/>);
 const input=screen.getByLabelText('Contraseña de seguimiento');expect(input.getAttribute('type')).toBe('password');expect(input.getAttribute('autocomplete')).toBe('new-password');
 expect(screen.getByText(/opción 4/i)).toBeTruthy();expect(screen.getByText(/SAGEC/i)).toBeTruthy();fireEvent.change(input,{target:{value:'synthetic-test-only'}});expect(change).toHaveBeenCalledWith('synthetic-test-only');
});
it('tests a saved account by id only without sending a password or shipment number',async()=>{
 invoke.mockResolvedValue({data:{ok:true,code:'MRW_TRACKING_OK',checkedAt:'2026-10-22T10:00:00Z'},error:null});const onResult=vi.fn();
 render(<MrwTrackingTestButton accountId="owned-mrw" disabled={false} onResult={onResult}/>);fireEvent.click(screen.getByRole('button',{name:'Probar seguimiento'}));
 await waitFor(()=>expect(onResult).toHaveBeenCalledWith('Seguimiento MRW: conexión correcta. No se han modificado estados de pedidos.',true));
 expect(invoke).toHaveBeenCalledWith('integration-accounts',{body:{action:'test_tracking',id:'owned-mrw'}});
});
it('explains missing tracking access while allowing shipping to continue',async()=>{
 invoke.mockResolvedValue({data:{ok:false,code:'MRW_TRACKING_PASSWORD_REQUIRED',checkedAt:'now'},error:null});const onResult=vi.fn();
 render(<MrwTrackingTestButton accountId="owned-mrw" disabled={false} onResult={onResult}/>);fireEvent.click(screen.getByRole('button',{name:'Probar seguimiento'}));
 await waitFor(()=>expect(onResult).toHaveBeenCalledWith(expect.stringMatching(/franquicia.*opción 4/i),false));expect(onResult.mock.calls[0][0]).toMatch(/etiquetas/i);
});
it('does not display raw endpoint errors',async()=>{
 invoke.mockRejectedValue(new Error('raw provider credentials-like content'));const onResult=vi.fn();render(<MrwTrackingTestButton accountId="owned-mrw" disabled={false} onResult={onResult}/>);fireEvent.click(screen.getByRole('button',{name:'Probar seguimiento'}));
 await waitFor(()=>expect(onResult).toHaveBeenCalledWith('No se pudo comprobar el seguimiento. Inténtalo de nuevo.',false));
});
