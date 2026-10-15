ALTER TABLE public.amazon_worker_leases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.amazon_worker_leases FROM anon, authenticated;