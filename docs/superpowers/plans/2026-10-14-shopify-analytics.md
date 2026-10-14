# Shopify Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deliver the approved Shopify period dashboard with accurate provenance and product mapping.
**Architecture:** Dedicated owner/store-scoped analytics snapshots, readonly Shopify sync and SQL RPCs; independent React page sharing existing visual/calendar patterns.
**Tech Stack:** React 19, TypeScript, Supabase/Postgres, Shopify Admin GraphQL.
**Spec:** docs/superpowers/specs/2026-10-14-shopify-analytics.md

## Constraints

- Keep fulfillment/shipping code unchanged.
- No invented zero costs/fees/advertising/inventory. Mark incomplete results.
- Secure server credentials and owner/store authorization for every endpoint.
- Reuse existing internal cost history and atomic create/link semantics.

## Review focus

Refunds after the sale period; store/workspace switching during reads; overlapping syncs; incomplete catalog/history scopes; duplicate SKU/product creation.

## Tasks

- [x] Backend: normalized tables/indexes/RLS, summary/products/status/options RPCs, atomic mapping/create RPCs. Test currency/date/refund isolation and ownership; apply migrations.
- [x] Ingestion: readonly Shopify analytics sync, pagination/limits/status/provenance, optional catalog/inventory permissions. Test normalization and authorization; deploy and synchronize connected stores.
- [x] UI/service: scoped cache/deduplication, period carousel/date editing/forecast/store filter, full product list and mapping/create flow, unknown data states. Test actual interactions and calendar rollover.
- [x] App integration: permission, navigation, route and admin-user permission backend. Validate ordinary-user separation.
- [x] Review/integration: independent review, full tests/build, live SQL totals and authenticated flow, GitHub main lease deployment and production asset verification.

## Validation evidence

Initial two-store import completed successfully (10 orders, 22 units). Independent review identified and fixed business timezone, test refunds, paid cancelled sales, unknown costs/FX, workspace response guards and catalog reconciliation. Rollback SQL fixtures verify financial boundaries, permission-safe create/link, duplicate SKU rejection, unknown inventory and stale synchronization leases. Read-only analytics cron runs every 30 minutes.

Current connections do not grant product/catalog/inventory scopes; those data are explicitly unavailable. Empty SKU lines cannot be permanently linked until catalog authorization supplies stable variant identifiers. Payment fees and Ads remain unknown, so net profit stays provisional.

Final checks: 971 tests passed; production build passed; item totals €334.31 + shipping €3.95 reconcile to order totals €338.26. Both stores synchronized without errors.
