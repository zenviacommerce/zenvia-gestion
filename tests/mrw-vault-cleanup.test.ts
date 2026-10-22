// @vitest-environment node
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
const migration=readFileSync(new URL('../supabase/migrations/20261022101955_remove_mrw_tracking_password_override.sql',import.meta.url),'utf8');
it('purges linked and orphan MRW credentials through supported Vault APIs without granting base-table access',async()=>{
 const db=new PGlite();try{
 await db.exec(`create role cleanup_runner;create schema vault;create table vault.secrets(id uuid primary key,name text,secret text,description text,updated_at timestamptz default now());
 create view vault.decrypted_secrets as select id,name,secret as decrypted_secret,description,updated_at from vault.secrets;
 create table public.integration_accounts(provider text,secret_id uuid);
 create function vault.update_secret(secret_id uuid,new_secret text default null,new_name text default null,new_description text default null,new_key_id uuid default null) returns void security definer language plpgsql set search_path='' as $$begin update vault.secrets s set secret=coalesce(new_secret,s.secret),name=coalesce(new_name,s.name),description=coalesce(new_description,s.description),updated_at=now() where id=secret_id;end$$;
 revoke all on vault.secrets from public,cleanup_runner;revoke all on function vault.update_secret(uuid,text,text,text,uuid) from public;
 grant usage on schema vault to cleanup_runner;grant select on vault.decrypted_secrets,public.integration_accounts to cleanup_runner;grant execute on function vault.update_secret(uuid,text,text,text,uuid) to cleanup_runner;
 insert into vault.secrets(id,name,secret,description) values
 ('11111111-1111-1111-1111-111111111111','renamed-secret','{"username":"synthetic-user","password":"synthetic-password","trackingPassword":"obsolete","keep":1}','keep-description'),
 ('22222222-2222-2222-2222-222222222222','integration:mrw:orphan','{"username":"orphan","tracking_password":"obsolete-alias"}','orphan-description'),
 ('33333333-3333-3333-3333-333333333333','integration:sendcloud:other','{"trackingPassword":"unrelated"}','other-description');
 insert into integration_accounts values('mrw','11111111-1111-1111-1111-111111111111');set role cleanup_runner;`);
 await db.exec(migration);
 const rows=(await db.query<{name:string;decrypted_secret:string;description:string}>('select name,decrypted_secret,description from vault.decrypted_secrets order by id')).rows;
 expect(rows.map(({decrypted_secret,...metadata})=>({...metadata,credentials:JSON.parse(decrypted_secret)}))).toEqual([
 {name:'renamed-secret',credentials:{username:'synthetic-user',password:'synthetic-password',keep:1},description:'keep-description'},
 {name:'integration:mrw:orphan',credentials:{username:'orphan'},description:'orphan-description'},
 {name:'integration:sendcloud:other',credentials:{trackingPassword:'unrelated'},description:'other-description'}]);
 expect((await db.query<{allowed:boolean}>("select has_table_privilege('cleanup_runner','vault.secrets','UPDATE') allowed")).rows[0].allowed).toBe(false);
 await expect(db.query('select * from vault.secrets')).rejects.toThrow('permission denied');
 await db.exec(migration);
 expect((await db.query('select id,name,decrypted_secret from vault.decrypted_secrets order by id')).rows).toHaveLength(3);
 }finally{await db.close()}
});
