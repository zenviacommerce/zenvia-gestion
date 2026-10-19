import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import {ShippingProviderStatus} from '../src/components/ShippingProviderStatus';
afterEach(cleanup);
it('keeps every provider visible and retries only the failed provider',()=>{
 const retry=vi.fn();
 const view=render(<ShippingProviderStatus states={{sendcloud:{state:'ready',options:['one','two'],message:''},envia:{state:'loading',options:[],message:''},mrw:{state:'error',options:[],message:'HTTP 500'}}} onRetry={retry}/>);
 expect(screen.getByText('2 opciones')).toBeTruthy();expect(screen.getByText('Cargando…')).toBeTruthy();expect(screen.getByText('Error · HTTP 500')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Reintentar MRW directo'}));expect(retry).toHaveBeenCalledWith('mrw');
 view.rerender(<ShippingProviderStatus states={{sendcloud:{state:'not_applicable',options:[],message:'No conectado'}}} onRetry={retry}/>);
 expect(screen.getByText('No aplica: No conectado')).toBeTruthy();expect(screen.getByText('Envia.com')).toBeTruthy();expect(screen.getByText('MRW directo')).toBeTruthy();
});
