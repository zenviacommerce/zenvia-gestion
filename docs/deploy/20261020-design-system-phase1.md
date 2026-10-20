# Design system phase1 — approved release

Owner approved docs/design-system.md and specifically authorized #259 docs-only merge, then implementation of phase1 in a review branch. #259 merged as be32f547 after adding the1800px mobile first-item criterion, one-row header actions and adoption requirement. Owner reviewed #260 and explicitly approved publication on20Oct after the separate Shopify release, including the two small review adjustments.

## Scope and evidence

Frontend only: minimum spacing/radius tokens, KpiGrid over existing StatCard, shared PageHeader in Dashboard and Orders. Preserve data fetching, values, action handlers, filters, source channels, selection, labels and MFA.12 Orders cards now share one grid in original order. Resumen keeps its two sections. Migrated pages use two mobile columns; desktop1280/1440 uses four, dense six only at1920 when sufficient width is available.

Review and before/after screenshots: [index](design-phase1-review-20261020/README.md), [machine measurements](design-phase1-review-20261020/after-manifest.json). Actual components with deterministic synthetic data and blocked network; no claim of current production financial figures. Six required combinations390/1280/1440 for both screens, second mobile viewport, dark390 and a multi-currency stress sample.

Orders first real data-card top:3158.8→1785.2px at390×1000. First KPI1155.8→519.2px. All12 card texts/values, header/filter controls and disabled states match baseline. Baseline tests detected one-column mobile families and excessive pre-list height; candidate checks all pass. Shared primitives have3 interaction/content tests. Header row regression requires all child rectangles to overlap vertically; keyboard reaches an offscreen action, opens/cancels the actual manual form, then selection is verified in the real selection dialog. Long EUR/USD amounts stay within the card without summing currencies. StatCard has one surface; KpiGrid is layout only.

Lightweight AST guard grandfathering current legacy wrappers prevents new raw stat/stats/pageHead wrappers and requires shared headers/grids for new pages/KPI components. Guard has3 positive/negative tests and runs in Build check. Visual layout/parity checks run in the existing Playwright workflow against immutable baseline58687e42, using full history. No new dependency or lockfile changes.

## Local validation and limitations

Production build passed (existing Vite large-chunk warning retained).1169 offline Node tests passed.226 Vitest tests passed in the final sequential run after the concurrent timeout; production build and all7 visual/layout/multicurrency cases passed. The first blanket Node invocation also attempted scripts/mfa-real-integration.test.mjs, which intentionally refuses to run without RUN_LOCAL_AUTH_VAULT_TESTS=1 and disposable local Supabase Auth/Vault. That fixture is not silently skipped in CI: existing MFA integration workflow remains required. No production Auth credentials were used. A concurrent heavy local run timed out the existing pickup-reports-sql test at30s; rerun sequentially rather than weakening its timeout.

Independent review found the initially loose one-row assertion and limited new-component guard; both strengthened, with no additional confirmed functional regression. Full remote CI is required on the candidate PR before reporting ready for owner review. No frontend publication, SQL, Edge, cron or Auth changes in this phase.

## Rollback / stop

No production mutation to undo. Candidate rollback is to close/revert the review branch. If approved later for release, frontend rollback baseline is the currently stable pre-phase1 UI (dpl_BoN1LhgBjj2yaWn1koZzbYgs9xnB / main58687e42 before docs-only merge); refresh the actual production deployment ID before release. Do not deploy this branch or merge its PR without the owner's visual review.


## Approved review adjustments / release preparation

Shopify #261 already published separately: main f214974c2ef044fef8c84fd64d114406869dc3e1 / Vercel dpl_CN9CrWWkQLjXz1YFsm7AVZT7gkqv READY. This is the **updated rollback baseline**, preserving Shopify fixes. Never roll back to the pre-Shopify deployment for a design-only issue.

Merged current main into #260, resolving only the Build check workflow conflict by keeping both Shopify tests and the design guard. No further Shopify code edits in this release. Added mobile PageHeader fade/arrow only while actions remain to the right; scroll/resize removes it at the end, keeps native scrolling, keyboard access and existing handlers. No extra vertical row. Harness now sets es-ES in context, document and Chromium process language/locale: context alone left native date placeholders in US order. New screenshots show dd/mm/yyyy. Actual production browser before release shows Desde01/10/2026 and Hasta31/12/2026, confirming day/month/year for the owner's environment; native date presentation still follows the browser/OS regional settings, stored/filter ISO values unchanged.

Local checks after integrating Shopify:232 Vitest,1221 offline Node, build,7 visual cases and contract guard passed. Visual mobile first-order top remains1785.1875px. Owner approval permits publication after final remote CI green, in a separate Vercel deployment. Rollback: promote dpl_CN9CrWWkQLjXz1YFsm7AVZT7gkqv or revert only design PR #260; no SQL/Edge/cron rollback and no changes to MFA.

Updated work order in docs/design-system.md: complete Gestión's Shopify/design phases → audit Platform with screenshots and measured server pagination/KPI/RPC/EXPLAIN/cache/support/client scale, propose and STOP for owner review → MFA closure → public SP-API application → Seller Central reconciliation. No Platform implementation is authorized by recording this roadmap.
