-- The Platform plan sync sends its real provider when mirroring subscriptions.
-- Keep existing provider values and accept PayPal and centrally managed plans.
alter table public.workspace_subscriptions
  drop constraint workspace_subscriptions_billing_provider_check;
alter table public.workspace_subscriptions
  add constraint workspace_subscriptions_billing_provider_check
  check (billing_provider in ('manual','stripe','paypal','platform'));
