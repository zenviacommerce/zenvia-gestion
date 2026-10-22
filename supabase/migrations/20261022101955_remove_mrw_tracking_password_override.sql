-- Remove the retired override inside Vault; plaintext never leaves the server.
-- Updates encrypted content in place, preserving secret IDs/names and all SAGEC
-- keys. No DELETE, DROP, business-order DML or credential backup is performed.
DO $remove_override$
DECLARE item record;original jsonb;cleaned jsonb;verified jsonb;
BEGIN
 PERFORM set_config('lock_timeout','3s',true);
 FOR item IN SELECT s.id FROM vault.decrypted_secrets s
 WHERE s.name LIKE 'integration:mrw:%' OR EXISTS(
  SELECT 1 FROM public.integration_accounts a WHERE a.provider='mrw' AND a.secret_id=s.id
 ) LOOP
  -- The Vault extension owns its base table. Acquire the same row lock through
  -- its supported SECURITY DEFINER API, without requesting direct table UPDATE.
  -- NULL preserves ciphertext, name and description; reread after the lock so a
  -- concurrent credential save cannot be overwritten with an older snapshot.
  PERFORM vault.update_secret(item.id,NULL);
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
