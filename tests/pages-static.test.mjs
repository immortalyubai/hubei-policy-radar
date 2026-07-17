import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

function collectObjectKeys(value, keys = []) {
  if (!value || typeof value !== "object") return keys;
  if (Array.isArray(value)) {
    for (const entry of value) collectObjectKeys(entry, keys);
    return keys;
  }
  for (const [key, entry] of Object.entries(value)) {
    keys.push(key);
    collectObjectKeys(entry, keys);
  }
  return keys;
}

test("builds a relative-path GitHub Pages entry", async () => {
  const html = await readFile(new URL("pages-dist/index.html", root), "utf8");
  assert.match(html, /华中政策雷达/);
  assert.match(html, /src="\.\/assets\//);
  assert.match(html, /href="\.\/assets\//);
  assert.doesNotMatch(html, /chatgpt\.site/);
});

test("bundles real Hubei policies and mobile filters", async () => {
  const assets = await readdir(new URL("pages-dist/assets/", root));
  const scripts = assets.filter((name) => name.endsWith(".js"));
  assert.ok(scripts.length > 0);
  const bundle = (await Promise.all(scripts.map((name) => readFile(new URL(`pages-dist/assets/${name}`, root), "utf8")))).join("\n");
  assert.match(bundle, /2026年“数据要素×”大赛湖北分赛/);
  assert.match(bundle, /湖北省科技创新券申领和兑付/);
  assert.match(bundle, /湖北省支持人工智能OPC发展若干措施/);
  assert.match(bundle, /武汉市支持人工智能OPC创新发展若干措施/);
  assert.match(bundle, /打开公众号原文/);
  assert.match(bundle, /打开政府公报PDF/);
  assert.match(bundle, /mobile-verify-tabs/);
  assert.match(bundle, /湖北发布/);
  assert.match(bundle, /湖北科技/);
  assert.match(bundle, /武汉科技创新/);
  assert.match(bundle, /个账号运行中/);
  assert.match(bundle, /公众号监测 · 状态快照/);
});

test("publishes only sanitized policy data", async () => {
  const source = await readFile(new URL("static-site/data/policy-data.json", root), "utf8");
  const payload = JSON.parse(source);
  assert.ok(payload.items.length >= 18);
  assert.ok(payload.sources.length >= 7);
  assert.ok(payload.items.every((item) => /^https:\/\//.test(item.primaryUrl)));
  const opcItems = payload.items.filter((item) => item.topics?.includes("OPC"));
  assert.equal(opcItems.length, 8);
  assert.ok(opcItems.some((item) => item.id === "hubei-opc-support-measures-2026"));
  assert.ok(opcItems.some((item) => item.id === "wuhan-opc-support-measures-2026"));
  assert.ok(opcItems.every((item) => item.topics[0] === "OPC"));
  assert.ok(opcItems.flatMap((item) => item.sourceLinks ?? []).every((link) => /^https:\/\//.test(link.url)));
  assert.equal(new Set(payload.items.map((item) => item.id)).size, payload.items.length);
  assert.equal(new Set(payload.items.map((item) => item.primaryUrl)).size, payload.items.length);

  const wechatSources = payload.sources.filter((entry) => entry.sourceType === "wechat");
  assert.equal(wechatSources.length, 3);
  assert.deepEqual(
    wechatSources.map((entry) => entry.name).sort((left, right) => left.localeCompare(right, "zh-CN")),
    ["湖北发布", "湖北科技", "武汉科技创新"].sort((left, right) => left.localeCompare(right, "zh-CN")),
  );
  assert.ok(wechatSources.every((entry) => entry.healthStatus === "healthy"));
  assert.ok(wechatSources.every((entry) => entry.pollIntervalMinutes === 120));
  assert.ok(wechatSources.every((entry) => /^\d{4}-\d{2}-\d{2}T/.test(entry.lastCheckedAt)));
  assert.ok(wechatSources.every((entry) => entry.lastCheckedAt === entry.lastSuccessAt));
  assert.ok(wechatSources.every((entry) => Number.isInteger(entry.lastInsertedCount) && entry.lastInsertedCount >= 0));
  assert.ok(wechatSources.every((entry) => /^\d{4}-\d{2}-\d{2}T/.test(entry.loginExpiresAt)));
  assert.ok(wechatSources.every((entry) => Object.hasOwn(entry, "lastErrorMessage")));
  assert.ok(wechatSources.every((entry) => entry.consecutiveFailures === 0));
  assert.equal(wechatSources.reduce((sum, entry) => sum + entry.lastInsertedCount, 0), 2);
  assert.ok(!payload.sources.some((entry) => entry.id === "wechat-watchlist"));

  const sensitiveKeys = collectObjectKeys(payload).filter((key) =>
    /^(?:auth-key|x-auth-key|sessionid|fakeid|cookie|token)$/i.test(key)
  );
  assert.deepEqual(sensitiveKeys, []);
  assert.doesNotMatch(source, /"(?:auth-key|x-auth-key|sessionid|fakeid|cookie|token)"\s*:/i);
});
