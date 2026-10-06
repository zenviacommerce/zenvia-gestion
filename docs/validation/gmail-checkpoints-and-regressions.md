# Gmail checkpoints and regression suite

Production PostgreSQL logs recorded two `23505` errors against the obsolete
`gmail_imports_owner_id_gmail_message_id_attachment_name_key` constraint on
2026-10-06. Different attachments in one message can have identical filenames.
The migration removes that filename constraint while retaining uniqueness on
owner, message and attachment ID. No existing records are deleted or rewritten.

Gmail now persists candidates per message before acknowledging the scan cache.
Failed persistence leaves the message retryable. Failed classification also
leaves the message retryable. A new cache version permits retrying messages that
the old scanner cached before a failed batch insert. Existing import states are
preserved by `ignoreDuplicates`. A saved attachment no longer causes every
attachment in the same message to be skipped. Structured errors use the shared
error formatter; interrupted work no longer displays stale success progress.

The 26 old failing assertions were reviewed against current implementation.
Obsolete contracts for OpenAI, region-specific shipping defaults, old SOAP
probes, Shopify through Sendcloud and bulk generation without preview were
replaced with current safeguards. No tests were deleted. Behavioral coverage
now includes selected-service parcel requirements, offline tariff recovery,
VAT/fuel separation, direct MRW and cross-provider carrier tariff comparisons.
The deterministic tariff Edge parser also has two invalid currency expressions
fixed and retains its existing authentication and implementation.

Validation: Node test suite 795 passed, 0 failed. TypeScript/Vite production build
passed. Gmail regressions first failed against the old implementation and pass
after the fix. Migration applied and identity index verified in development and
production. Tariff parser deployed to both environments with JWT verification.
No live mailbox scan was initiated on the user's behalf.
