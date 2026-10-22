# Tracking provider freshness — 2026-10-22

## Evidence before writes

Production worker v10: enabled, active, cron every five minutes. Sendcloud's
five active states were checked today without errors. `movement_at` is the
carrier movement, not the check time. Delivered states have `next_poll_at=NULL`.

Read-only diagnostic request 12131, HTTP 200, made 20 GET requests, no database
tracking writes. Subscription 47879 for `parcels.event.created` is active.
All five previously active Sendcloud responses still have their stored carrier
state/time: three return-in-progress exceptions, one pickup-point exception,
and one out-for-delivery from September 3. No delivery is inferred from age.

Thirteen active legacy Sendcloud orders have correct account ownership and a
tracking number but no parcel ID and NULL provider. The old seed excluded them.
Authenticated Sendcloud tracking confirms twelve delivered and one address
exception. New eligibility accepts these orders without weakening account,
tenant, identity, privacy or terminal guards. The migration changes definitions
only and performs no existing-row DML.

Order 407-0024766-5208363 / 01009F045746 is explicitly Sendcloud but linked to an
Envia account. The unique enabled Sendcloud account in that same workspace
returns this parcel as delivered at 2026-10-22T09:50:22Z. The operational SQL
repairs exactly one account association after preview; every other order field
must remain byte-identical or the transaction rolls back.

Envia has fourteen tracked shipments in source orders: twelve already delivered
or returned at origin intentionally excluded from polling; the remaining two
have state rows (one delivered, one active). No active Envia coverage gap.

MRW mappings: 33/59/72/91 in_transit; 35 exception. Preserve descriptions and
positive-attempt handling. No complete public numeric catalogue was located;
the official TrackingService XSD uses a string without enum restrictions.

## Deployment and rollback

1. Save worker v10 source and both current function definitions before replacing.
2. CI and independent review must pass; read-only diagnostic omits free-form
   descriptions because they can contain recipient PII. Credentials never leave
   server memory; no new credential fields or Vault overrides.
3. Display provider/before/after counts before reprocessing or seeding missing
   rows. Guard the one-account repair against concurrent metadata changes.
4. Apply additive coverage migration and worker policy. Reprocess only reviewed
   active identities; bound each run to 25 and retain all guards/backoff.
5. Verify old terminals unchanged, successful checks and no active coverage gaps.

Rollback: redeploy saved worker v10 source (or disable tracking through existing
settings) and restore the two saved function definitions. Do not revert verified
carrier delivery observations or restore retired MRW secret fields. A verified
shipping-account repair is independent of code rollback.

This release does not reset pg_stat_statements. Record deployment/backfill times
in the existing 24-hour consumption report so one-off work is identified.
