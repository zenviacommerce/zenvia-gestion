# 2026-10-19 — Ordinary logout local / explicit global sessions

## Phase 1 — Platform published
PR https://github.com/zenviacommerce/zenvia-platform/pull/76, head 8105c860f7557ca43b82858a2d2339593f08333b, merge c9a10ea3831ac05247af3349be819269be6bee85. Build ZENVIA Platform success: https://github.com/zenviacommerce/zenvia-platform/actions/runs/39315978787. Local 248 tests and build pass. Production READY dpl_8K29gsU9v1XSDFgHCw5FYyEhF7pc; admin.zenviacommerce.com points to it. HTML 200, index-C8G9Ghgi.js 200; both ordinary local scopes and saved-password recovery phase present in served bundle. No live logout was performed.

Rollback: Instant Rollback to dpl_4hptdBNNaGyNLBo4fhLgGFuqSCa9 (zenvia-platform-bdfamc6bq-sergiorojasdiaz-7097.vercel.app). Initial rollout journal is committed in the Platform PR.

## Phase 2 — Gestión awaiting final CI
PR https://github.com/zenviacommerce/zenvia-gestion/pull/248, current head 4e33de265bb53816780ed6940348468078385c5a. Four workflows success; disposable Supabase integration still running. Not merged or published at this phase. Vercel preview status success. All scopes/confirmation/security flows and screenshots are in the PR journal docs/deploy/20261019-logout-scope.md. Rollback fixed before changes: dpl_Fp5stLrGQMk34DMMjyrXsyjzrREX / index-DqlURX7K.js.

No SQL, Edge Function, Auth settings or MFA activation changes. MFA remains off with existing fail-open. Initial invitation password creation keeps onboarding session; password recovery explicitly global, assisted MFA recovery globally revokes server-side, ordinary MFA exit local. Independent code review passed after adding saved-password revocation retry regression.
