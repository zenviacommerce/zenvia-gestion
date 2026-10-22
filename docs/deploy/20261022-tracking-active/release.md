# Tracking active release

Owner authorized publication, then a read-only preview showing provider/state counts before bounded reprocessing. The pickup PDF must follow the completed tracking release in a separate deployment.

## MRW contract and real read-only verification

On 22 October, the supplied `/TrackingServices/TrackingService.svc` path returned HTTP 404. The public WSDL at `https://trackingservice.mrw.es/TrackingService.svc?wsdl` advertises SOAP 1.1 at `https://trackingservice.mrw.es/TrackingService.svc/TrackingServices`, action `http://tempuri.org/ITrackingService/GetEnvios`.

An internal service-key-authenticated diagnostic read each account's existing SAGEC login/password directly from Vault. Credentials never entered local files, responses or logs. It made no order, event, state or account-health writes. The prior shadow worker and its behavior remained intact during this diagnostic (versions 8/9 only added the internal read-only action).

- The owner-supplied example returned HTTP 200, code 00 / Entregado, Publicado `2026-10-21T12:19:06+02:00`, delivery date 21102026 and time 1219. Information type 1 returned ten history events.
- Three current active shipments each returned HTTP 200, code 48 / Pendiente de recoger, with two history events each.
- A second diagnostic issued one range request for two explicitly selected consecutive active numbers: HTTP 200, two distinct matching shipments and four history events. Returned numbers are filtered against the preauthorized set; ranges never discover or authorize shipments.
- Observed codes: 00 delivered; 16 out for delivery; 79,57,17 in transit; 47,48 pre-transit. Positive Intentos means exception except confirmed delivery. Unknown codes are retained and raise sanitized operational warnings. Existing SAGEC aliases are supported.
- PersonaEntrega and Referencia are discarded by the adapter. Persisted history uses only state, original code/description and movement time, with the existing order PII purge lifecycle. No new recipient data is introduced.

## Installation and rollback

Before installation, `before-schema.json` captures functions, grants, switches and timestamp; worker-v7 and integration-accounts-v45 snapshots capture the previous live source. Install UI grants/normalizer, history grants, projection compatibility, active-mode constraint, bounded reprocess RPCs, post-HTTP account guard and provider-history support. The active-mode schema migration leaves the current mode unchanged until the backend is ready.

The compatibility installer updates one private classifier row and three private RPC backup rows, appends private cache columns/generations and queues existing private groups for bounded rebuild. DELETE statements inside the replacement refresh function affect only private derived cache/version rows. DROP removes a temporary installer function; the active-mode migration replaces a CHECK constraint. No business orders, labels, subscriptions, marketplace data or existing tracking observations are rewritten by installation.

Immediate rollback: set shipment_tracking_settings.enabled=false to stop claims; switch mode back to shadow, restore captured Edge Function files if necessary. Disable private.orders_projection_control.read_enabled for the current normalized fallback; the SQL in supabase/rollback/20261022_shipment_tracking_projection_reads.sql restores normalized nonprojected callers with hash guards. Leave additive schema/history in place. The public MFA wrapper and source-order fail-open trigger must remain unchanged.

Reprocess approvals include the current state fingerprint. Apply revalidates tenant, account, workspace, current label identity, privacy, terminals, leases, pauses and backoff; at most 25 are queued per call. Only tracking scheduling/state/events may change. Delivered/returned/cancelled shipments are excluded.

The consumption window still begins at 2026-10-22 09:19:20.702302 UTC. Do not reset pg_stat_statements again; record tracking activation/publication times for the scheduled comparison.
