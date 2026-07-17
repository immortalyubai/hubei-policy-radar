import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

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
  assert.doesNotMatch(source, /"(?:auth-key|x-auth-key|sessionid|cookie|token)"\s*:/i);
});
