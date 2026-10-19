-- Roles que usa PostgREST en la prueba de integración local/CI.
do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists(select 1 from pg_roles where rolname='authenticator') then create role authenticator login password 'authpw' noinherit; end if;
end $$;
grant anon, authenticated to authenticator;
