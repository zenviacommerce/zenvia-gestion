# Shopify Analytics

User-approved scope: a Shopify section equivalent to Amazon's period dashboard, with a store selector, sales/refunds/costs/shipping results, monthly forecast and full product list supporting link or create. Existing operational orders and shipping remain independent.

Use dedicated normalized analytics snapshots. Shopify order totals are recorded before refund subtraction; returns are recognized by refund creation date. Costs use existing internal product price history valid on the sale date. Missing FX, product costs, inventory permissions, payment fees and advertising are explicit; never replace an unknown amount with zero or declare net profit complete.

Store and workspace ownership scope every read and mapping. New Shopify menu permission; product creation additionally requires Products permission. Period cards default to Today, custom intervals filter products, monthly forecast uses complete calendar days and updates at business midnight. All interfaces use Spanish copy and support desktop/mobile/dark mode.

Selected approach: new read-only ingestion function and SQL RPCs; shared visual conventions/calendar/read queue, with Shopify-specific service and page. Shopify scopes and actual available history are reported. Existing Shopify fulfillment synchronization is not modified.

Captured sales remain in the financial history even after administrative cancellation. All line and order discounts are allocated from original line totals; refunds remain separate events. Synchronization leases serialize stores and guard catalog writes/pruning against stale workers.
