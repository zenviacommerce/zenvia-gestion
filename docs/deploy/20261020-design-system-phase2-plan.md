# Phase 2 implementation plan

> Execute inline, using the approved docs/design-system.md contract and the owner's explicit continue/stop-before-publication instruction.

**Goal:** consistent headers, filters and tabs in Facturacion, Gastos and Recibos, two mobile KPI columns and contained multi-currency costs, preserving figures, actions, filters and list behavior.
**Baseline:** published phase1 aa8677ddf09a4b64be74a80ff8df26fe762405bc / index-DqEFHKNh.js / Vercel dpl_FXFkLqauYMkr7aiJBiRRpP4HhXMA.
**Architecture:** reuse PageHeader, KpiGrid/StatCard and PeriodFilterPanel. Add minimal FilterBar and PageTabs wrappers; migrate only the listed screens. Keep data services and calculations, including separate currency totals. Preserve SalesInvoices header-action portal and retained Gmail import tabs. No SQL/Edge/Auth/cron or production changes.

- [x] Record task1 owner verification and rollback (previous Shopify-only deployment dpl_CN9CrWWkQLjXz1YFsm7AVZT7gkqv).
- [x] Capture immutable baseline actual components + complete CSS + AutoPagination/UnifiedListExperience at390/1280/1440, es-ES, synthetic data and blocked network. Measure first real row/card top; target<1800px at390x1000. Include multi-currency costs and all header actions including portal.
- [x] Add common FilterBar/PageTabs; use PageHeader and KpiGrid on the3 screens; migrate existing tab wrappers without altering actions or import retention. Compact mobile filters to2 columns and one-row header actions. Remove only migrated layout overrides.
- [x] Test tab selection/keyboard, filter interaction, header portal actions and mobile list selection. Compare KPI text, filter controls, disabled states and first item against baseline. Amounts remain distinct per currency; no hidden metrics/actions to meet the height target.
- [ ] Capture after at same sizes plus dark/mobile and multi-currency stress; run full app/Node suites, contract guard and production build; open draft PR and verify remote CI. STOP before merge/publication; provide screenshots/measurements and rollback to current phase1 deployment.

Review focus: hidden retained imports must not remount; late portal buttons must remain visible/accessibly scrollable; all filters retained; one surface per KPI; long EUR/USD amounts stay within a2-column card; selection and query changes preserve existing behavior rather than changing business rules.

Updated baseline: inherited published hotfix #262 via fast-forward to f287ff5e before preparing review. Production rollback for phase2 is now dpl_BmTNRNtFRo6Q6fMyhcHYTkUNusge, not the pre-hotfix deployment. Exact measurements and verification: 20261020-design-system-phase2.md.

Hotfix264 publicado por separado: nueva base/rollback cfa6d3da / dpl_5KjeeSo3VSXSqNJjCPaNV4oNCRFP / index-1XUnT9OV.js. Guardia compartida de acciones incorporada al harness de las tres pantallas; prueba del acceso a Tarifas heredada del hotfix. PR263 permanece borrador sin fusionar.
