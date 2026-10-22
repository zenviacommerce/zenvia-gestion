import {beforeEach,it,expect,vi} from 'vitest';
const f=vi.hoisted(()=>({workspace:'a',client:{} as any,invoke:vi.fn(),authorize:vi.fn(async()=>'synthetic-google-token')}));
vi.mock('../src/services/supabase',()=>({getActiveSupabase:()=>f.client,getActiveTenant:()=>({workspace_id:f.workspace})}));
vi.mock('../src/services/gmailSender',()=>({authorizeGmailSend:f.authorize}));
import {sendPickupReportEmail} from '../src/services/pickupReportDocuments';
const input={reportId:'00000000-0000-4000-8000-000000000001',requestId:'00000000-0000-4000-8000-000000000002',to:'driver@example.test',subject:'Recogida sintética',body:'Adjunto.',ccOwner:true};
beforeEach(()=>{f.workspace='a';f.invoke.mockReset().mockResolvedValue({data:{ok:true,status:'sent'},error:null});f.client={functions:{invoke:f.invoke}};f.authorize.mockReset().mockResolvedValue('synthetic-google-token')});
it('reuses Gmail authorization and sends report identity instead of accepting an arbitrary PDF',async()=>{expect((await sendPickupReportEmail(input)).status).toBe('sent');expect(f.authorize).toHaveBeenCalled();expect(f.invoke).toHaveBeenCalledWith('pickup-report-documents',{body:{action:'mail',...input,gmailToken:'synthetic-google-token'}})});
it('does not send anything after the workspace changes during Google authorization',async()=>{f.authorize.mockImplementationOnce(async()=>{f.workspace='b';return 'synthetic-google-token'});await expect(sendPickupReportEmail(input)).rejects.toThrow(/empresa|sesión/);expect(f.invoke).not.toHaveBeenCalled()});
