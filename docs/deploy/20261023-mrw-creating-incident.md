# MRW creation incident — 23 October 2026

Emergency scope: reconcile reference 406-9615891-5475566, never create a shipment during diagnosis. One MRW_CREATING order found; no other *_CREATING states.

Evidence: MRW v26 log 07:24:46.867 UTC rejects TipoMercancia="Documentos y mercancía"; allowed codes DOC,IMP,MCV,MSV,ATV,BJV,MUE. Catch logs and rethrows without clearing/reconciling lease. No MRW deploy at failure (live updated_at 2026-10-23T04:24:04.733Z).

Rollback prepared: complete live MRW v26 bundle and diagnostic v7 tombstone in supabase/snapshots/20261023-mrw-incident-before.json. Temporary diagnostic is read only, fixed to one owner/account/reference/date, authenticated with existing internal apikey and expires 09:00 UTC. Restore tombstone after query. No credential values leave the function.
## Confirmed absence and single-row release

TrackingService request 18121: HTTP 200, tipoFiltro=1, exact reference, both dates 23/10/2026; notice `Busqueda correcta por Referencia de Envío.`, zero NumAlbaran. MRW rejection logged 07:24:46.867 UTC. Read-only query only; no TransmEnvio issued.

SQL shown to owner before execution: UPDATE fulfillment_orders SET tracking_status_code=NULL guarded by id, owner, order_number, MRW_CREATING and six null shipping fields (see recovery SQL). Conditional rollback: restore MRW_CREATING only for the same id/owner, status still null, all shipment identifiers and label date still null. Never restore a stale lock over a later successful shipment.
## Recovery result and backend correction

Release UPDATE returned exactly the affected order, tracking_status_code NULL. Post-read: zero *_CREATING orders project-wide. Diagnostic restored to original 410 tombstone, v10, hash 8f370fcfa4888781484c78f17a8167ef4f6b6d108f47b03026a97c7bc40c8433.

Correction: validated TipoMercancia code MCV default (provider rejection lists it as allowed); configurable existing account merchandiseCode accepts only DOC/IMP/MCV/MSV/ATV/BJV/MUE. Explicit Estado=0 business validation rejection with no consignment and no SOAP Fault releases guarded MRW_CREATING; network errors, missing numbers, SOAP faults remain locked for reconciliation. TransmEnvio never retries another SOAP protocol after ambiguous HTTP, fetch bounded at 45s. Existing accepted-shipment-before-PDF persistence retained.

Verification: red reproductions observed for rejected lock, HTTP500 double transmit and SOAPServer unsafe release; final focused tests green, 1291 Node tests pass (CI excludes Docker-only MFA integration). Initial broad glob included that Docker-only test and missing local tracked-baseline fixtures/docs; restored existing baseline files and reran appropriate CI suite. Deno check passes. Independent reviewer found no critical/important issues. Original error XML not retained, so exact production rejection shape cannot be asserted; unknown responses remain locked. No real label requests, cancellations or shipment creations executed.
