# Independent review — correction circuit

Review scope: the supplied 1,121-line `review.diff`, correction plan and backend report, with source reads of the base migration, current MFA integrity gate, legacy read policies, relevant UI/services/tests, rollback and concurrency gate. This records the **reviewed pre-fix snapshot**; the root agent has begun its single fix pass. No implementation was changed by this reviewer, no production tools were used, and no whole-suite rerun was performed.

## Verdict

**Spec compliance: substantially implemented, but incomplete until the Important findings below are fixed and the final checks pass. Quality: changes requested. No Critical finding identified. Keep #306 draft and unpublished.**

The intended UI circuit is present: classification and explanation, S/I-specific preloading, reason, editable lines, independent R series, bilateral navigation, derived Rectificada/Anulada, immutable original reference on PDF, and legal-annulment category/reason/confirmation. The additive migration does not rewrite issued historical invoices or backfill fiscal records. Source commercial statuses and recorded payments remain untouched. Nullable fields preserve historical ordinary invoices and unclassified signed rectifiers.

The server takes one tenant-scoped advisory lock before invoice row locks across create/issue/cancel. Original ownership/status/currency and snapshots are rechecked at issue. S/I incompatible sibling emissions are guarded, cancelled children are excluded, and correcting an emitted child retains immediate-target arithmetic. The shared financial projection correctly uses S final-minus-original and signed I amounts. New wrapper ACL and canonical empty-search-path manifest match the actual MFA public-definer gate. The correction rollback preserves history and restores backed-up functions before the base rollback.

## Important

### I1 — Kill-switch blocks cancellation of previously captured invoices

Source: `supabase/migrations/20261024193413_verifactu_correction_circuit.sql:114–118`; called implementation `supabase/migrations/20261024075749_verifactu_shadow_phase1.sql:289–292`.

When an invoice has an alta, cancellation unconditionally invokes `vf_append_record`. That function rejects any non-shadow mode with `VF_SHADOW_DISABLED`. Therefore: issue while shadow is enabled → disable shadow using the operational kill-switch → attempt a valid annulment. The annulment fails before both the cancellation row and audit event, contradicting the plan's promise that annulment remains audited with capture disabled.

Independently reproduced in disposable PGlite from the supplied fixture and both migrations: exception `VF_SHADOW_DISABLED`; persisted result `records=1, cancellations=0, cancellation_events=0`. This is inherited from the base helper but becomes a required working path in this correction circuit.

Required correction: distinguish stopping new alta capture from preserving an existing chain's legitimate annulment, or otherwise explicitly retain audited annulment without losing history. Test shadow issue → disabled cancellation, retries, source preservation and chain integrity. Root reports the backend implementer is fixing this; no post-fix review was performed here.

### I2 — New status lookup removes dashboard-only users' existing sales read access

Source: `src/services/sales.ts:203–215` (unconditional `verifactu_shadow_status` call and fail-on-error); base migration `:423–425`, `:147–150` (read RPC ultimately requires `sales`); existing policy `supabase/migrations/20260917120000_sales_module_baseline.sql:617–621` (SELECT allows `sales OR dashboard`). Consumer: `src/pages/Dashboard.tsx:40–42`.

A member with dashboard permission but no sales permission can read sales under the established policies. The newly mandatory status RPC rejects that member with `VF_ACCESS_DENIED`, causing the entire sales load to reject. Dashboard silently catches that error, leaving stale cached or zero sales/IVA figures. This is a new functional regression even though table access itself is unchanged.

The status RPC denial with sales disabled was independently reproduced in the fixture; the broader intended dashboard permission comes directly from the real RLS policy (the compact fixture does not model separate dashboard permissions).

Required correction: tenant/MFA-checked cancellation-status reading must preserve the established sales-or-dashboard read scope. Keep create/issue/cancel sales-only and do not simply ignore status errors, which would silently count cancelled invoices. Root reports this fix is in progress.

### I3 — Successful creation followed by refresh failure creates another draft on retry

Source: `src/components/SalesCorrectionModals.tsx:12`; `src/pages/SalesInvoicesCore.tsx:504`; server creation `supabase/migrations/20261024193413_verifactu_correction_circuit.sql:15,27–32`.

`create()` obtains the committed correction ID and then awaits `onCreated(id)`. If `loadSalesInvoices()` fails, or the new draft is not found, the catch returns the user to the same enabled “Crear borrador rectificativo” action and discards the returned ID. Clicking retry invokes the non-idempotent create RPC again, producing a second correction draft. Multiple I drafts can subsequently issue, so this can duplicate an adjustment rather than merely add visual clutter.

