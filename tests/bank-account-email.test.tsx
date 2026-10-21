import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {SendInvoiceModal} from '../src/components/SendInvoiceModal';
import {DEFAULT_APP_SETTINGS} from '../src/services/settingsSchema';
const api=vi.hoisted(()=>({send:vi.fn(),mark:vi.fn()}));
vi.mock('../src/services/gmailSender',()=>({sendInvoiceViaGmail:(...args:any[])=>api.send(...args)}));
vi.mock('../src/services/sales',()=>({markSalesInvoiceSent:(...args:any[])=>api.mark(...args)}));
vi.mock('../src/context/SettingsContext',()=>({useSettings:()=>({settings:DEFAULT_APP_SETTINGS})}));
vi.mock('../src/services/toast',()=>({showSuccess:vi.fn(),errorMessage:(_e:any,fallback:string)=>fallback}));
afterEach(()=>{cleanup();vi.clearAllMocks()});
const bank={version:1 as const,accountId:'b',alias:'Ventas',iban:'DE89370400440532013000',bic:'COBADEFFXXX',holder:'Empresa prueba'};
const invoice:any={id:'fixture',clientName:'Cliente prueba',clientEmail:'test@example.test',status:'issued',invoiceNumber:'TEST-1',invoiceType:'standard',issueDate:'2026-10-21',currency:'EUR',subtotal:10,discountAmount:0,taxAmount:2.1,totalAmount:12.1,lines:[],payments:[],paidAmount:0,issuerName:'Empresa prueba',bankAccountSnapshot:bank,bankSnapshotSource:'issued'};
const settings:any={legalName:'Empresa prueba',iban:'ES9121000418450200051332'};
const text=(blob:Blob)=>new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result));r.onerror=reject;r.readAsText(blob)});
describe('invoice email uses the frozen bank',()=>{
 it('shows and attaches the same selected bank through a mocked delivery boundary',async()=>{
  api.send.mockResolvedValue(undefined);api.mark.mockResolvedValue(undefined);
  render(<SendInvoiceModal invoice={invoice} settings={settings} onClose={()=>{}} onSent={async()=>{}}/>);
  const body=screen.getByLabelText('Mensaje') as HTMLTextAreaElement;
  expect(body.value).toContain(bank.iban);expect(body.value).not.toContain(settings.iban);
  fireEvent.click(screen.getByRole('button',{name:'Enviar factura',exact:true}));
  await waitFor(()=>expect(api.send).toHaveBeenCalledTimes(1));
  const payload=api.send.mock.calls[0][0];expect(payload.body).toContain(bank.iban);expect(payload.body).toContain(bank.bic);
  const pdf=await text(payload.pdf);expect(pdf).toContain(bank.iban);expect(pdf).not.toContain(settings.iban);
  expect(api.mark).toHaveBeenCalledWith('fixture');
 });
 it('keeps missing legacy banks absent from the composed email',()=>{
  render(<SendInvoiceModal invoice={{...invoice,bankAccountSnapshot:null,bankSnapshotSource:'legacy_missing'}} settings={settings} onClose={()=>{}} onSent={async()=>{}}/>);
  expect((screen.getByLabelText('Mensaje') as HTMLTextAreaElement).value).not.toContain('IBAN');
 });
});
