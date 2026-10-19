# PR247 frontend release — 19 October 2026

Owner approved corrected screenshots and authorized frontend publication after all CI green.

## Pre-release rollback snapshot
Production alias gestion.zenviacommerce.com points to dpl_5y3USsBQYrJ32KSAdE2GLvMVbWua, zenvia-gestion-q1l72z26o-sergiorojasdiaz-7097.vercel.app. Existing accepted bundle index-DIsFGH6G.js. Rollback: Vercel Instant Rollback to this deployment; keep backend migration20261019170119 (backwards compatible with old frontend). No Auth/MFA configuration change.

PR246 already merged as65446632a011ccb2c737a66a16ddf0121d2fee95; independently reconfirmed before release.

PR247 reviewed head121ccc2713d5eb337bbcf4d4b585d8c0edc26795. Four CI workflows success; real Supabase integration still running. Merge remains gated on its success.

## Deferred, explicitly not implemented
- Partial margin100% with unavailable product cost is misleading: display Sin coste or Incompleto instead of a numeric100% when cost is missing. Preserve existing behaviour in this release.
- Review Amazon previous-month RPC performance (approximately331ms).

## Release result
Pending final CI, merge and Vercel production verification.