Required correction: retain the returned draft ID independently of refresh completion and retry opening/loading that same ID without creating again. Add a behavior test where creation succeeds, the first refresh fails, and retry makes one create RPC call total. A server idempotency key is additionally useful for an ambiguous network response, but the confirmed refresh-failure defect does not require redesigning the whole RPC. Root is handling this fix.

## Minor findings and inherited limitations

1. **Collection filters still use commercial status.** `src/pages/SalesInvoicesCore.tsx:313–315` checks `invoice.status` for open/overdue filters while row labels, overdue markers, actions and KPIs use derived status. An issued invoice with `fiscalStatus='cancelled'` or `'rectified'` can remain in “Pendientes”/“Vencidas”, even though its row has no collectible balance/action. Align those filters with the same derived-status eligibility used by the UI.

2. **The provided dark cancellation image is not acceptable final evidence.** `artifacts/verifactu-correction/07-cancellation-confirm-1440-dark.png` shows pale reason text on a white field and an unchecked confirmation checkbox. Root traced this to capture during a theme transition plus HTML serialization of checked DOM state, rather than proving a persistent production CSS defect. Disable motion/wait for settled theme, serialize checked state, regenerate and inspect before claiming visual GREEN. This is an evidence issue, not a confirmed implementation blocker. The inspected mobile editor screenshot is legible and keeps footer actions available.

3. **Inherited multi-request draft saving is still non-atomic.** `src/services/sales.ts:238` separately commits header update, line deletion and line insertion; the correction editor now uses it for reason/type and amounts. A second session can issue after the header commit but before lines are replaced, freezing the new reason/type with the old lines. A failed insert also leaves the saved draft without its prior lines. The fiscal guards prevent editing an already issued invoice but do not make the user's whole save atomic. This implementation predates the diff, so it is recorded separately from newly introduced blockers. An atomic draft-save RPC sharing the fiscal lock order would close it; at minimum document the limitation instead of claiming save/issue concurrency has been fully proved.

4. **PDF long-reason verification is weaker than the plan.** The new reference/reason loop has page-boundary logic, but `tests/verifactu-correction-pdf.test.ts` only tests a short one-page reason and legacy ordinary content. A 1,000-character multiline reason followed by line items should be rendered/inspected to substantiate the specific long-reason/pagination claim. No concrete new PDF overflow was established in this review.

## Verification boundaries and final acceptance

- Read the supplied unit/SQL/concurrency code and implementation report; the reported target 57 tests and running full suite were not rerun independently.
- Executed only isolated in-memory SQL reproductions for I1 and I2, using synthetic fixture data. The first diagnostic query used the wrong audit-column name; it was corrected to `event_kind` and the successful final reproduction produced the counts quoted above.
- Inspected the 390px light editor and 1440px dark annulment screenshots and measurement manifest; did not claim inspection of all 40 images.
- Real PostgreSQL concurrency remains a CI requirement, especially because PGlite cannot prove competing-session lock behavior. The supplied script covers cancellation/create/issue order and sibling issuance conflicts with deterministic barriers.
- Final acceptance belongs to the root's single fix pass, new regression tests, full GREEN suite/build/contracts, settled visual/PDF evidence and CI on the final PR head. This review does not authorize production SQL, deployment, AEAT resources or historical-invoice mutations.

## Cierre del implementador, posterior a la revisión

Los tres Important se reprodujeron y corrigieron con regresiones RED→GREEN: anulación tras disable conserva cadena, lectura conserva sales OR dashboard+MFA sin abrir escritura y reintento de recarga reutiliza el ID creado. Se cerró además el guardado multi-request heredado para borradores rectificativos mediante RPC atómica y se añadieron carreras PostgreSQL en ambos órdenes. Los filtros pendientes/vencidos excluyen estados fiscales anulada/rectificada, comprobado RED→GREEN. Capturas regeneradas sin transiciones y con checked serializado; móvil oscuro y editor de líneas inspeccionados. PDF de 1.000 caracteres/80 conceptos: 4 páginas renderizadas, primera/última inspeccionadas.

Evidencia local final: 1028 Vitest pasan, 2 harness visuales opt-in omitidos en la suite normal pero ejecutados expresamente para capturas; 1292 contratos Node pasan; build pasa (advertencia previa de tamaño de chunk). 36 casos SQL y 9 proyección fiscal incluidos. El gate real PostgreSQL y MFA real siguen siendo requisitos de CI del SHA definitivo, no se deducen de PGlite. Sin producción. No se pidió segunda revisión independiente: las correcciones se verifican con tests de regresión y suite verde.
