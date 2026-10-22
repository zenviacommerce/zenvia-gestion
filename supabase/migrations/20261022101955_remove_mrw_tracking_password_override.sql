-- Remove the retired override inside Vault; plaintext never leaves the server.
-- Updates encrypted content in place, preserving secret IDs/names and all SAGEC
-- keys. No DELETE, DROP, business-order DML or credential backup is performed.
SET LOCAL lock_timeout='3s';
DO $remove_override$
DECLARE item record;original jsonb;cleaned jsonb;verified jsonb;
BEGIN
 FOR item IN SELECT s.id FROM vault.secrets s
 WHERE s.name LIKE 'integration:mrw:%' OR EXISTS(
  SELECT 1 FROM public.integration_accounts a WHERE a.provider='mrw' AND a.secret_id=s.id
 ) FOR UPDATE OF s LOOP
  BEGIN
   SELECT decrypted_secret::jsonb INTO STRICT original FROM vault.decrypted_secrets WHERE id=item.id;
  EXCEPTION WHEN invalid_text_representation THEN
   RAISE EXCEPTION 'MRW_SECRET_FORMAT_INVALID';
  END;
  IF jsonb_typeof(original)<>'object' THEN RAISE EXCEPTION 'MRW_SECRET_FORMAT_INVALID';END IF;
  cleaned:=original-'trackingPassword'-'tracking_password';
  IF cleaned IS DISTINCT FROM original THEN
   PERFORM vault.update_secret(item.id,cleaned::text);
   SELECT decrypted_secret::jsonb INTO STRICT verified FROM vault.decrypted_secrets WHERE id=item.id;
   IF verified IS DISTINCT FROM cleaned THEN RAISE EXCEPTION 'MRW_SECRET_CLEANUP_MISMATCH';END IF;
  END IF;
 END LOOP;
END $remove_override$;
