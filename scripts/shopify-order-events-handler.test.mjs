import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { webcrypto, createHmac } from "node:crypto";
import { transform } from "esbuild";
const helperSource = (await transform(await readFile("supabase/functions/_shared/shopifyOrderEvents.ts", "utf8"), { loader: "ts", format: "esm" })).code;
const helpers = await import("data:text/javascript;base64," + Buffer.from(helperSource).toString("base64"));
const source = (await transform((await readFile("supabase/functions/shopify-order-events/index.ts", "utf8")).replace(/^import .*$/gm, ""), { loader: "ts", format: "cjs" })).code;
const account = { id: "store-a", owner_id: "owner-a", external_account_id: "shop-a.myshopify.com", config: { syncOrders: true }, enabled: true, provider: "shopify", status: "connected", credential_source: "direct" };
const callback = "https://app.test/functions/v1/shopify-order-events?account=store-a";
const event = (id, orderId) => ({ id, owner_id: "owner-a", integration_account_id: "store-a", order_id: orderId, delivery_id: id, received_at: "2026-10-20T00:00:00.000Z", next_attempt_at: "2026-10-20T00:00:00.000Z", attempts: 0, completed_at: null });
function fixture(options = {}) {
  const calls = [], tasks = [], events = structuredClone(options.events || []), hooks = structuredClone(options.hooks || []);
  let state = { owner_id: "owner-a", integration_account_id: "store-a", webhook_checked_at: (/* @__PURE__ */ new Date()).toISOString(), webhook_subscriptions: [] }, served, postCreateFailure = Boolean(options.postCreateFailure);
  const matches = (row, filters) => filters.every(([op, key, value]) => op === "eq" ? row[key] === value : op === "neq" ? row[key] !== value : op === "is" ? row[key] === value : op === "in" ? value.includes(row[key]) : op === "lte" ? String(row[key]) <= value : true);
  const admin = { from(table) {
    let action = "select", value, single = false, limit = Infinity;
    const filters = [];
    const q = { select() {
      return q;
    }, eq(k, v) {
      filters.push(["eq", k, v]);
      return q;
    }, neq(k, v) {
      filters.push(["neq", k, v]);
      return q;
    }, is(k, v) {
      filters.push(["is", k, v]);
      return q;
    }, lte(k, v) {
      filters.push(["lte", k, v]);
      return q;
    }, in(k, v) {
      filters.push(["in", k, v]);
      return q;
    }, order() {
      return q;
    }, limit(n) {
      limit = n;
      return q;
    }, maybeSingle() {
      single = true;
      return q;
    }, upsert(v) {
      action = "upsert";
      value = v;
      return q;
    }, update(v) {
      action = "update";
      value = v;
      return q;
    }, then(resolve, reject) {
      return execute().then(resolve, reject);
    } };
    async function execute() {
      calls.push({ table, action, value: structuredClone(value), filters });
      if (table === "integration_accounts") return { data: [account].filter((a) => matches(a, filters)), error: null };
      if (table === "workspaces") return { data: options.inactive ? { status: "suspended" } : { status: "active" }, error: null };
      if (table === "shopify_order_events") {
        if (action === "upsert") {
          if (options.insertGate) await options.insertGate;
          if (options.persistFail) return { data: null, error: { message: "disk unavailable" } };
          if (!events.some((e) => e.integration_account_id === value.integration_account_id && e.delivery_id === value.delivery_id)) events.push({ ...value, id: "persisted-" + events.length, received_at: (/* @__PURE__ */ new Date()).toISOString(), next_attempt_at: (/* @__PURE__ */ new Date()).toISOString(), attempts: 0, completed_at: null });
          calls.push({ durable: true });
          return { data: null, error: null };
        }
        const selected = events.filter((e) => matches(e, filters)).slice(0, limit);
        if (action === "update") for (const e of selected) Object.assign(e, value);
        return { data: single ? selected[0] || null : structuredClone(selected), error: null };
      }
      if (table === "shopify_order_sync_state") {
        if (action === "update") {
          if (postCreateFailure && value.webhook_subscriptions?.some((h) => h.id === "created-1")) {
            postCreateFailure = false;
            return { error: { message: "connection lost after Shopify create" } };
          }
          state = { ...state, ...structuredClone(value) };
        }
        return { data: structuredClone(state), error: null };
      }
      throw Error("Unhandled table " + table);
    }
    return q;
  }, rpc: async (name, args) => {
    calls.push({ rpc: name, args });
    return { data: name === "shopify_order_sync_acquire" ? !options.leaseRefused : true, error: null };
  } };
  const fetcher = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ fetch: url, body });
    if (url.startsWith("https://app.test/functions/v1/")) {
      const destination = url.split("/").pop();
      if (options.destinationDelay) await options.destinationDelay(destination, body);
      const incomplete = options.incomplete?.(destination, body);
      return Response.json(incomplete || { ok: true, configured: true, accounts: [{ synced: 1 }] });
    }
    if (body.query.includes("currentAppInstallation")) return Response.json({ data: { currentAppInstallation: { app: { apiKey: "client" } } } });
    if (body.query.includes("webhookSubscriptions(")) return Response.json({ data: { webhookSubscriptions: { nodes: structuredClone(hooks), pageInfo: { hasNextPage: false, endCursor: null } } } });
    if (body.query.includes("webhookSubscriptionCreate(")) {
      const hook = { id: "created-" + (hooks.filter((h) => h.id.startsWith("created-")).length + 1), topic: body.variables.topic, uri: body.variables.input.uri };
      hooks.push(hook);
      return Response.json({ data: { webhookSubscriptionCreate: { webhookSubscription: hook, userErrors: [] } } });
    }
    if (body.query.includes("webhookSubscriptionDelete(")) {
      const index = hooks.findIndex((h) => h.id === body.variables.id);
      if (index >= 0) hooks.splice(index, 1);
      return Response.json({ data: { webhookSubscriptionDelete: { deletedWebhookSubscriptionId: body.variables.id, userErrors: [] } } });
    }
    throw Error("Unhandled fetch " + body.query);
  };
  const module = { exports: {} };
  const deps = { module, exports: module.exports, Deno: { serve: (f) => served = f, env: { get: (k) => k === "SUPABASE_URL" ? "https://app.test" : void 0 } }, createAdminClient: () => admin, getAdminKey: () => "service-secret", requireInternalSecret: (r) => {
    if (r.headers.get("apikey") !== "service-secret") throw Error("Unauthorized");
  }, shopifyAccountCredentials: async () => ({ shopDomain: "shop-a.myshopify.com", apiVersion: "2026-10", accessToken: "access" }), shopifyStoredApplicationCredentials: async () => ({ ready: true, clientId: "client", clientSecret: "webhook-secret" }), ...helpers, fetch: fetcher, crypto: webcrypto, console: { info() {
  } }, globalThis: { EdgeRuntime: { waitUntil: (p) => tasks.push(p) } } };
  new Function(...Object.keys(deps), source)(...Object.values(deps));
  async function internal(body, authorized = true) {
    return served(new Request("https://app.test/functions/v1/shopify-order-events", { method: "POST", headers: { "Content-Type": "application/json", ...authorized ? { apikey: "service-secret" } : {} }, body: JSON.stringify(body) }));
  }
  async function webhook({ valid = true, domain = "shop-a.myshopify.com", store = "store-a", delivery = "delivery-a" } = {}) {
    const raw = JSON.stringify({ id: "123", admin_graphql_api_id: "gid://shopify/Order/123", created_at: "2026-10-19T12:00:00Z", email: "private@example.test", shipping_address: { address1: "Never persist" } });
    const signature = createHmac("sha256", valid ? "webhook-secret" : "wrong-secret").update(raw).digest("base64");
    return served(new Request("https://app.test/functions/v1/shopify-order-events?account=" + store, { method: "POST", headers: { "X-Shopify-Hmac-Sha256": signature, "X-Shopify-Shop-Domain": domain, "X-Shopify-Topic": "orders/create", "X-Shopify-Webhook-Id": delivery }, body: raw }));
  }
  return { calls, events, hooks, admin, internal, webhook, state: () => state, flush: () => Promise.all(tasks), sync: (poll = false) => module.exports.syncAccount(admin, account, poll) };
}
const writes = (s) => s.calls.filter((c) => c.action === "upsert" || c.action === "update");
const destinations = (s) => s.calls.filter((c) => c.fetch?.startsWith("https://app.test/"));
test("invalid HMAC, unauthenticated internal, and cross-store deliveries never persist", async () => {
  for (const kind of ["signature", "internal", "domain", "account"]) {
    const s = fixture();
    const response = kind === "internal" ? await s.internal({ action: "tick", integrationAccountId: "store-a" }, false) : await s.webhook(kind === "signature" ? { valid: false } : kind === "domain" ? { domain: "other.myshopify.com" } : { store: "other-store" });
    assert.ok([401, 403].includes(response.status), kind);
    assert.equal(writes(s).length, 0, kind);
    assert.equal(destinations(s).length, 0, kind);
    assert.equal(s.events.length, 0, kind);
  }
});
test("valid webhook waits for durable receipt before acknowledging or dispatching", async () => {
  let release;
  const gate = new Promise((r) => release = r);
  const s = fixture({ insertGate: gate, leaseRefused: true });
  let acknowledged = false;
  const pending = s.webhook().then((r) => {
    acknowledged = true;
    return r;
  });
  await new Promise((r) => setImmediate(r));
  assert.equal(acknowledged, false);
  assert.equal(s.calls.some((c) => c.rpc), false);
  release();
  const response = await pending;
  assert.equal(response.status, 200);
  assert.ok(s.calls.some((c) => c.durable));
  assert.equal(s.events.length, 1);
  assert.equal("email" in s.events[0], false);
  assert.equal("shipping_address" in s.events[0], false);
  await s.flush();
});
test("persistence failure never acknowledges successful delivery", async () => {
  const s = fixture({ persistFail: true });
  assert.equal((await s.webhook()).status, 403);
  assert.equal(destinations(s).length, 0);
  assert.equal(s.events.length, 0);
});
test("duplicate delivery keeps one durable event and stable receipt", async () => {
  const s = fixture({ leaseRefused: true });
  assert.equal((await s.webhook()).status, 200);
  const received = s.events[0].received_at;
  assert.equal((await s.webhook()).status, 200);
  await s.flush();
  assert.equal(s.events.length, 1);
  assert.equal(s.events[0].received_at, received);
});
test("pending event completes only after both destination imports succeed", async () => {
  const s = fixture({ events: [event("event-a", "123")] });
  const result = await s.sync();
  assert.equal(result.completed, 1);
  assert.ok(s.events[0].completed_at);
  assert.equal(destinations(s).length, 2);
  assert.ok(destinations(s).every((c) => c.body.syncSource === "webhook" && c.body.orderId === "123" && c.body.integrationAccountId === "store-a"));
  const done = s.calls.findIndex((c) => c.value?.completed_at);
  assert.ok(done > s.calls.findIndex((c) => c.fetch?.endsWith("shopify-orders")));
  assert.ok(done > s.calls.findIndex((c) => c.fetch?.endsWith("shopify-analytics-sync")));
});
for (const incomplete of [{ ok: false }, { ok: true, accounts: [{ partial: true }] }, { ok: true, accounts: [{ skipped: true }] }, { ok: true, configured: false }]) test("incomplete destination remains pending: " + JSON.stringify(incomplete), async () => {
  const s = fixture({ events: [event("event-a", "123")], incomplete: (name) => name === "shopify-analytics-sync" ? incomplete : null });
  const result = await s.sync();
  assert.ok(result.error);
  assert.equal(s.events[0].completed_at, null);
  assert.equal(s.events[0].attempts, 1);
  assert.ok(s.events[0].last_error);
  assert.ok(Date.parse(s.events[0].next_attempt_at) > Date.now());
  assert.equal(destinations(s).length, 2);
});
test("poison order stays pending while next order completes", async () => {
  const s = fixture({ events: [event("poison", "111"), event("healthy", "222")], incomplete: (_name, body) => body.orderId === "111" ? { ok: false } : null });
  const failed = await s.sync();
  assert.ok(failed.error);
  assert.equal(failed.completed, 0);
  assert.equal(s.events[0].completed_at, null);
  assert.equal(s.events[1].completed_at, null);
  const fallback = await s.sync(true);
  assert.equal(fallback.completed, 1);
  const later = await s.sync();
  assert.equal(later.completed, 1);
  assert.equal(s.events[0].completed_at, null);
  assert.ok(s.events[1].completed_at);
  assert.equal(destinations(s).length, 6);
});
test("broad polling ignores pending poison deliveries and does not mark them completed", async () => {
  const s = fixture({ events: [event("poison", "111")] });
  const result = await s.sync(true);
  assert.equal(result.completed, 1);
  assert.equal(s.events[0].completed_at, null);
  assert.equal(s.events[0].attempts, 0);
  assert.ok(destinations(s).every((c) => c.body.syncSource === "cron" && !("orderId" in c.body)));
  assert.equal(s.calls.some((c) => c.table === "shopify_order_events"), false);
});
test("registry ownership intent recovers a create followed by persistence failure", async () => {
  const s = fixture({ postCreateFailure: true });
  assert.equal((await s.internal({ action: "register", integrationAccountId: "store-a" })).status, 403);
  assert.equal(s.hooks.length, 1);
  assert.ok(s.state().webhook_subscriptions.some((h) => h.creationPending && h.createdByThisRelease && h.topic === "ORDERS_CREATE"));
  const retry = await s.internal({ action: "register", integrationAccountId: "store-a" });
  assert.equal(retry.status, 200);
  assert.equal(s.hooks.length, 2);
  assert.ok(s.state().webhook_subscriptions.every((h) => h.id && h.createdByThisRelease));
  const removed = await s.internal({ action: "unregister", integrationAccountId: "store-a" });
  assert.equal(removed.status, 200);
  assert.equal(s.hooks.length, 0);
});
test("registry never claims or removes preexisting unrelated subscriptions", async () => {
  const original = { id: "external-hook", topic: "ORDERS_CREATE", uri: callback };
  const s = fixture({ hooks: [original] });
  assert.equal((await s.internal({ action: "register", integrationAccountId: "store-a" })).status, 200);
  assert.equal(s.state().webhook_subscriptions.find((h) => h.id === "external-hook").createdByThisRelease, false);
  await s.internal({ action: "unregister", integrationAccountId: "store-a" });
  assert.deepEqual(s.hooks, [original]);
});
test("tick requires an exact account before any synchronization", async () => {
  const s = fixture();
  const response = await s.internal({ action: "tick" });
  assert.equal(response.status, 400);
  assert.equal(destinations(s).length, 0);
  assert.equal(writes(s).length, 0);
  assert.equal(s.calls.some((c) => c.rpc === "shopify_order_sync_acquire"), false);
});
test("event completion waits for both destination promises, including the slower destination", async () => {
  let release;
  const gate = new Promise((r) => release = r);
  const s = fixture({ events: [event("event-a", "123")], destinationDelay: (name) => name === "shopify-analytics-sync" ? gate : Promise.resolve() });
  let finished = false;
  const pending = s.sync().then((result) => {
    finished = true;
    return result;
  });
  await new Promise((r) => setImmediate(r));
  assert.equal(destinations(s).length, 2);
  assert.equal(finished, false);
  assert.equal(s.events[0].completed_at, null);
  release();
  await pending;
  assert.ok(s.events[0].completed_at);
});
test("exact-account tick polls independently between poison and healthy event attempts", async () => {
  const s = fixture({ events: [event("poison", "111"), event("healthy", "222")], incomplete: (_name, body) => body.orderId === "111" ? { ok: false } : null });
  const response = await s.internal({ action: "tick", integrationAccountId: "store-a" });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.ok, false);
  assert.equal(s.events[0].completed_at, null);
  assert.ok(s.events[1].completed_at);
  const bodies = destinations(s).map((c) => c.body);
  assert.deepEqual(bodies.map((b) => b.syncSource), ["webhook", "webhook", "cron", "cron", "webhook", "webhook"]);
  assert.ok(bodies.every((b) => b.integrationAccountId === "store-a"));
});
