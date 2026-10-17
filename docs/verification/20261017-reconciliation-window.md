# Amazon reconciliation — 17 October 2026

## Authorization and window

User authorized execution without another confirmation after runtime secret verification. Selected 13:00–13:35 Europe/Madrid (11:00–11:35 UTC). Last 14 days at Madrid hour13: eight MERCHANT/FBM purchases and zero Amazon operational labels. FBA excluded from operational window selection. This is historical support, not a no-traffic guarantee.

## Preflight evidence

- `tmp-verify-fallback-secret`, version1, protected by deployed `requireInternalSecret`. Authenticated invocation pg_net587: HTTP200, `{defined:true,matches:true}`. No value/digest disclosed. Unauthenticated pg_net589: HTTP401. User will delete this function after the window. No browser used.
- All14 actual per-function bundles match every file in `production-snapshot/<function>/` at commit09c68337c1053dba4480e3916b537a907d9a793a. The top-level supabase/functions tree is not the per-function rollback source.
- Reconciliation source corresponds to remote commit11eb6120cf65a2fc87be9d5a4613eef3a5ec14d1. Eighteen credential/maintenance/caller regressions pass; full Node1003/1003 and build pass.
- Queue0 queued/running/failed before window. Connections17/60. Finance baseline44,177 rows, newest synced_at2026-10-17T10:10:35.695Z.
- Original cron1/8/9 allactive, schedules7 * * * *, */5 * * * *, */5 * * * *; exact definitions and their command hashes saved.
- Manual baseline with public anonymous JWT reaches application auth and returns403, session invalid. JWT gateway remains enabled.

## Temporary manual maintenance implementation

Dashboard access is forbidden for this run and no additional secret is configured. Instead of setting another remote secret, deploy a temporary copy of the reviewed manual candidate with its existing maintenance condition replaced by literaltrue. Its POST path returns503 before admin/DB/queue/worker access; OPTIONS remains available; verify_jwt stays true. Verify503 with public anonymous JWT. Keep this copy at deployment step12 and restore the exact reviewed normal candidate only after all14 functions pass. This changes no database configuration or other secrets.

## Safety and rollback

Pause cron1/8/9, block manual producer, wait for natural lease release. Never steal a lease. Deploy in agreed14-function order and verify returned version, every installed file, preserved JWT setting, denied unauthenticated request, and missing-job400 on orders/inventory/finances. No fabricated shipment and no Amazon confirmation POST smoke test.

Any failure restores all touched functions from exact per-function production snapshot, restores manual last, then original cron states after rollback verification. Do not remove the legacy allowlist as a substitute for restoring code. Reserve final window time for rollback.

MFA/OAuth/PR216/frontend are excluded. Purge is separate and requires deployed guard/schema, all-copy review and null-safe consumers; do not infer purge readiness from successful reconciliation.

## Execution result

**Outcome: rolled back; reconciliation is NOT active in production.**

-13:00:13Madrid: cron1/8/9 paused; manual maintenancev17, POST503 verified; zero live leases/running/manual-created jobs.
-All14 functions deployed in agreed order, each installed file and JWT setting verified. Auth rejection verified for each; inventory/finances/orders additionally returned internal-authenticated missing-job400. Manual remained503 at step12(v18); restored exact normal candidatev19 after worker passed.
-13:02:10Madrid: producers/manual restored; command MD5s and schedules unchanged. One explicit normal hourly orchestrator invocation returned HTTP200, accounts1/jobs27. Worker invocation returned HTTP202; acquired live lease13:02:28.
-13:02:34.993Madrid: one orders job received `Amazon SP-API (429): You exceeded your quota for the requested resource.` It remained queued with attempts1/max5, available13:03:34.993, not terminalfailed. Detection13:02:50 caused preventive rollback under the agreed any-failure criterion. This does not establish a code regression; an additional verification cycle had been triggered and request-budget/overlap attribution remains unproven.
-13:03:10Madrid: producers paused again; maintenancev20 blocked manual. Candidate worker released lease naturally by13:03:30; no lease stolen. All14 functions restored from exact snapshot, source/JWT flags re-read and verified; manual restored last(v21).
-13:04:31Madrid: manual session-invalid403 checked; original cron states restored, allactive with original schedules and exact command MD5s.
-13:05:20Madrid: restored production queue0, running0, failed0, liveleases0. Throttled job `d3007240-6a44-46af-b022-9f54197bfea4` succeeded on attempt2 under restored worker.

| Función | Antes | Candidato | Snapshot restaurado |
|---|---:|---:|---:|
| amazon-sync-fx | 32 | 33 | 34 |
| amazon-backfill-finance-components | 15 | 16 | 17 |
| amazon-sync-inventory | 10 | 11 | 12 |
| amazon-sync-finances | 15 | 16 | 17 |
| amazon-sync-orders | 17 | 18 | 19 |
| amazon-sync-product-images | 20 | 21 | 22 |
| amazon-recipient-fallback | 3 | 4 | 5 |
| amazon-reconcile-orders | 5 | 6 | 7 |
| amazon-status | 15 | 16 | 17 |
| shopify-analytics-sync | 6 | 7 | 8 |
| amazon-confirm-shipment | 15 | 16 | 17 |
| amazon-sync-manual | 16 | 19 | 21 |
| amazon-sync-orchestrator | 15 | 16 | 17 |
| amazon-sync-worker | 35 | 36 | 37 |

### Additional evidence and limits

- Runtime fallback logs11:00–11:04:35UTC:29events, zero events for an integration other than the exact allowlisted id. The candidate's restricted fallback was exercised successfully; snapshot rollback restores the prior code behavior, so do not describe the restriction as currently deployed.
- Finance table baseline44,177→44,181; four rows synced during window, latest11:02:49.209681UTC. Valid business writes remain after code rollback; no manual business-row deletion/requeue/data rollback was performed.
- Auth logs11:00–11:06:00UTC:7requests, zero5xx. Expected function authorization rejections are distinct from Auth5xx.
- `amazon-confirm-shipment`: installed source/JWT/auth rejection checked only; no fabricated shipment or Amazon confirmation POST was sent.
- Probe `tmp-verify-fallback-secret` remains deployed(v1), as expressly requested for user removal. It returns only defined/matches booleans, requires internal key, unauthenticated401. Its verified result was bothtrue.
- No main merge, browser use, MFA/OAuth/PR216/frontend deployment, purge, PII backup or Storage deletion. Purge remains gated by successful reconciliation and separate all-copy/consumer/guard readiness.
- Temporary manual blocking used a literaltrue version of the existing maintenance condition instead of configuring another secret. Original JWT protection remained enabled throughout. Final manual code is the exact pre-window snapshot.
- Final independent SQL check13:06:21Madrid: queue0/running0/failed0/liveleases0, connections15/60; all producer states remain restored.
- Stop after rollback: no retry deployment in this window. Diagnose SP-API quota/request budget before a new reconciliation attempt.

