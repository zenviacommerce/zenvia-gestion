-- Run on the central Platform project; tenant databases never receive public leads.
create table if not exists public.website_inquiries (
 id uuid primary key default gen_random_uuid(),request_id uuid not null unique,
 name text not null,email text not null,company text not null default '',message text not null,
 plan_key text not null default '',privacy_version text not null default '2026-10-13',
 rate_hash text not null,created_at timestamptz not null default now(),
 status text not null default 'new',notification_sent boolean not null default false,
 check (length(name) between 1 and 120),check(length(email) between 3 and 254),
 check(length(company)<=160),check(length(message) between 10 and 3000),
 check(plan_key in ('','starter','pro','business'))
);
alter table public.website_inquiries enable row level security;
revoke all on public.website_inquiries from public,anon,authenticated;
grant select,insert,update on public.website_inquiries to service_role;
create index if not exists website_inquiries_rate on public.website_inquiries(rate_hash,created_at);
create or replace function public.submit_website_inquiry(p_request_id uuid,p_name text,p_email text,p_company text,p_message text,p_plan text,p_rate_hash text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare existing_id uuid;new_id uuid;
begin
 if coalesce(auth.role(),'') <> 'service_role' then raise exception 'unauthorized'; end if;
 perform pg_advisory_xact_lock(hashtextextended('website-inquiry-global',0));
 perform pg_advisory_xact_lock(hashtextextended(p_rate_hash,0));
 select id into existing_id from public.website_inquiries where request_id=p_request_id;
 if existing_id is not null then return jsonb_build_object('id',existing_id,'duplicate',true);end if;
 if (select count(*) from public.website_inquiries where created_at>now()-interval '1 hour')>=100 then raise exception 'rate_limited';end if;
 if (select count(*) from public.website_inquiries where (rate_hash=p_rate_hash or email=p_email) and created_at>now()-interval '1 hour')>=5 then raise exception 'rate_limited';end if;
 insert into public.website_inquiries(request_id,name,email,company,message,plan_key,rate_hash)
 values(p_request_id,p_name,p_email,p_company,p_message,p_plan,p_rate_hash) returning id into new_id;
 return jsonb_build_object('id',new_id,'duplicate',false);
end $$;
revoke all on function public.submit_website_inquiry(uuid,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.submit_website_inquiry(uuid,text,text,text,text,text,text) to service_role;
