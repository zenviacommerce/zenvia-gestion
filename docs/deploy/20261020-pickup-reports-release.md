# 2026-10-20 — PR251 pickup reports production release

## Phase 0: snapshot / rollback before changes
Owner approved corrected PDF and backend-first publication. Reviewed head4993a2f0d39bafcc43fee4927dc1afa57b564d0b; all5required workflows success. Snapshot: all3pickup relations absent, no pickup functions/history entry; dashboard hash081c0519b77e14fd53598cefba39aeb7; MFA manifest35, findings0; exact owner-only pilot unchanged.

Vercel rollback prepared BEFORE backend/frontend: dpl_3Mznkx6P7AMfybJtSLch4xVmp2Vz, index-CRlr5KXE.js, commit c512720ad2429520c897b2961002cf8948cf53b8, READY/current gestion domain. Database rollback: supabase/rollback/20261020_pickup_reports.sql; refuses after any permanent report. Operational rollback retains issued evidence and can revoke create only.

Preview reads only. Save/download registers an immutable definitive report and consumes its number; owner informed before publication. No definitive test report will remain in production.

Concurrency rehearsal: real production counter allocation with two separate SQL connections and a synthetic owner counter, removed afterwards; actual report RPC sequential generations/retry in a transaction ending ROLLBACK. No carrier call or label purchase. Verify findings, grants, pilot, original dashboard hash and zero permanent reports before frontend.

Backend migration and verification pending. Do not merge until successful.
