alter table public.app_users add column if not exists last_access_at timestamptz;
-- Recover the most recent observed authenticated session activity.
update public.app_users a set last_access_at=greatest(a.last_access_at,u.last_sign_in_at,s.last_activity)
from auth.users u left join (
 select user_id,max(greatest(created_at,refreshed_at at time zone 'UTC')) last_activity from auth.sessions group by user_id
) s on s.user_id=u.id where a.user_id=u.id;
create or replace function private.record_app_access() returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 update public.app_users set last_access_at=clock_timestamp()
 where user_id=auth.uid() and active
 and (last_access_at is null or last_access_at<clock_timestamp()-interval '1 minute');
end;
$$;
revoke all on function private.record_app_access() from public,anon;
grant execute on function private.record_app_access() to authenticated;
create or replace function public.record_app_access() returns void language sql security invoker set search_path='' as $$ select private.record_app_access(); $$;
revoke all on function public.record_app_access() from public,anon;
grant execute on function public.record_app_access() to authenticated;
notify pgrst,'reload schema';

