// @vitest-environment node
import {it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
it('removes only retired MRW keys in place without exposing or changing SAGEC and unrelated secrets',async()=>{
 const d=new PGlite();try{
 await d.exec(`create schema vault; create table vault.secrets(id uuid primary key,name text,secret text);create view vault.decrypted_secrets as select id,name,secret as decrypted_secret from vault.secrets;create table public.integration_accounts(id uuid,provider text,secret_id uuid,config jsonb);
 create function vault.update_secret(secret_id uuid,new_secret text default null,new_name text default null,new_description text default null,new_key_id uuid default null) returns void language sql as $$update vault.secrets set secret=new_secret where id=secret_id$$;
 insert into integration_accounts values('11111111-1111-1111-1111-111111111111','mrw','22222222-2222-2222-2222-222222222222','{}');
 insert into vault.secrets values('22222222-2222-2222-2222-222222222222','integration:mrw:fixture','{"username":"SAGEC-USER","password":"SAGEC-TEST-ONLY","franchiseCode":"F","subscriberCode":"A","departmentCode":"D","trackingPassword":"RETIRED-TEST-ONLY","tracking_password":"RETIRED-ALIAS-TEST-ONLY"}'),('33333333-3333-3333-3333-333333333333','unrelated','{"trackingPassword":"UNRELATED-TEST-ONLY"}');`);
 const migration=readFileSync('supabase/migrations/20261022101955_remove_mrw_tracking_password_override.sql','utf8');
 await d.exec(migration);
 const rows=(await d.query<{name:string;value:any}>('select name,secret::jsonb as value from vault.secrets order by name')).rows;
 expect(rows[0].value).toEqual({username:'SAGEC-USER',password:'SAGEC-TEST-ONLY',franchiseCode:'F',subscriberCode:'A',departmentCode:'D'});
 expect(rows[1].value).toEqual({trackingPassword:'UNRELATED-TEST-ONLY'});
 await d.exec(migration);expect((await d.query('select count(*)::int n from vault.secrets')).rows).toEqual([{n:2}]);
 }finally{await d.close()}
},20000);
