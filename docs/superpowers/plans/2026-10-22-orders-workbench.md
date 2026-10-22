# Orders workbench implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Implement the owner's specified Orders workbench and relocate its financial summary to Dashboard, ready for review with no production publication.

**Architecture:** Preserve existing operational handlers, paginated selection and guarded projection. Extend shared PageTabs; introduce a compact filter surface and additive server workbench RPC. Reuse current financial aggregates and tariff reconciliation in Dashboard.

**Tech Stack:** React/TypeScript, @zenvia/ui, Vite, Supabase/Postgres, Vitest/PGlite, Playwright offline captures.

**Spec:** Owner's 2026-10-22 message: six tabs, server counters, five financial KPI moved, contextual actions/filters, deep links, persistent selection and mobile first viewport. That detailed instruction authorizes implementation and explicitly requires stopping before publication.

## Global constraints

- No merge, deployment, production migration, real labels, invoices or pickup reports before owner review.
- Baseline: production commit 21622348044745dd54978f69ac80f39321f39533.
- Tabs: Pendientes, Etiquetados, Enviados, Incidencias, Cancelados, Informes de recogida.
- Period only Enviados/Cancelados. Pending/Labelled/Issues are operational queues.
- Header always contains transport tariffs, direct print/format, new order, refresh and manual Shopify billing; compact overflow inside header is permitted on mobile.
- Preserve selection across tab/filter/page/sort; retain 3-state sorting and sticky columns.
- Reuse @zenvia/ui and docs/design-system.md. No auth/MFA weakening or source-order writes for analytics.
- Refresh only visible, >=60 seconds; no new full-order download for financial KPI.
- Captures before/after at 390/1280/1440 for six tabs and Dashboard; synthetic data, blocked network.
- External shipment registration remains deferred; approved scope includes selectable carrier account and actor audit.

## Review focus

1. Hidden selected IDs remain reviewable and cannot cause relabelling after changing tabs.
2. Old carrier movement with fresh check is still stale; terminal/missing dates are not falsely flagged.
3. Cost candidates outside page 1 remain in financial totals; order VAT stays distinct from invoice VAT.
4. Browser Back/Forward and authenticated deep links retain tab without leaking tenant state.
5. Mobile header and inherited CSS do not push the list below the first viewport or lose tariffs access.

## Task 1 — Inventory and baseline

- [x] Inventory Orders handlers, filters, list/detail features, financial overlap and tests.
- [x] Isolated existing worktree, branch feat/orders-workbench-review; preserve unrelated generated icon changes.
- [x] Freeze before captures from baseline revision using actual components and full CSS.

Inventory: tariffs are currently injected by OrderLabelDefaults; retain its header target or replace with explicit native button/event. All label/quote/print/edit/manual order/Shopify invoice/pickup handlers remain. Move gross/estimated VAT/net/average/carrier costs to Dashboard; invoice financial measures remain distinct. Channel pending counts move into filter option labels; overdue remains compact queue context. Existing Todos access remains secondary under Añadir filtro, with no seventh primary tab.

## Task 2 — Additive server scope

**Files:** new migration, src/services/orders.ts, tests/orders-workbench*.test.ts, orders-pagination-service.test.ts.

**Produces:** orders_workbench_v1 with existing 18 inputs plus p_tracking_stale_days=3; page response adds counters {pending,labelled,shipped,issues,cancelled}. OrdersDashboardFilters adds workbench?:boolean and trackingStaleDays?:number; state includes issues. Old service requests remain unchanged unless workbench=true.

- [x] Red tests: real legacy/active/dirty projection, tenant/MFA denial, old queue outside period, issue civil date and terminal exclusions, row/ID/counter parity and parent facets.
- [x] Clone current guarded implementation with anchored changes, preserve old wrapper/manifest exactly, add new authenticated wrapper/manifest.
- [x] Green tests and SQL review; no production installation.

## Task 3 — Shared tabs and compact filters

**Files:** packages/ui/src/PageTabs.tsx, styles.css; OrdersWorkbenchFilters.tsx and scoped CSS; focused tests.

**Produces:** PageTabs variant=workbench; filter values query/channel/country/carrier/pickupReport/tracking and partial onChange callback.

- [x] Red tests keyboard, selected tab/counts, removable chips, contextual filters and resets.
- [x] Implement horizontal overflow tabs, compact search/Add filter and shared controls.
- [x] Green focused tests and UI package build.

## Task 4 — Orders composition and URLs

**Files:** Orders.tsx, ordersWorkbench.ts, orders-workbench.css, App.tsx, PickupReports.tsx, OrderLabelDefaults.tsx; workbench route/action tests.

- [x] Red tests tab route validation/history, queue date removal, action policies and stale classification.
- [x] Implement six-tab state; ?page=orders&tab=... deep links; last tab in existing tenant/user-scoped session view cache.
- [x] Keep all handlers, sort/selection and table/card content. Header overflow for small screens; native tariffs event with injector duplicate guard.
- [x] Embed pickup history with same reprint implementation; preserve per-order modal access.
- [x] Gate primary actions by tab and retain full selection re-read safety.
- [x] Remove only financial/status KPI presentation, not quote/tariff functionality.

## Task 5 — Dashboard financial relocation

**Files:** Dashboard.tsx, OrderFinancialSummary.tsx, financial tests, uiPreferences.ts and Settings option labels.

- [x] Red tests period, page-size-1 full aggregates/candidates, recorded+tariff costs, no invoice/order VAT conflation, no duplicate gross card, error not zero.
- [x] Reuse existing aggregate RPC and pricing reconciliation; parent refresh/invalidation, no second poller.
- [x] Add five metrics; retain explicit user visibility choices and fiscal measures.
- [x] Green tests.

## Task 6 — Protection inventory, captures and review

**Files:** orders-workbench-review.mjs, docs/deploy/20261022-orders-workbench-review/, design-system.md, CI test coverage.

- [x] Actual-component interaction inventory before/after for all existing handlers.
- [x] Capture 42 requested screens; mobile first-row/overflow, header actions, selection and sort proofs.
- [x] Run full Vitest/Node suite, build and fresh independent review; resolve material findings with regression tests.
- [ ] Commit and prepare reviewable draft PR if available; CI green; do not merge or publish.
- [ ] Deliver gallery and explicit pending deployment/SQL status.

## Decisions / execution ledger

- User's detailed owner-approved specification and stop-before-publication instruction are binding; no additional design confirmation is requested for this implementation.
- Missing/invalid movement has unknown age and is not automatically an incident; exception always qualifies unless terminal/cancelled. Civil provider dates are aged as Madrid calendar days, never from last check.
- No existing business-order writes are needed for this redesign.

- Independent review found retained-route and EUR-denomination regressions; both fixed with regression coverage. Server rows now render without divergent local scope filtering; stale thresholds invalidate in-flight selection.
- Full Node suite: 1,280/1,280 pass. Production build passes. Final Vitest/capture/CI evidence recorded in deployment review directory after completion.

- Versioned preference normalization introduces the four new KPI choices for legacy explicit selections without resurrecting hidden legacy cards; no load-time preference write or schema migration. Dark visual QA corrected toolbar text and active-tab contrast. Independent follow-up review found no new P1/P2 issues.
