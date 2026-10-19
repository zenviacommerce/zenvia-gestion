# 2026-10-19 — Logout scope published

## Outcome
Ordinary logout is explicitly local in Gestión, Platform and every MFA exit. Configuración → Seguridad now has an explicit confirmed global action, including the current device. Cancelling sends no request; duplicates are guarded, failures are visible, no automatic replay. Password recovery is global in both apps; after successful password save, a failed revocation retries only revocation.

## Production receipts
| Application | PR / merge | Deployment READY | Served bundle |
|---|---|---|---|
| Gestión | [#248](https://github.com/zenviacommerce/zenvia-gestion/pull/248) / 700a626ef98c2b79f52589c98429548489927ef2 | dpl_5g5QN5ZfoW5BfjmPD7oR8BPgSAVH | index-DGoL6EBd.js |
| Platform | [#76](https://github.com/zenviacommerce/zenvia-platform/pull/76) / c9a10ea3831ac05247af3349be819269be6bee85 | dpl_8K29gsU9v1XSDFgHCw5FYyEhF7pc | index-C8G9Ghgi.js |

Both production aliases match these deployments. Public HTML and assets HTTP200; new local scope controls, global action/confirmation and saved-password retry present in served code. Gestión HTTP checked 2026-10-19T20:10:54.652386+00:00. No live user session was revoked during verification; owner browser acceptance remains pending.

## CI and tests
Gestión exact PR head 4e33de265bb53816780ed6940348468078385c5a: all five workflows success.
- [Build check](https://github.com/zenviacommerce/zenvia-gestion/actions/runs/39316155580) — success
- [Build ZENVIA Gestión](https://github.com/zenviacommerce/zenvia-gestion/actions/runs/39316152078) — success
- [MFA visual review (Playwright)](https://github.com/zenviacommerce/zenvia-gestion/actions/runs/39316151741) — success
- [Auth resilience tests](https://github.com/zenviacommerce/zenvia-gestion/actions/runs/39316151945) — success
- [MFA real integration (disposable Supabase)](https://github.com/zenviacommerce/zenvia-gestion/actions/runs/39316151959) — success

[Gestión main build](https://github.com/zenviacommerce/zenvia-gestion/actions/runs/39316923172) success. [Platform PR CI](https://github.com/zenviacommerce/zenvia-platform/actions/runs/39315978787) and [Platform main CI](https://github.com/zenviacommerce/zenvia-platform/actions/runs/39316150233) success. Merges used expected head SHA. Local complete suites: Gestión 156 Vitest +1,130 Node; Platform248 Node; both builds pass. Nine focused scope tests pass. Real SDK with two synthetic independent device stores reproduces global invalidation and proves local preservation; AST audits prevent unscoped calls. Independent review complete.

## Audited decisions
- Local: sidebar/mobile logout, suspended/denied access, MFA enrollment/challenge/unavailable/recovery-lock exit, factor-add re-login, workspace switching/tenant cleanup; Platform sidebar/denied access.
- Global: explicit confirmed all-devices action; completed password recovery in either app.
- Existing global server-side security: admin-users password change uses Auth admin update for the target, not caller signOut. GoTrue UpdatePassword(tx,nil) revokes target sessions. Assisted MFA public.security_mfa_authorize_enrollment deletes all target auth.sessions. No server rewrite needed.
- Initial invitation / first password activation keeps onboarding session. It is not password recovery.
- Terminal revoked/invalid session: SDK cleans local session. Timeouts/5xx/startup do not invoke app global signOut. Existing outage-preservation and MFA-disabled fail-open tests still pass. Ambiguous refresh retry design remains a separate investigation, not this incident's proven cause.

## Screenshots
Real components/shared dialog/production CSS, offline synthetic timeout, desktop/mobile: [captures](https://github.com/zenviacommerce/zenvia-gestion/tree/4e33de265bb53816780ed6940348468078385c5a/docs/deploy/logout-scope-review-20261019). All network blocked. Playwright verifies cancel0 requests, confirmed global exactly1 and visible failure. Visual check found a legacy CSS rule hiding direct mfaSettingsBody buttons; wrapping actions corrected it before PR/CI.

## Rollback
Recorded before release. Instant Rollback Gestión to dpl_Fp5stLrGQMk34DMMjyrXsyjzrREX (zenvia-gestion-q9m6tnk2a-sergiorojasdiaz-7097.vercel.app / index-DqlURX7K.js); Platform to dpl_4hptdBNNaGyNLBo4fhLgGFuqSCa9 (zenvia-platform-bdfamc6bq-sergiorojasdiaz-7097.vercel.app). Rollback restores the ordinary global-logout bug; it does not change SQL/Auth configuration. No migration, Edge Function or Auth configuration changes. MFA stays disabled with fail-open; compute SMALL unchanged.
