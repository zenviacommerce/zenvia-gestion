# PR247 frontend release — 19 October 2026

Owner approved corrected screenshots and authorized frontend publication after all CI green.

## Pre-release rollback snapshot
Production alias gestion.zenviacommerce.com points to dpl_5y3USsBQYrJ32KSAdE2GLvMVbWua, zenvia-gestion-q1l72z26o-sergiorojasdiaz-7097.vercel.app. Existing accepted bundle index-DIsFGH6G.js. Rollback: Vercel Instant Rollback to this deployment; keep backend migration20261019170119 (backwards compatible with old frontend). No Auth/MFA configuration change.

PR246 already merged as65446632a011ccb2c737a66a16ddf0121d2fee95; independently reconfirmed before release.

PR247 reviewed head121ccc2713d5eb337bbcf4d4b585d8c0edc26795. All five CI workflows succeeded before merge (39311902296,39311902287,39311902396,39311902380,39311902279).

## Deferred, explicitly not implemented
- Partial margin100% with unavailable product cost is misleading: display Sin coste or Incompleto instead of a numeric100% when cost is missing. Preserve existing behaviour in this release.
- Review Amazon previous-month RPC performance (approximately331ms).

## Release result
Merged PR247 at commit7014c13a774c2646e0f036c577f5c0517a5a8a5a after CI success. Vercel production deployment dpl_Fp5stLrGQMk34DMMjyrXsyjzrREX is READY; git SHA matches; gestion.zenviacommerce.com alias points to it. Public HTML200 and JavaScript200; bundle index-DqlURX7K.js contains shopify_analytics_summary_batch. Authenticated browser check delegated to owner as requested; no claim of real-session/UI acceptance yet. No additional backend, Auth, MFA, margin or Amazon performance changes in this publication.

Rollback target remains dpl_5y3USsBQYrJ32KSAdE2GLvMVbWua / index-DIsFGH6G.js. Instant Rollback only frontend; retain backwards-compatible backend migration20261019170119.
