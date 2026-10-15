REVOKE EXECUTE ON FUNCTION public.amazon_close_recovered_order_failures() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.amazon_close_recovered_order_failures() TO service_role;