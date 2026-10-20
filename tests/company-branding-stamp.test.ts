import {beforeEach,expect,it,vi} from 'vitest';
const s=vi.hoisted(()=>({businessOwner:true,brandingOwner:true,row:{owner_id:'owner',logo_path:null,stamp_path:'owner/branding/stamp-1.png'},download:vi.fn(),saved:vi.fn(),removed:vi.fn()}));
vi.mock('../src/services/supabase',()=>{const client={auth:{getUser:async()=>({data:{user:{id:'member'}}})},from:(table:string)=>({select:()=>({maybeSingle:async()=>({data:table==='business_settings'?(s.businessOwner?{owner_id:'owner'}:null):(s.brandingOwner?s.row:null)}),eq:()=>({maybeSingle:async()=>({data:table==='app_users'?{data_owner_id:'owner'}:(s.brandingOwner?s.row:null)})})}),upsert:async(value:unknown)=>{s.saved(value);return {error:null}}}),storage:{from:()=>({download:s.download,remove:s.removed})}};return {supabase:client,getActiveSupabase:()=>client,getActiveTenant:()=>({workspace_id:'workspace'})}});
import {loadCompanyBranding,removeCompanyStamp,validateCompanyStamp} from '../src/services/companyBranding';
beforeEach(()=>{s.businessOwner=true;s.brandingOwner=true;s.download.mockReset();s.saved.mockReset();s.removed.mockResolvedValue({error:null})});
it('retains the stamp path but returns a printable empty stamp when private storage fails',async()=>{
 s.download.mockResolvedValue({data:null,error:new Error('unavailable')});const branding=await loadCompanyBranding();expect(branding.stampPath).toBe(s.row.stamp_path);expect(branding.stampDataUrl).toBeNull();
});
it('removes stamp metadata without overwriting the existing logo',async()=>{
 await removeCompanyStamp(s.row.stamp_path);expect(s.saved.mock.calls[0][0]).toMatchObject({owner_id:'owner',stamp_path:null});expect(s.saved.mock.calls[0][0]).not.toHaveProperty('logo_path');
});
it('accepts only PNG/JPG stamp uploads up to 5MB',()=>{expect(()=>validateCompanyStamp(new File(['x'],'stamp.webp',{type:'image/webp'}))).toThrow('PNG o JPG');expect(()=>validateCompanyStamp(new File(['x'],'stamp.jpg',{type:'image/jpeg'}))).not.toThrow()});

it('resolves an orders-only member through RLS-filtered company branding when business settings are hidden',async()=>{s.businessOwner=false;s.download.mockResolvedValue({data:null,error:new Error('unavailable')});const branding=await loadCompanyBranding();expect(branding.ownerId).toBe('owner');expect(branding.stampPath).toBe(s.row.stamp_path)});

it('resolves the first stamp owner from the member app_users record when no settings or branding row exists',async()=>{s.businessOwner=false;s.brandingOwner=false;s.download.mockResolvedValue({data:null,error:new Error('unavailable')});const branding=await loadCompanyBranding();expect(branding.ownerId).toBe('owner');expect(branding.stampPath).toBeNull();expect(s.download).not.toHaveBeenCalled()});
