import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { transform } from "esbuild";
const isCheckpoint = (c) => c.rpc === "shopify_commit_orders_cursor" || c.action === "update" && Boolean(c.value?.last_synced_at || c.value?.config?.shopify_orders_cursor_at);
async function handler(name, options = {}) {
  let handle;
  const calls = [];
  const account = { id: "store", owner_id: "owner", config: { shopify_orders_cursor_at: "2026-10-19T12:00:00Z" }, enabled: true };
  const admin = { auth: { getUser: async () => ({ data: { user: { id: "human" } } }) }, from(table) {
    let action = "read", value;
    const q = { select() {
      return q;
    }, eq() {
      return q;
    }, neq() {
      return q;
    }, in() {
      return q;
    }, order() {
      return q;
    }, limit() {
      return q;
    }, update(v) {
      action = "update";
      value = v;
      return q;
    }, upsert(v) {
      action = "upsert";
      value = v;
      return q;
    }, maybeSingle() {
      if (action !== "read") calls.push({ table, action, value });
      return Promise.resolve({ data: options.checkpointFail && action === "update" ? null : table === "workspaces" ? { status: options.inactive ? "suspended" : "active" } : table === "app_users" ? { active: true, role: "admin", data_owner_id: "owner" } : table === "shopify_analytics_sync_state" ? { last_synced_at: "2026-10-19T12:00:00Z", history_complete: true } : { config: {} } });
    }, then(resolve) {
      calls.push({ table, action, value });
      return Promise.resolve({ data: table === "integration_accounts" && action === "read" ? options.noAccount ? [] : options.twoStores ? [account, { ...account, id: "store2" }] : [account] : table === "fulfillment_orders" && action === "read" && options.stale ? [{ sendcloud_id: "shopify:store:123", order_updated_at: "2026-10-21T00:00:00Z" }] : [], error: action === "upsert" && options.writeFail ? { message: "write failed" } : null }).then(resolve);
    } };
    return q;
  }, rpc: async (name2, args) => {
    calls.push({ rpc: name2, args });
    return { data: name2 === "shopify_commit_orders_cursor" ? !options.commitRefused : name2 === "shopify_analytics_claim_sync" ? !options.leased : null, error: options.commitError && name2 === "shopify_commit_orders_cursor" ? { message: "commit failed" } : options.traceFail && name2 === "shopify_record_order_ingestion" ? { message: "trace failed" } : null };
  } };
  let pages = 0;
  const fetcher = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ graphql: body });
    if (body.query.includes("currentAppInstallation")) return Response.json({ data: { currentAppInstallation: { accessScopes: [] } } });
    const order = { id: options.wrongTarget ? "gid://shopify/Order/999" : "gid://shopify/Order/123", legacyResourceId: options.wrongTarget ? "999" : "123", createdAt: "2026-10-19T00:00:00Z", updatedAt: "2026-10-20T00:00:00Z", lineItems: { nodes: [], pageInfo: {} }, refunds: [] };
    if (body.query.includes("orders(")) {
      pages++;
      if (options.pageFail && pages === 2) throw Error("page failed");
      return Response.json({ data: { orders: { nodes: options.malformed ? null : options.absent ? [] : [order], pageInfo: { hasNextPage: !!options.forever || !!options.pageFail && pages === 1, endCursor: "page" + pages } } } });
    }
    return Response.json({ data: { order } });
  };
  const source = (await readFile(`supabase/functions/${name}/index.ts`, "utf8")).replace(/^import .*$/gm, "");
  const code = (await transform(source, { loader: "ts", format: "cjs" })).code;
  const deps = { Deno: { serve: (f) => handle = f, env: { get: (k) => k === "SUPABASE_URL" ? "https://test" : k === "SUPABASE_SERVICE_ROLE_KEY" ? "secret" : void 0 } }, createClient: () => admin, createAdminClient: () => admin, requireInternalSecret: (r) => {
    if (r.headers.get("apikey") !== "secret") throw Error("Llamada interna no autorizada.");
  }, assertHumanMfa: async () => {
    calls.push({ mfa: true });
    if (options.mfaFail) throw Error("MFA required");
  }, authenticateUser: async () => {
    calls.push({ mfa: true });
    if (options.mfaFail) throw Error("MFA required");
    return { data_owner_id: "owner", role: "admin" };
  }, shopifyAnalyticsCallerAllowed: () => true, shopifyAccountCredentials: async (_admin, a) => {
    if (options.firstStoreFail && a.id === "store") throw Error("first store failed");
    return { shopDomain: "shop.test" };
  }, shopifyStoredApplicationCredentials: async () => ({}), shopifyError: (e) => String(e?.message || e), preserveShopifyLabelTracking: (rows) => rows, resolveOrderPackageWeight: async () => null, normalizeShopifyAnalyticsOrder: (o) => ({ order: { order_id: o.legacyResourceId } }), fetch: fetcher };
  new Function(...Object.keys(deps), code)(...Object.values(deps));
  return { calls, run: async (body, secret = true) => {
    const r = await handle(new Request("https://test", { method: "POST", headers: { "content-type": "application/json", Authorization: "Bearer human", ...secret ? { apikey: "secret" } : {} }, body: JSON.stringify(body) }));
    return { status: r.status, body: await r.json() };
  } };
}
for (const name of ["shopify-orders", "shopify-analytics-sync"]) {
  test(name + " rejects fake internal owner", async () => {
    const s = await handler(name);
    const r = await s.run({ ownerId: "owner", integrationAccountId: "store", syncSource: "webhook", orderId: "123" }, false);
    assert.ok([401, 403].includes(r.status));
    assert.equal(s.calls.some((c) => c.graphql), false);
  });
  test(name + " targeted import traces verified source and leaves global cursor alone", async () => {
    const s = await handler(name);
    const r = await s.run({ ownerId: "owner", integrationAccountId: "store", syncSource: "webhook", orderId: "123" });
    assert.equal(r.body.ok, true);
    assert.ok(s.calls.some((c) => c.graphql?.variables?.query === "id:123"));
    assert.ok(s.calls.some((c) => c.rpc === "shopify_record_order_ingestion" && c.args.source === "webhook"));
    assert.equal(s.calls.some((c) => isCheckpoint(c)), false);
  });
  test(name + " validates workspace for internal requests", async () => {
    const s = await handler(name, { inactive: true });
    const r = await s.run({ ownerId: "owner", integrationAccountId: "store", syncSource: "cron" });
    assert.equal(r.status, 403);
    assert.equal(s.calls.some((c) => c.graphql), false);
  });
  test(name + " missing target is unsuccessful", async () => {
    const s = await handler(name, { absent: true });
    const r = await s.run({ ownerId: "owner", integrationAccountId: "store", syncSource: "webhook", orderId: "123" });
    assert.notEqual(r.body.ok, true);
  });
}
test("operational truncated pagination never checkpoints", async () => {
  const s = await handler("shopify-orders", { forever: true });
  const r = await s.run({ ownerId: "owner", integrationAccountId: "store", syncSource: "cron" });
  assert.notEqual(r.body.ok, true);
  assert.equal(s.calls.some((c) => c.action === "update" && c.value?.config?.shopify_orders_cursor_at), false);
});
for (const name of ["shopify-orders", "shopify-analytics-sync"]) {
  test(name + " trace failure prevents checkpoint", async () => {
    const s = await handler(name, { traceFail: true });
    const r = await s.run({ ownerId: "owner", integrationAccountId: "store", syncSource: "cron" });
    assert.equal(r.body.ok, false);
    assert.equal(s.calls.some((c) => isCheckpoint(c)), false);
  });
  test(name + " page failure prevents checkpoint", async () => {
    const s = await handler(name, { pageFail: true });
    const r = await s.run({ ownerId: "owner", integrationAccountId: "store", syncSource: "cron" });
    assert.equal(r.body.ok, false);
    assert.equal(s.calls.some((c) => isCheckpoint(c)), false);
  });
  test(name + " manual calls require MFA", async () => {
    const s = await handler(name, { mfaFail: true });
    const r = await s.run({}, false);
    assert.notEqual(r.body.ok, true);
    assert.ok(s.calls.some((c) => c.mfa));
    assert.equal(s.calls.some((c) => c.graphql), false);
  });
  test(name + " manual calls cannot forge webhook provenance", async () => {
    const s = await handler(name);
    const r = await s.run({ syncSource: "webhook" }, false);
    assert.equal(r.body.ok, true);
    assert.ok(s.calls.some((c) => c.rpc === "shopify_record_order_ingestion" && c.args.source === (name === "shopify-orders" ? "browser" : "manual")));
  });
  test(name + " rejects unavailable exact internal account", async () => {
    const s = await handler(name, { noAccount: true });
    const r = await s.run({ ownerId: "owner", integrationAccountId: "missing", syncSource: "webhook", orderId: "123" });
    assert.notEqual(r.body.ok, true);
  });
}
test("operational old snapshot cannot overwrite newer persisted order", async () => {
  const s = await handler("shopify-orders", { stale: true });
  const r = await s.run({ ownerId: "owner", integrationAccountId: "store", syncSource: "webhook", orderId: "123" });
  assert.equal(r.body.ok, true);
  assert.equal(s.calls.filter((c) => c.action === "upsert").flatMap((c) => c.value).length, 0);
});
test("operational write failure prevents checkpoint", async () => {
  const s = await handler("shopify-orders", { writeFail: true });
  const r = await s.run({ ownerId: "owner", integrationAccountId: "store", syncSource: "cron" });
  assert.equal(r.body.ok, false);
  assert.equal(s.calls.some((c) => c.action === "update"), false);
});
test("analytics lease refusal is surfaced for retry without fetching", async () => {
  const s = await handler("shopify-analytics-sync", { leased: true });
  const r = await s.run({ ownerId: "owner", integrationAccountId: "store", syncSource: "webhook", orderId: "123" });
  assert.equal(r.body.skipped, true);
  assert.equal(r.body.accounts[0].skipped, true);
  assert.equal(s.calls.some((c) => c.graphql), false);
});
for (const name of ["shopify-orders", "shopify-analytics-sync"]) {
  test(name + " full import checkpoints to bounded run start", async () => {
    const before = Date.now();
    const s = await handler(name);
    const r = await s.run({ ownerId: "owner", integrationAccountId: "store", syncSource: "cron" });
    assert.equal(r.body.ok, true);
    const checkpoint = s.calls.find((c) => isCheckpoint(c));
    assert.ok(checkpoint);
    const value = checkpoint.args?.checkpoint_at || checkpoint.value.last_synced_at || checkpoint.value.config.shopify_orders_cursor_at;
    assert.ok(Date.parse(value) >= before && Date.parse(value) <= Date.now());
    assert.ok(s.calls.some((c) => c.graphql?.variables?.query?.includes("updated_at:<=") && c.graphql.variables.query.includes(value)));
  });
  test(name + " a failed store does not prevent another store import", async () => {
    const s = await handler(name, { twoStores: true, firstStoreFail: true });
    const r = await s.run({}, false);
    assert.equal(r.body.ok, false);
    assert.ok(r.body.accounts.some((a) => a.error));
    assert.ok(r.body.accounts.some((a) => a.synced === 1));
    assert.equal(s.calls.filter((c) => isCheckpoint(c)).length, 1);
  });
}
for (const name of ["shopify-orders", "shopify-analytics-sync"]) test(name + " will not persist a mismatched targeted result", async () => {
  const s = await handler(name, { wrongTarget: true });
  const r = await s.run({ ownerId: "owner", integrationAccountId: "store", syncSource: "webhook", orderId: "123" });
  assert.equal(r.body.ok, false);
  assert.equal(s.calls.some((c) => c.action === "upsert" || c.rpc === "shopify_analytics_ingest"), false);
});
test("operational malformed order page never checkpoints", async () => {
  const s = await handler("shopify-orders", { malformed: true });
  const r = await s.run({ ownerId: "owner", integrationAccountId: "store", syncSource: "cron" });
  assert.equal(r.body.ok, false);
  assert.equal(s.calls.some(isCheckpoint), false);
});
for (const option of ["commitRefused", "commitError"]) test("operational atomic checkpoint " + option + " fails store", async () => {
  const s = await handler("shopify-orders", { [option]: true });
  const r = await s.run({ ownerId: "owner", integrationAccountId: "store", syncSource: "cron" });
  assert.equal(r.body.ok, false);
  assert.ok(s.calls.some((c) => c.rpc === "shopify_commit_orders_cursor"));
  assert.equal(s.calls.some((c) => c.action === "update" && c.value?.config), false);
});
test("operational cursor commit is scoped and never writes loaded config", async () => {
  const s = await handler("shopify-orders");
  const r = await s.run({ ownerId: "owner", integrationAccountId: "store", syncSource: "cron" });
  assert.equal(r.body.ok, true);
  const commit = s.calls.find((c) => c.rpc === "shopify_commit_orders_cursor");
  assert.equal(commit.args.owner, "owner");
  assert.equal(commit.args.store, "store");
  assert.ok(Date.parse(commit.args.checkpoint_at));
  assert.equal(s.calls.some((c) => c.action === "update" && c.value?.config), false);
});
