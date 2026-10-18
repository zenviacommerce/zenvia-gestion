import {cleanup,render,screen} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {DEFAULT_APP_SETTINGS} from '../src/services/settingsSchema';
import {OrderDrawer} from '../src/pages/Orders';
import type {FulfillmentOrder} from '../src/services/orders';
import {labelPdfFilename} from '../src/services/orderLabelFiles';
vi.mock('../src/context/SettingsContext',()=>({useSettings:()=>({settings:DEFAULT_APP_SETTINGS})}));
const order={id:'synthetic',sourceChannel:'amazon',orderNumber:'SYNTHETIC-1',sourceStatus:'unshipped',customerName:null,customerEmail:null,customerPhone:null,shippingAddress:{},billingAddress:{},items:[{name:'Synthetic item',sku:'SYN',quantity:2}],totalAmount:24,currency:'EUR',piiPurgedAt:'2026-10-16T00:00:00Z',labelPrintCount:0,labelPrintStateKnown:true} as unknown as FulfillmentOrder;
afterEach(cleanup);
function drawer(value:FulfillmentOrder){render(<OrderDrawer order={value} shippingPrice={null} validationIssues={[]} productImages={{}} onClose={()=>{}} onPrepare={()=>{}} onEdit={()=>{}} onPrint={()=>{}} onDownload={()=>{}} onInvoice={()=>{}} onConfirmShipment={()=>{}} busy={false}/>);}
describe('purged Amazon operational consumers',()=>{
 it('renders retained product and financial detail without offering shipment or recipient edits',()=>{drawer(order);expect(screen.getByText('Synthetic item')).toBeTruthy();expect(screen.getByText('24,00 €')).toBeTruthy();expect(screen.queryByText('Preparar etiqueta')).toBeNull();expect(screen.queryByText('Editar pedido')).toBeNull();expect(screen.getByText(/Datos personales eliminados/)).toBeTruthy();});
 it('does not offer retrieval of a historical label',()=>{drawer({...order,labelCreatedAt:'2026-07-01T00:00:00Z',shippingRemoteId:'synthetic-label'});expect(screen.queryByText('Descargar')).toBeNull();expect(screen.queryByText('Imprimir')).toBeNull();});
 it('keeps filename export usable without a buyer name',()=>{expect(labelPdfFilename(order,{strategy:'customer_order'})).toContain('SYNTHETIC-1');});
});
