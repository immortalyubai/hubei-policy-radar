#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const key = process.argv[index];
  if (key.startsWith("--")) args.set(key.slice(2), process.argv[index + 1]?.startsWith("--") ? true : process.argv[++index]);
}

const inputPath = resolve(String(args.get("input") || "work/hubei-collection.json"));
const dataPath = resolve(String(args.get("data") || "static-site/data/policy-data.json"));
const now = new Date().toISOString();

function normalizeUrl(value) {
  const url = new URL(value);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|spm|from|source|scene)/i.test(key)) url.searchParams.delete(key);
  }
  return url.href.replace(/\/$/, "");
}

function stableId(candidate) {
  const slug = String(candidate.source?.id || "policy").replace(/[^a-z0-9-]+/gi, "-").toLowerCase();
  const digest = createHash("sha256").update(normalizeUrl(candidate.originalUrl)).digest("hex").slice(0, 12);
  return `${slug}-${digest}`;
}

function toPolicyItem(candidate, existing) {
  return {
    id: existing?.id || stableId(candidate),
    title: candidate.title,
    itemType: candidate.itemType || "policy",
    regionName: candidate.regionName || "湖北省",
    cityName: candidate.cityName || null,
    publisherName: candidate.publisherName || candidate.source?.publisherName || "待确认",
    summary: candidate.summary || existing?.summary || "请查看原文了解详情。",
    applicationTargets: existing?.applicationTargets || null,
    benefits: existing?.benefits || null,
    topics: Array.isArray(candidate.topics) ? candidate.topics.slice(0, 8) : [],
    publishedAt: candidate.publishedAt,
    deadlineAt: candidate.deadlineAt || null,
    lifecycleStatus: candidate.deadlineAt ? "open" : "evergreen",
    verificationStatus: candidate.isOfficial ? "official_verified" : "pending_official",
    primaryUrl: normalizeUrl(candidate.originalUrl),
    primarySourceType: candidate.isOfficial ? "official_site" : "wechat",
    primarySourceName: candidate.source?.name || candidate.publisherName || "待确认",
    sourceCount: existing?.sourceCount || 1,
    score: Number(candidate.score || existing?.score || 50),
    screeningReason: candidate.screeningReason || existing?.screeningReason || "来自湖北重点信息源，等待规则复核。",
    documentNumber: existing?.documentNumber || null,
    discoveredAt: existing?.discoveredAt || now,
  };
}

function ensurePublicShape(value) {
  const serialized = JSON.stringify(value);
  if (/auth-key|x-auth-key|sessionid|cookie|token/i.test(serialized)) {
    throw new Error("refusing to publish credential-like fields");
  }
}

const current = JSON.parse(await readFile(dataPath, "utf8"));
const collected = JSON.parse(await readFile(inputPath, "utf8"));
if (!Array.isArray(current.items) || !Array.isArray(current.sources)) throw new Error("invalid static data file");
if (!Array.isArray(collected.candidates) || !Array.isArray(collected.sourceRuns)) throw new Error("invalid collection output");

const byUrl = new Map(current.items.map((item) => [normalizeUrl(item.primaryUrl), item]));
for (const candidate of collected.candidates) {
  if (!candidate?.originalUrl || !candidate?.title || !candidate?.publishedAt) continue;
  const key = normalizeUrl(candidate.originalUrl);
  byUrl.set(key, toPolicyItem(candidate, byUrl.get(key)));
}

const runBySource = new Map(collected.sourceRuns.map((run) => [run.sourceId, run]));
const sources = current.sources.map((source) => {
  const run = runBySource.get(source.id);
  if (!run) return source;
  return {
    ...source,
    healthStatus: run.status === "success" ? "healthy" : "degraded",
    lastCheckedAt: run.finishedAt || now,
    lastSuccessAt: run.status === "success" ? (run.finishedAt || now) : source.lastSuccessAt,
  };
});

const items = [...byUrl.values()]
  .sort((left, right) => Number(right.score || 0) - Number(left.score || 0) || String(right.publishedAt).localeCompare(String(left.publishedAt)))
  .slice(0, 500);
const next = {
  meta: {
    ...current.meta,
    generatedAt: now,
    lastCollectionCount: collected.count,
    successfulSources: collected.sourceRuns.filter((run) => run.status === "success").length,
    failedSources: collected.sourceRuns.filter((run) => run.status !== "success").length,
  },
  items,
  sources,
};

ensurePublicShape(next);
const temporaryPath = `${dataPath}.tmp`;
await writeFile(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
await rename(temporaryPath, dataPath);
process.stdout.write(`static data updated: ${items.length} items, ${next.meta.successfulSources} sources succeeded\n`);
