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
it('renders singular for one option and plural for multiple options',()=>{
 render(<ShippingProviderStatus states={{sendcloud:{state:'ready',options:['one'],message:''},envia:{state:'ready',options:['one','two'],message:''}}} onRetry={()=>{}}/>);
 expect(screen.getByText('1 opción')).toBeTruthy();expect(screen.getByText('2 opciones')).toBeTruthy();expect(screen.queryByText('1 opciones')).toBeNull();
});
it('shows route exclusions without Retry and keeps Retry only for temporary failures',()=>{
 const retry=vi.fn();render(<ShippingProviderStatus states={{envia:{state:'ready',options:['good'],message:'2 transportistas no aplicables a esta ruta.',diagnostics:['No aplica a esta ruta · DHL · Solo origen Madrid','No aplica a esta ruta · Cainiao · Sin cobertura'],retryable:false},mrw:{state:'error',options:[],message:'HTTP 401',retryable:false},sendcloud:{state:'partial',options:['good'],message:'HTTP 503',retryable:true}}} onRetry={retry}/>);
 expect(screen.getByText(/No aplica a esta ruta · DHL · Solo origen Madrid/)).toBeTruthy();expect(screen.queryByRole('button',{name:'Reintentar Envia.com'})).toBeNull();expect(screen.queryByRole('button',{name:'Reintentar MRW directo'})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Reintentar Sendcloud'}));expect(retry).toHaveBeenCalledWith('sendcloud');
});
