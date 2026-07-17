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
  assert.match(html, /湖北省支持人工智能OPC发展若干措施/);
  assert.match(html, /武汉市支持人工智能OPC创新发展若干措施/);
  assert.match(html, /湖北省国民经济和社会发展第十五个五年规划纲要/);
  assert.match(html, /关于发布煤炭重大专项2027年度公开项目申报指南的通知/);
  assert.match(html, /国家网络空间安全国家科技重大专项第三批项目/);
  assert.match(html, /公众号首发 · 待核验/);
  assert.match(html, /公众号监测 · 最近快照/);
  assert.match(html, /账号最近正常/);
  assert.doesNotMatch(html, /公众号实时监测|账号在线|每 2 小时更新/);
  assert.match(html, /官网已核验/);
  assert.doesNotMatch(html, /Your site is taking shape|Building your site/);
});

test("renders an OPC policy with official and WeChat source links", async () => {
  const response = await fetchPath("/items/wuhan-opc-support-measures-2026", {
    headers: { accept: "text/html" },
  });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /武政规〔2026〕4号/);
  assert.match(html, /打开市政府原文/);
  assert.match(html, /打开公众号原文/);
  assert.match(html, /mp\.weixin\.qq\.com\/s\/CoN0rM5jy_umstjvHSgYHQ/);
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
  assert.match(html, /湖北发布/);
  assert.match(html, /湖北科技/);
  assert.match(html, /武汉科技创新/);
  assert.match(html, /每 2 小时/);
  assert.match(html, /登录有效期/);
  assert.match(html, /正常/);
  assert.match(html, /电脑休眠/);
  assert.doesNotMatch(html, /湖北公众号白名单|待启用/);
});

test("exposes exactly three healthy two-hour WeChat monitors", async () => {
  const response = await fetchPath("/api/sources");
  assert.equal(response.status, 200);
  const payload = await response.json();
  const wechatSources = payload.sources.filter((source) => source.sourceType === "wechat");
  assert.equal(wechatSources.length, 3);
  assert.deepEqual(
    wechatSources.map((source) => source.name).sort((left, right) => left.localeCompare(right, "zh-CN")),
    ["湖北发布", "湖北科技", "武汉科技创新"].sort((left, right) => left.localeCompare(right, "zh-CN")),
  );
  assert.ok(wechatSources.every((source) => source.healthStatus === "healthy"));
  assert.ok(wechatSources.every((source) => source.pollIntervalMinutes === 120));
  assert.equal(wechatSources.reduce((sum, source) => sum + source.lastInsertedCount, 0), 2);
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
  assert.equal(payload.count, 3);
  assert.ok(payload.items.every((item) => item.primarySourceType === "wechat"));
  assert.ok(payload.items.every((item) => /^https:\/\/mp\.weixin\.qq\.com\/s\//.test(item.primaryUrl)));
  assert.ok(payload.items.some((item) => item.id === "wechat-wuhan-innovation-1b2c11ff74a1"));
  assert.ok(payload.items.some((item) => item.id === "wechat-wuhan-innovation-5c022126f3ad"));
});

test("exposes the OPC topic through the read-only feed", async () => {
  const response = await fetchPath("/api/items?q=OPC&limit=50");
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.ok(payload.count >= 8);
  assert.ok(payload.items.some((item) => item.id === "hubei-opc-support-measures-2026"));
  assert.ok(payload.items.some((item) => item.id === "wechat-national-opc-policy-report-2026"));
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
