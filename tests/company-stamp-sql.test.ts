import {expect,it} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
it('executes stamp migration with isolated owner/admin writes, orders reads, and reversible metadata',async()=>{
 const db=new PGlite();try{
 await db.exec(`create role authenticated;create schema private;create schema storage;
 create function private.app_workspace_owner_id() returns uuid language sql stable as $$select '00000000-0000-4000-8000-000000000001'::uuid$$;
 create function private.app_is_admin() returns boolean language sql stable as $$select current_setting('test.admin',true)='yes'$$;
 create function private.app_has_permission(text) returns boolean language sql stable as $$select $1='orders' and current_setting('test.orders',true)='yes'$$;
 create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
 create function private.app_storage_folder_in_workspace(text) returns boolean language sql stable as $$select $1=private.app_workspace_owner_id()::text$$;
 create table company_branding(owner_id uuid primary key,logo_path text);
 create table storage.objects(id int generated always as identity,bucket_id text,name text);
 alter table company_branding enable row level security;alter table storage.objects enable row level security;
 grant usage on schema storage,private to authenticated;grant select on company_branding to authenticated;grant select,insert,update,delete on storage.objects to authenticated;grant usage,select on all sequences in schema storage to authenticated;
 insert into company_branding values('00000000-0000-4000-8000-000000000001','existing-logo'),('00000000-0000-4000-8000-000000000002','other-logo');`);
 await db.exec(readFileSync('supabase/migrations/20261020095715_company_stamp.sql','utf8'));
 await db.exec(`set role authenticated;set test.admin='yes';set test.orders='no';insert into storage.objects(bucket_id,name) values('company-assets','00000000-0000-4000-8000-000000000001/branding/stamp-1.png');`);
 expect((await db.query('select * from company_branding')).rows).toHaveLength(1);
 await expect(db.exec(`insert into storage.objects(bucket_id,name) values('company-assets','00000000-0000-4000-8000-000000000002/branding/stamp-1.png')`)).rejects.toThrow();
 await expect(db.exec(`insert into storage.objects(bucket_id,name) values('company-assets','00000000-0000-4000-8000-000000000001/branding/logo.png')`)).rejects.toThrow();
 await db.exec(`reset role;create policy legacy_sales on storage.objects for all to authenticated using(current_setting('test.sales',true)='yes') with check(current_setting('test.sales',true)='yes');set role authenticated;set test.sales='yes';set test.admin='no';set test.orders='yes';`);
 await db.exec(`update storage.objects set name='00000000-0000-4000-8000-000000000001/branding/stamp-changed.png';delete from storage.objects;`);
 await db.exec(`insert into storage.objects(bucket_id,name) values('company-assets','00000000-0000-4000-8000-000000000001/branding/logo.png');`);
 await expect(db.exec(`update storage.objects set name='00000000-0000-4000-8000-000000000001/branding/stamp-injected.png' where name like '%logo.png'`)).rejects.toThrow();
 await db.exec(`delete from storage.objects where name like '%logo.png';`);
 expect((await db.query('select name from storage.objects')).rows[0]).toEqual({name:'00000000-0000-4000-8000-000000000001/branding/stamp-1.png'});

 expect((await db.query('select * from storage.objects')).rows).toHaveLength(1);
 expect((await db.query('select * from company_branding')).rows).toHaveLength(1);
 await expect(db.exec(`insert into storage.objects(bucket_id,name) values('company-assets','00000000-0000-4000-8000-000000000001/branding/stamp-2.png')`)).rejects.toThrow();
 await db.exec(`set test.orders='no';set test.sales='no';`);expect((await db.query('select * from storage.objects')).rows).toHaveLength(0);
 await db.exec('reset role');await db.exec(readFileSync('supabase/rollback/20261020_company_stamp.sql','utf8'));
 expect((await db.query('select logo_path from company_branding order by owner_id')).rows[0]).toEqual({logo_path:'existing-logo'});
 expect((await db.query("select column_name from information_schema.columns where table_name='company_branding' and column_name='stamp_path'")).rows).toHaveLength(0);
 }finally{await db.close()}
});
