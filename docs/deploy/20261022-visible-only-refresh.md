# Visible-only persisted-order refresh

Independent frontend change based on main `4a26892`. No normalized tracking UI, MRW fields, history, SQL/read-model change, or page markup change.

Orders and Dashboard share one persisted-data watcher per mounted page. Fallback polling is clamped to at least 60 seconds, honors longer configured intervals, and performs no reads while hidden. Hidden tabs release their Realtime channel; returning visible binds a workspace-filtered channel and schedules one coalesced refresh. Events and polls serialize refreshes, with at most one trailing refresh while a request is slow. Stale channel callbacks are rejected after visibility/workspace changes or cleanup. Shopify uses the same visible-only lifecycle and changes its 25-second fallback to 60 seconds.

The extra Orders 30-second connector timer and Dashboard periodic Sendcloud synchronization are removed. Browser background work reads persisted data; existing server ingestion remains responsible for automatic synchronization. The explicit Orders sync button, connector/history operations, label actions, filters, selection, pagination and KPI calculations are unchanged. A local Orders refresh event has one owner for the page query, avoiding the old immediate-plus-debounced duplicate read. Initial page loading remains intact; this change controls ongoing background activity.

Verification: full main-based Vitest suite **68 files / 337 tests passed**; six Node watcher/dashboard contract tests passed; production build passed with the existing large-chunk warning. Behavioral tests cover initially hidden tabs, visible fallback timing, hidden unsubscribe, cancellation of queued bursts, stale tenant/channel callbacks, serialized slow requests, cleanup and preserved mounted Shopify search/data. No JSX changes were made.

No deployment performed. Publication remains conditional on the coordinator's production write-overhead gate: p95 added maintenance below 5 ms and no advisory-lock wait. Passing frontend tests does not establish that backend gate or the separate RPC <50 ms target.
