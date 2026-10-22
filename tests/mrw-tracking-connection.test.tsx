import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
const invoke=vi.hoisted(()=>vi.fn());
vi.mock('../src/services/supabase',()=>({supabase:{functions:{invoke}}}));
import {MrwTrackingCredentialsNotice,MrwTrackingTestButton} from '../src/components/MrwTrackingConnection';
afterEach(()=>{cleanup();invoke.mockReset()});
it('explains that tracking uses the saved SAGEC credentials without a separate password field',()=>{
 render(<MrwTrackingCredentialsNotice/>);
 expect(screen.getByText(/mismas credenciales SAGEC/i)).toBeTruthy();
 expect(screen.queryByLabelText('Contraseña de seguimiento')).toBeNull();
 expect(screen.queryByText(/opción 4|franquicia/i)).toBeNull();
});
it('tests a saved account by id only without sending a password or shipment number',async()=>{
 invoke.mockResolvedValue({data:{ok:true,code:'MRW_TRACKING_OK',checkedAt:'2026-10-22T10:00:00Z'},error:null});const onResult=vi.fn();
 render(<MrwTrackingTestButton accountId="owned-mrw" disabled={false} onResult={onResult}/>);fireEvent.click(screen.getByRole('button',{name:'Probar seguimiento'}));
 await waitFor(()=>expect(onResult).toHaveBeenCalledWith('Seguimiento MRW: conexión correcta. No se han modificado estados de pedidos.',true));
 expect(invoke).toHaveBeenCalledWith('integration-accounts',{body:{action:'test_tracking',id:'owned-mrw'}});
});
it.each(['MRW_CREDENTIALS_REQUIRED','MRW_TRACKING_PASSWORD_REQUIRED'])('explains incomplete SAGEC credentials for %s',async(code)=>{
 invoke.mockResolvedValue({data:{ok:false,code,checkedAt:'now'},error:null});const onResult=vi.fn();
 render(<MrwTrackingTestButton accountId="owned-mrw" disabled={false} onResult={onResult}/>);fireEvent.click(screen.getByRole('button',{name:'Probar seguimiento'}));
 await waitFor(()=>expect(onResult).toHaveBeenCalledWith(expect.stringMatching(/usuario y contraseña SAGEC/i),false));expect(onResult.mock.calls[0][0]).not.toMatch(/opción 4|franquicia/i);
});
it('does not display raw endpoint errors',async()=>{
 invoke.mockRejectedValue(new Error('raw provider credentials-like content'));const onResult=vi.fn();render(<MrwTrackingTestButton accountId="owned-mrw" disabled={false} onResult={onResult}/>);fireEvent.click(screen.getByRole('button',{name:'Probar seguimiento'}));
 await waitFor(()=>expect(onResult).toHaveBeenCalledWith('No se pudo comprobar el seguimiento. Inténtalo de nuevo.',false));
});
