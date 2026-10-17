# Phase 3: connection budget and Amazon call telemetry

Deferred scale work; no runtime change in this document.

## PostgreSQL connection budget

During the 17 October reconciliation repeat, observed maximum was 36 connections of max_connections=60 (60%); final observation 34. These are samples, not a continuous peak. Model the steady-state and burst contributions of Auth, PostgREST/RPC, workers, pg_net, cron/maintenance, realtime, administration and monitoring. Reserve explicit Auth/incident headroom; cap concurrent dispatch and worker database use within the remaining budget. Include connection-acquisition latency, pool queuing, p95/p99 and idle/active counts in load tests at increasing tenant counts. Revisit worker/job granularity and fair queueing before multiplying the current ~32 jobs/hour/account by hundreds of tenants.

## SP-API outbound telemetry

Instrument the common HTTP transport and any direct SP-API callers. Count each HTTP attempt separately from jobs, tagged by stable endpoint/operation, integration account, seller identity (opaque/pseudonymous), app key, region, status class, 429, retry index, latency and quota headers. Record terminal outcome and recovered transient attempts separately; never log tokens, query values, buyer PII or response bodies. Use low-cardinality route templates and account access restrictions. Cover LWA requests separately from SP-API.

Required validation: the same retrying job yields two attempt events and one final job outcome; no duplicate counting through wrappers; account A cannot be attributed to B; controlled tests contain no secrets/PII. Dashboards must compare equivalent natural/maintenance windows per endpoint/account without claiming job counts are HTTP counts. A recovered 429 remains expected behavior, not an automatic rollback trigger.
