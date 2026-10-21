-- Same scopes and predicates as platform-bridge bootstrap/readWorkspaceUsage/list_tickets.
select jsonb_build_object('checked_at',clock_timestamp(),'workspaces',(
 select jsonb_agg(jsonb_build_object('workspace_id',w.id,
 'users_active',(select count(*) from public.app_users where workspace_id=w.id and active),
 'amazon_accounts',(select count(*) from public.amazon_accounts where owner_id=w.id and status<>'disabled'),
 'monthly_orders',(select count(*) from public.fulfillment_orders where owner_id=w.id and order_created_at>=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC' and order_created_at<(date_trunc('month',now() at time zone 'UTC')+interval '1 month') at time zone 'UTC'),
 'tickets_total',(select count(*) from public.support_tickets where owner_id=w.id),
 'open_tickets',(select count(*) from public.support_tickets where owner_id=w.id and status in ('open','in_progress','waiting_user')),
 'awaiting_reply',(select count(*) from public.support_tickets where owner_id=w.id and status in ('open','in_progress','waiting_user') and last_author_role='user')) order by w.id)
 from public.workspaces w where w.id in ('7461b2b7-f383-460d-b1c7-6ccbb52e42b2','835a7f45-7edf-4af2-b455-a8ec9c9f07e0')),
 'ticket_digest',(select md5(coalesce(jsonb_agg(jsonb_build_array(owner_id,id,status,last_activity_at) order by owner_id,id)::text,'[]')) from public.support_tickets where owner_id in ('7461b2b7-f383-460d-b1c7-6ccbb52e42b2','835a7f45-7edf-4af2-b455-a8ec9c9f07e0'))) comparison;
