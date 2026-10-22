import {expect,it} from 'vitest';
import {resumeMrwTrackingAfterCredentialSave} from '../supabase/functions/_shared/tracking/credentialResume';
function fixture(){
 const rows:Record<string,any[]>={shipment_tracking_account_health:[{account_id:'mrw',owner_id:'owner',provider:'mrw',last_error:'MRW_TRACKING_PASSWORD_REQUIRED',paused_until:'later'},{account_id:'other',owner_id:'owner',provider:'mrw',last_error:'MRW_TRACKING_PASSWORD_REQUIRED',paused_until:'later'}],shipment_tracking_state:[
 {account_id:'mrw',owner_id:'owner',provider:'mrw',normalized_state:null,next_poll_at:'later',last_error:'MRW_TRACKING_PASSWORD_REQUIRED'},
 {account_id:'mrw',owner_id:'owner',provider:'mrw',normalized_state:'in_transit',next_poll_at:'later',last_error:'ACCOUNT_PAUSED'},
 {account_id:'mrw',owner_id:'owner',provider:'mrw',normalized_state:'delivered',next_poll_at:null,last_error:null},
 {account_id:'other',owner_id:'owner',provider:'mrw',normalized_state:null,next_poll_at:'later',last_error:'MRW_TRACKING_PASSWORD_REQUIRED'},
 {account_id:'mrw',owner_id:'different',provider:'mrw',normalized_state:null,next_poll_at:'later',last_error:'MRW_TRACKING_PASSWORD_REQUIRED'},
 {account_id:'mrw',owner_id:'owner',provider:'mrw',normalized_state:'exception',next_poll_at:'later',last_error:'MRW_CREDENTIALS_REJECTED'}]};
 return {rows,from(table:string){let patch:any;const predicates:Array<(r:any)=>boolean>=[];const q:any={update(p:any){patch=p;return q},eq(k:string,v:any){predicates.push(r=>r[k]===v);return q},in(k:string,v:any[]){predicates.push(r=>v.includes(r[k]));return q},not(k:string,op:string,v:any){predicates.push(r=>op==='is'?r[k]!==v:!['delivered','returned','cancelled'].includes(r[k]));return q},or(){predicates.push(r=>!['delivered','returned','cancelled'].includes(r.normalized_state));return q},select(){return q},then(resolve:any){const matched=rows[table].filter(r=>predicates.every(p=>p(r)));matched.forEach(r=>Object.assign(r,patch));return Promise.resolve({data:matched,error:null}).then(resolve)}};return q}};
}
const account={id:'mrw',owner_id:'owner',provider:'mrw'};
const sagec={username:'synthetic-user',password:'synthetic-password'};
it.each(['MRW_CREDENTIALS_REQUIRED','MRW_TRACKING_PASSWORD_REQUIRED','MRW_TRACKING_ACCESS_DENIED','MRW_CREDENTIALS_REJECTED'])('saving complete SAGEC credentials resumes %s for only owned nonterminal recoverable shipments',async(error)=>{
 const db=fixture();db.rows.shipment_tracking_account_health[0].last_error=error;
 await resumeMrwTrackingAfterCredentialSave(db,account,sagec,'now');
 expect(db.rows.shipment_tracking_account_health.map(r=>r.paused_until)).toEqual([null,'later']);
 expect(db.rows.shipment_tracking_state.map(r=>r.next_poll_at)).toEqual(['now','now',null,'later','later','now']);
});
it.each([{password:'new-password'},{username:'new-user'}])('uses the saved merged SAGEC pair after a partial credential edit',async(edit)=>{
 const db=fixture();await resumeMrwTrackingAfterCredentialSave(db,account,edit,'now',{...sagec,...edit});expect(db.rows.shipment_tracking_state[0].next_poll_at).toBe('now');
});
it.each(['userName','usuario'])('supports a saved SAGEC %s alias when updating the password',async(key)=>{
 const db=fixture();await resumeMrwTrackingAfterCredentialSave(db,account,{password:'new'},'now',{[key]:'saved-user',password:'new'});expect(db.rows.shipment_tracking_state[0].next_poll_at).toBe('now');
});
it.each([{irrelevant:'unused'},{password:' '},{franchiseCode:'123'},null,{}])('unrelated or blank edits cannot resume tracking even with a saved pair',async(edit)=>{
 const db=fixture();await resumeMrwTrackingAfterCredentialSave(db,account,edit,'now',sagec);expect(db.rows.shipment_tracking_account_health[0].paused_until).toBe('later');
});
it.each([{username:'user'},{password:'password'},{}])('incomplete saved credentials keep the pause',async(saved)=>{
 const db=fixture();await resumeMrwTrackingAfterCredentialSave(db,account,{password:'new'},'now',saved);expect(db.rows.shipment_tracking_account_health[0].paused_until).toBe('later');
});
it('does not resume terminal shipments or rate limit pauses',async()=>{
 const db=fixture();db.rows.shipment_tracking_state[2].next_poll_at='later';db.rows.shipment_tracking_state[2].last_error='ACCOUNT_PAUSED';await resumeMrwTrackingAfterCredentialSave(db,account,sagec,'now');expect(db.rows.shipment_tracking_state[2].next_poll_at).toBe('later');
 const limited=fixture();limited.rows.shipment_tracking_account_health[0].last_error='PROVIDER_HTTP_429';await resumeMrwTrackingAfterCredentialSave(limited,account,sagec);expect(limited.rows.shipment_tracking_account_health[0].paused_until).toBe('later');
});
it('keeps the safety pause if waking states fails',async()=>{
 const db=fixture(),from=db.from.bind(db);db.from=(table:string)=>table==='shipment_tracking_state'?{update:()=>{const q:any={eq:()=>q,not:()=>q,or:()=>q,in:async()=>({error:Error('db unavailable')})};return q}}:from(table);
 await expect(resumeMrwTrackingAfterCredentialSave(db,account,sagec)).rejects.toThrow('MRW_TRACKING_RESUME_FAILED');expect(db.rows.shipment_tracking_account_health[0].paused_until).toBe('later');
});
