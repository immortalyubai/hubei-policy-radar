import assert from "node:assert/strict";
import test from "node:test";

async function fetchPath(path, init = {}) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${Math.random()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`http://localhost${path}`, init),
    {
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("renders the policy radar with verified Hubei records", async () => {
  const response = await fetchPath("/", { headers: { accept: "text/html" } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>华中政策雷达/);
  assert.match(html, /每天，只看值得/);
  assert.match(html, /2026年“数据要素×”大赛湖北分赛/);
  assert.match(html, /湖北省科技创新券申领和兑付/);
  assert.match(html, /湖北省国民经济和社会发展第十五个五年规划纲要/);
  assert.match(html, /公众号首发 · 待核验/);
  assert.match(html, /官网已核验/);
  assert.doesNotMatch(html, /Your site is taking shape|Building your site/);
});

test("renders a policy detail page and preserves the official source link", async () => {
  const response = await fetchPath("/items/hubei-data-factor-contest-2026", {
    headers: { accept: "text/html" },
  });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /2026年“数据要素×”大赛湖北分赛/);
  assert.match(html, /打开官网原文/);
  assert.match(html, /wehdz\.gov\.cn/);
  assert.match(html, /以政府官网原文为准/);
});

test("renders official and WeChat source status", async () => {
  const response = await fetchPath("/sources", { headers: { accept: "text/html" } });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /湖北省科技厅通知/);
  assert.match(html, /湖北公众号白名单/);
  assert.match(html, /待启用/);
});

test("exposes a read-only JSON feed", async () => {
  const response = await fetchPath("/api/items?type=event&limit=10");
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.count, 3);
  assert.ok(payload.items.every((item) => item.itemType === "event"));
});

test("keeps a real WeChat-first policy pending official verification", async () => {
  const response = await fetchPath("/api/items?verification=pending_official");
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.count, 1);
  assert.equal(payload.items[0].primarySourceType, "wechat");
  assert.match(payload.items[0].primaryUrl, /^https:\/\/mp\.weixin\.qq\.com\/s\//);
});

test("fails closed when write ingestion is not configured", async () => {
  const response = await fetchPath("/api/import/wechat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "https://mp.weixin.qq.com/s/example" }),
  });
  assert.equal(response.status, 503);
  const payload = await response.json();
  assert.equal(payload.error, "wechat import is not configured");
});
