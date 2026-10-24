# Orders production emergency — awaiting approval

No persistent production modification. Other work paused.

Owner: 7461b2b7-f383-460d-b1c7-6ccbb52e42b2. Tests used authenticated role and existing valid MFA session metadata; no auth/session/configuration writes. No JWT or session identifiers saved.

Public RPC EXPLAIN ANALYZE BUFFERS: workbench3254.640ms; pickup3229.353ms. Internal plans: workbench2905.601ms, pickup3209.940ms; classified projection arm2802.655/3128.753ms, projection index scan24.038/24.298ms, projection usable gate44.082/51.474ms. Fallback arm unexecuted. Identity helper alone550.919ms; evidence1035.069ms; state2321.410ms on1009 owner rows, compared with count1.751ms.

A composite-variable identity candidate in session-local functions regressed to5182.853/5276.248ms and was discarded. A direct-field identity experiment was interrupted; it is not part of this mitigation.

Selected patch: only projected order_state and dispatched_day are reused in two private MFA implementations. Public wrappers, permissions, security attributes, projection usable gate, source version checks, fallback classification, row evidence and pickup annotations remain unchanged. Refresh code already computes both fields using #297 logic; evidence changes enqueue dirty groups. No reconstruction/backfill. Zero business rows affected, two function definitions replaced.

Validation:1009 owner rows agree on cached/live state (pending2, cancelled64, shipped943); zero dispatched_day differences. Candidate query body125.294/111.124ms. Full candidate RPC wrappers with authenticated role198.435/185.512ms. Full JSON equality in repeatable-read transaction: workbench a649ccef43e1be7cc3b8d0551ca5f6b4; pickup b61b1a785ae08ebdf23b4895fc738199. All temporary functions removed with ROLLBACK. No real shipments, invoices or emails.

Forward SQL guards exact current definition MD5 to reject concurrent updates, lock_timeout2s, transaction atomic across both definitions. Rollback contains exact original captured definitions. Apply only after explicit approval; recheck current definitions and production activity, then benchmark public RPCs with8s timeout, check returned totals, repeat default UI parallel load. If performance or equivalence fails, stop and restore. No claim that browser is recovered until production verified. Dirty projection fallback can still be slow; #299 remains subsequent work.


## Owner browser recovery confirmed

Actual browser with3 concurrent RPCs: Pending first load pickup748ms/workbench1029ms/logistics427ms; Shipped667/790/491ms. No errors; counts pending2/labelled0/shipped943/issues9/cancelled64. LESSON: ALWAYS verify real browser with concurrent calls and actual parameters, never just isolated SQL. Connector serializes SQL requests; Promise.all does not prove overlap. Second patch applied only logistics-read implementation; production isolated authenticated/8s116ms. Owner confirmed recovery.

#299 new target: all3RPC<300ms in actual browser concurrency. Panel must load logistics for visible page only. #298 approved first, then299, then VERI*FACTU0–1.
