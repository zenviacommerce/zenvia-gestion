# MRW incident hotfix publication

23 October 2026, 08:16:33 UTC: mrw-shipping deployed as v27, verify_jwt=true, hash 8fac3dcce5db88f403b7dd02fbf4dbf0c8fd89e1cbf8b35ea4ef8dee56d93457. Complete readback matches payload; all eight shared dependencies byte-identical to v26, including MFA. Rollback: redeploy mrw-shipping files from supabase/snapshots/20261023-mrw-incident-before.json with verify_jwt=true. No frontend or schema dependency. No real shipment created by the agent.

Affected order released after successful empty TrackingService reference lookup and explicit MRW validation rejection. Exact guarded UPDATE shown before execution; returned one row. Current *_CREATING count zero. Owner notified immediately after release, and again after backend correction with permission to retry generation themselves.

Local final verification: 683/683 Vitest, 1291/1291 Node, Deno green; review approved. Initial test run's missing baseline fixtures corrected; first broad Node glob included the CI-separated Docker MFA test, then the proper CI-equivalent suite passed. CI PR295 all six workflows green on head 052ce606e8c3c2332fa554996591a7331cfc8449. Merge receipt: {"sha":"5adf2c8a00bf1182b6c9b5c3de095693ece37bd7","merged":true,"message":"Pull Request successfully merged"}.

Temporary mrw-readonly-probe restored to its preincident 410 tombstone, v10/hash 8f370fcfa4888781484c78f17a8167ef4f6b6d108f47b03026a97c7bc40c8433. No credentials exposed or logged. Continuing durable reconciliation separately; not yet deployed.
Vercel frontend receipt (no visible UI changes in this backend patch): dpl_6hZ7KiT1yExDaDtXXFXspukeqySE READY, production alias gestion.zenviacommerce.com, main merge 5adf2c8a00bf1182b6c9b5c3de095693ece37bd7. Durable reconciliation UI baseline/rollback uses this deployment so both earlier PDF hotfixes and MRW source remain represented.
