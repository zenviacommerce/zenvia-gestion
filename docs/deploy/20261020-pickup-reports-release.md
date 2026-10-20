# 2026-10-20 — PR251 pickup reports production release

## Phase 0: snapshot / rollback before changes
Owner approved corrected PDF and backend-first publication. Reviewed head4993a2f0d39bafcc43fee4927dc1afa57b564d0b; all5required workflows success. Snapshot: all3pickup relations absent, no pickup functions/history entry; dashboard hash081c0519b77e14fd53598cefba39aeb7; MFA manifest35, findings0; exact owner-only pilot unchanged.

Vercel rollback prepared BEFORE backend/frontend: dpl_3Mznkx6P7AMfybJtSLch4xVmp2Vz, index-CRlr5KXE.js, commit c512720ad2429520c897b2961002cf8948cf53b8, READY/current gestion domain. Database rollback: supabase/rollback/20261020_pickup_reports.sql; refuses after any permanent report. Operational rollback retains issued evidence and can revoke create only.

Preview reads only. Save/download registers an immutable definitive report and consumes its number; owner informed before publication. No definitive test report will remain in production.

Concurrency rehearsal: real production counter allocation with two separate SQL connections and a synthetic owner counter, removed afterwards; actual report RPC sequential generations/retry in a transaction ending ROLLBACK. No carrier call or label purchase. Verify findings, grants, pilot, original dashboard hash and zero permanent reports before frontend.

Backend migration and verification pending. Do not merge until successful.

## Phase 1: backend applied — 08:22 UTC
Migration pickup_reports applied successfully, with an in-transaction MFA integrity assertion. Connector assigned registry20261020082248; guarded metadata-only history alignment restored approved repository version20261020072636 (no SQL reapplication). Tables empty, counters0, manifest40(+5registered wrappers), integrity0, original dashboard hash unchanged. Frontend remains previous deployment. Verification/rollback rehearsal next.

## Phase 2a: production RPC/security verification — 08:25 UTC
Actual authenticated owner claims backed by a current AAL2 Auth session; no token/session identifier exported. AAL1 rejected; AAL2 preview/create/get works. Two RPC generations obtained REC-2026-0001/0002, exact idempotent retry and saved get snapshot. Entire RPC rehearsal ended ROLLBACK: reports0/items0/counters0, findings0. Five RPCs deny anon and admit authenticated only through their gates; direct table access denied. Production create implementation hash ecfec230cd202a5223a681d68e1a5760; server17.6.

Deviation: automatic review declined the production DDL rollback rehearsal without a stated reason; no rollback SQL executed. Existing local rollback test passes; exact script is now being exercised on an isolated PostgreSQL17.6 runner as well. A two-call production synthetic counter probe returned1/2 from different PIDs, but MCP serialized the requests (timestamps do not overlap), so this is explicitly NOT concurrency evidence. Its only synthetic counter row was removed; no reports created. Actual concurrent full-RPC verification is running on verify/pickup-concurrency-20261020 with exact production implementation hash, no production connection/credentials. Frontend not merged pending that result.

## Phase 2b: real concurrency and rollback PASS — 08:29 UTC
Isolated PostgreSQL17.6, exact production create implementation hash ecfec230cd202a5223a681d68e1a5760. Workflow39393755928 success, source verification branch096e5dea1de98d34f1c145b8caf64908c9aff076. Full public create RPC on independent PIDs120/119 and txids796/797: starts08:29:36.710777/36.710783UTC; first allocated0001, held transaction until08:29:38.219364; second waited and allocated0002 at08:29:38.224812. Explicit overlap assertion passed. Idempotent retry retained0001 with reports2/counter2. Nonempty rollback refused and empty rollback removed tables/manifest exactly. This runner has NO production connection/credentials; all fixtures disposed there. Production RPC/session/MFA proof remains the separate ROLLBACK rehearsal above. Backend release gate satisfied; now publish reviewed frontend without changing its head.
