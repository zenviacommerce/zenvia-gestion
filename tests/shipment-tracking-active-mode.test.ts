import {it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
it('allows approved active mode without changing existing shadow settings',async()=>{
 const db=new PGlite();try{
 await db.exec(`create table shipment_tracking_settings(singleton boolean primary key default true check(singleton),enabled boolean not null default false,mode text not null default 'shadow' check(mode='shadow'));insert into shipment_tracking_settings values(true,true,'shadow');`);
 await db.exec(readFileSync('supabase/migrations/20261022094237_shipment_tracking_active_mode.sql','utf8'));
 expect((await db.query('select enabled,mode from shipment_tracking_settings')).rows).toEqual([{enabled:true,mode:'shadow'}]);
 await db.exec("update shipment_tracking_settings set mode='active'");
 expect((await db.query<{mode:string}>('select mode from shipment_tracking_settings')).rows[0].mode).toBe('active');
 await expect(db.exec("update shipment_tracking_settings set mode='unapproved'")).rejects.toThrow();
 await db.exec("update shipment_tracking_settings set mode='shadow',enabled=false");
 expect((await db.query('select enabled,mode from shipment_tracking_settings')).rows).toEqual([{enabled:false,mode:'shadow'}]);
 }finally{await db.close()}
});
