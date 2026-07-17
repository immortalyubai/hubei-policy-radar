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

const GENERIC_TRACKING_PARAMS = new Set(["spm", "from", "source", "scene"]);
const WECHAT_TRACKING_PARAMS = new Set([
  "ascene",
  "clicktime",
  "devicetype",
  "enterid",
  "exportkey",
  "fontscale",
  "key",
  "lang",
  "mpshare",
  "nettype",
  "pass_ticket",
  "sessionid",
  "subscene",
  "timestamp",
  "uin",
  "version",
  "wx_header",
]);
const WECHAT_ARTICLE_PARAMS = new Set(["__biz", "mid", "idx", "sn"]);
const PUBLISHER_ALIASES = new Map([
  ["湖北发布", "湖北省人民政府"],
  ["湖北省人民政府办公厅", "湖北省人民政府"],
  ["湖北科技", "湖北省科学技术厅"],
  ["湖北省科技厅", "湖北省科学技术厅"],
  ["武汉科技创新", "武汉市科技创新局"],
  ["武汉市科学技术局", "武汉市科技创新局"],
]);
const CREDENTIAL_KEYS = new Set([
  "authorization",
  "authkey",
  "xauthkey",
  "sessionid",
  "cookie",
  "cookies",
  "token",
  "accesstoken",
  "refreshtoken",
  "wechattoken",
  "wechatcookie",
  "apikey",
  "password",
  "secret",
]);

function normalizeUrl(value) {
  const url = new URL(String(value));
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) {
    throw new Error("invalid public URL");
  }
  url.protocol = "https:";
  url.hostname = url.hostname.toLowerCase();
  if (url.port === "80" || url.port === "443") url.port = "";
  url.hash = "";

  const isWechat = url.hostname === "mp.weixin.qq.com";
  const isWechatSlug = isWechat && /^\/s\/[^/]+\/?$/.test(url.pathname);
  if (isWechatSlug) {
    url.search = "";
  } else {
    for (const key of [...url.searchParams.keys()]) {
      const normalizedKey = key.toLowerCase();
      const isGenericTracking = normalizedKey.startsWith("utm_") || GENERIC_TRACKING_PARAMS.has(normalizedKey);
      const isWechatTracking = isWechat && (
        WECHAT_TRACKING_PARAMS.has(normalizedKey)
        || normalizedKey.startsWith("share_")
        || normalizedKey.startsWith("wxshare_")
      );
      const isUnneededWechatArticleParam = isWechat
        && url.pathname.replace(/\/+$/, "") === "/s"
        && !WECHAT_ARTICLE_PARAMS.has(normalizedKey);
      if (isGenericTracking || isWechatTracking || isUnneededWechatArticleParam) {
        url.searchParams.delete(key);
      }
    }
    url.searchParams.sort();
  }

  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.href.replace(/\/$/, "");
}

function normalizeMatchText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\s\u200b-\u200d\ufeff]+/g, "")
    .replace(/[\p{P}\p{S}]+/gu, "")
    .toLowerCase();
}

function publishedDate(value) {
  const match = String(value ?? "").match(/^\d{4}-\d{2}-\d{2}/);
  return match?.[0] || "";
}

function publisherNameOf(value) {
  return String(value?.publisherName || value?.source?.publisherName || "待确认").trim();
}

function canonicalPublisherKey(value) {
  const publisher = normalizeMatchText(publisherNameOf(value));
  return normalizeMatchText(PUBLISHER_ALIASES.get(publisher) || publisher);
}

function regionKey(value) {
  const regionName = normalizeMatchText(value?.regionName || "湖北省");
  const cityName = normalizeMatchText(value?.cityName || "");
  return `${regionName}|${cityName}`;
}

function documentKey(value) {
  const documentNumber = normalizeMatchText(value?.documentNumber);
  return documentNumber ? `${regionKey(value)}|${documentNumber}` : null;
}

function strictItemKey(value) {
  const title = normalizeMatchText(value?.title);
  const publisher = canonicalPublisherKey(value);
  const date = publishedDate(value?.publishedAt);
  return title && publisher && date ? `${regionKey(value)}|${title}|${publisher}|${date}` : null;
}

function stableId(candidate) {
  const slug = String(candidate.source?.id || "policy").replace(/[^a-z0-9-]+/gi, "-").toLowerCase();
  const digest = createHash("sha256").update(normalizeUrl(candidate.originalUrl)).digest("hex").slice(0, 12);
  return `${slug}-${digest}`;
}

function isOfficialCandidate(candidate) {
  return candidate?.isOfficial === true || candidate?.source?.type === "official_site";
}

function isQuarantined(candidate) {
  return candidate?.quarantined === true
    || [candidate?.evidenceStatus, candidate?.status, candidate?.publishStatus]
      .some((value) => String(value ?? "").toLowerCase() === "quarantined");
}

function primarySourceTypeOf(candidate) {
  if (isOfficialCandidate(candidate)) return "official_site";
  return ["wechat", "rss", "manual"].includes(candidate?.source?.type) ? candidate.source.type : "wechat";
}

function linkSourceType(value) {
  if (value === "official_site") return "official_site";
  if (value === "manual") return "manual";
  return "wechat";
}

function defaultLinkLabel(sourceType) {
  if (sourceType === "official_site") return "打开官网原文";
  if (sourceType === "wechat") return "打开公众号原文";
  return "打开来源";
}

function normalizeSourceLink(link, fallback = {}) {
  if (!link?.url) return null;
  const sourceType = linkSourceType(link.sourceType || fallback.sourceType);
  return {
    label: String(link.label || fallback.label || defaultLinkLabel(sourceType)).trim().slice(0, 100),
    url: normalizeUrl(link.url),
    sourceType,
    sourceName: String(link.sourceName || fallback.sourceName || "待确认").trim().slice(0, 120),
  };
}

function mergeSourceLinkLists(...groups) {
  const byUrl = new Map();
  for (const group of groups) {
    for (const rawLink of Array.isArray(group) ? group : []) {
      let link;
      try {
        link = normalizeSourceLink(rawLink);
      } catch {
        continue;
      }
      if (!link) continue;
      const existing = byUrl.get(link.url);
      if (!existing || (link.sourceType === "official_site" && existing.sourceType !== "official_site")) {
        byUrl.set(link.url, link);
      }
    }
  }
  return [...byUrl.values()];
}

function itemSourceLinks(item) {
  const primarySourceType = linkSourceType(item?.primarySourceType);
  const primary = item?.primaryUrl
    ? [{
        label: defaultLinkLabel(primarySourceType),
        url: item.primaryUrl,
        sourceType: primarySourceType,
        sourceName: item.primarySourceName || item.publisherName || "待确认",
      }]
    : [];
  return mergeSourceLinkLists(item?.sourceLinks, primary);
}

function candidateSourceLinks(candidate) {
  const sourceType = linkSourceType(primarySourceTypeOf(candidate));
  const primary = [{
    label: defaultLinkLabel(sourceType),
    url: candidate.originalUrl,
    sourceType,
    sourceName: candidate.source?.name || publisherNameOf(candidate),
  }];
  return mergeSourceLinkLists(candidate.sourceLinks, primary);
}

function orderSourceLinks(links, primaryUrl) {
  return links
    .map((link, index) => ({ link, index }))
    .sort((left, right) => {
      const leftPrimary = left.link.url === primaryUrl ? 1 : 0;
      const rightPrimary = right.link.url === primaryUrl ? 1 : 0;
      if (leftPrimary !== rightPrimary) return rightPrimary - leftPrimary;
      const leftOfficial = left.link.sourceType === "official_site" ? 1 : 0;
      const rightOfficial = right.link.sourceType === "official_site" ? 1 : 0;
      return rightOfficial - leftOfficial || left.index - right.index;
    })
    .map(({ link }) => link);
}

function finiteScore(value, fallback = 50) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : fallback;
}

function toPolicyItem(candidate, existing) {
  const candidateOfficial = isOfficialCandidate(candidate);
  const candidateUrl = normalizeUrl(candidate.originalUrl);
  const promoteOfficial = candidateOfficial && existing?.primarySourceType !== "official_site";
  const primaryUrl = existing && !promoteOfficial ? normalizeUrl(existing.primaryUrl) : candidateUrl;
  const primarySourceType = existing && !promoteOfficial
    ? existing.primarySourceType
    : primarySourceTypeOf(candidate);
  const primarySourceName = existing && !promoteOfficial
    ? existing.primarySourceName
    : candidate.source?.name || publisherNameOf(candidate);
  const sourceLinks = orderSourceLinks(
    mergeSourceLinkLists(itemSourceLinks(existing), candidateSourceLinks(candidate)),
    primaryUrl,
  );
  const deadlineAt = candidate.deadlineAt ?? existing?.deadlineAt ?? null;
  const itemType = candidate.itemType || existing?.itemType || "policy";
  const lifecycleStatus = deadlineAt
    ? "open"
    : itemType === "application" || itemType === "event"
      ? "pending_deadline"
      : existing?.lifecycleStatus || "evergreen";
  const existingStatus = existing?.verificationStatus;
  const verificationStatus = existingStatus === "conflict"
    ? "conflict"
    : candidateOfficial || existingStatus === "official_verified"
      ? "official_verified"
      : "pending_official";

  return {
    ...existing,
    id: existing?.id || stableId(candidate),
    title: candidate.title,
    itemType,
    regionName: candidate.regionName || existing?.regionName || "湖北省",
    cityName: candidate.cityName ?? existing?.cityName ?? null,
    publisherName: publisherNameOf(candidate),
    summary: candidate.summary || existing?.summary || "请查看原文了解详情。",
    applicationTargets: candidate.applicationTargets ?? existing?.applicationTargets ?? null,
    benefits: candidate.benefits ?? existing?.benefits ?? null,
    topics: Array.isArray(candidate.topics) ? candidate.topics.slice(0, 8) : existing?.topics || [],
    publishedAt: candidate.publishedAt,
    deadlineAt,
    lifecycleStatus,
    verificationStatus,
    primaryUrl,
    primarySourceType,
    primarySourceName,
    sourceCount: Math.max(Number(existing?.sourceCount || 0), sourceLinks.length, 1),
    score: Math.max(finiteScore(existing?.score, 0), finiteScore(candidate.score, 50)),
    screeningReason: candidate.screeningReason || existing?.screeningReason || "来自湖北重点信息源，等待规则复核。",
    documentNumber: candidate.documentNumber || existing?.documentNumber || null,
    discoveredAt: existing?.discoveredAt || now,
    sourceLinks,
  };
}

function normalizeExistingItem(item) {
  const primaryUrl = normalizeUrl(item.primaryUrl);
  if (!Array.isArray(item.sourceLinks)) return { ...item, primaryUrl };
  const sourceLinks = orderSourceLinks(itemSourceLinks({ ...item, primaryUrl }), primaryUrl);
  return {
    ...item,
    primaryUrl,
    sourceLinks,
    sourceCount: Math.max(Number(item.sourceCount || 0), sourceLinks.length, 1),
  };
}

function addUniqueIndex(index, key, itemIndex) {
  if (!key) return;
  if (!index.has(key)) {
    index.set(key, itemIndex);
  } else if (index.get(key) !== itemIndex) {
    index.set(key, null);
  }
}

function buildIndexes(items) {
  const byUrl = new Map();
  const byDocument = new Map();
  const byStrictItem = new Map();
  items.forEach((item, itemIndex) => {
    for (const link of itemSourceLinks(item)) addUniqueIndex(byUrl, link.url, itemIndex);
    addUniqueIndex(byDocument, documentKey(item), itemIndex);
    addUniqueIndex(byStrictItem, strictItemKey(item), itemIndex);
  });
  return { byUrl, byDocument, byStrictItem };
}

function indexedMatch(index, key) {
  const value = key ? index.get(key) : null;
  return Number.isInteger(value) ? value : null;
}

function findMatchingItem(candidate, indexes) {
  const byUrl = indexedMatch(indexes.byUrl, normalizeUrl(candidate.originalUrl));
  if (byUrl !== null) return byUrl;
  const byDocument = indexedMatch(indexes.byDocument, documentKey(candidate));
  if (byDocument !== null) return byDocument;
  return indexedMatch(indexes.byStrictItem, strictItemKey(candidate));
}

function normalizeTimestamp(value) {
  if (value === null || value === undefined || value === "") return null;
  let timestamp = value;
  if (typeof value === "string" && /^\d+$/.test(value)) timestamp = Number(value);
  if (typeof timestamp === "number" && timestamp < 1_000_000_000_000) timestamp *= 1_000;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function nonNegativeInteger(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number >= 0) return Math.floor(number);
  }
  return 0;
}

function sanitizeError(value) {
  const raw = typeof value === "string"
    ? value
    : value && typeof value.message === "string"
      ? value.message
      : "";
  if (!raw) return null;
  return raw
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/((?:set-cookie|cookie)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\r\n]+)/gi, "$1[redacted]")
    .replace(/\bbearer\s+[a-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/((?:authorization|x[-_]?auth[-_]?key|auth[-_]?key|access[-_]?token|refresh[-_]?token|token|cookie|session[-_]?id)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;&]+)/gi, "$1[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300) || null;
}

function updateSourceFromRun(source, run, insertedCount) {
  if (!run) return source;
  const success = run.status === "success";
  const lastCheckedAt = normalizeTimestamp(run.lastCheckedAt)
    || normalizeTimestamp(run.finishedAt)
    || now;
  const explicitFailures = run.consecutiveFailures === undefined
    ? null
    : nonNegativeInteger(run.consecutiveFailures);
  const consecutiveFailures = success
    ? 0
    : explicitFailures ?? nonNegativeInteger(source.consecutiveFailures) + 1;
  const errorValue = run.lastErrorMessage ?? run.errorMessage ?? run.error;
  const lastErrorMessage = success ? null : sanitizeError(errorValue) || "source run failed";
  return {
    ...source,
    healthStatus: success ? "healthy" : consecutiveFailures >= 3 ? "failing" : "degraded",
    lastCheckedAt,
    lastSuccessAt: success
      ? normalizeTimestamp(run.lastSuccessAt) || lastCheckedAt
      : source.lastSuccessAt || null,
    lastInsertedCount: nonNegativeInteger(
      run.lastInsertedCount,
      run.insertedCount,
      run.newMatchCount,
      insertedCount,
      run.count,
    ),
    loginExpiresAt: normalizeTimestamp(run.loginExpiresAt) || source.loginExpiresAt || null,
    lastErrorAt: success ? null : normalizeTimestamp(run.lastErrorAt) || lastCheckedAt,
    lastErrorMessage,
    consecutiveFailures,
  };
}

function isCredentialKey(key) {
  const normalized = String(key).toLowerCase().replace(/[^a-z0-9]/g, "");
  return CREDENTIAL_KEYS.has(normalized)
    || normalized.endsWith("token")
    || normalized.endsWith("cookie")
    || normalized.endsWith("password")
    || normalized.endsWith("secret");
}

function ensurePublicShape(value, path = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => ensurePublicShape(entry, [...path, String(index)]));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    if (isCredentialKey(key)) {
      throw new Error(`refusing to publish credential-like field: ${[...path, key].join(".")}`);
    }
    ensurePublicShape(entry, [...path, key]);
  }
}

const current = JSON.parse(await readFile(dataPath, "utf8"));
const collected = JSON.parse(await readFile(inputPath, "utf8"));
if (!Array.isArray(current.items) || !Array.isArray(current.sources)) throw new Error("invalid static data file");
if (!Array.isArray(collected.candidates) || !Array.isArray(collected.sourceRuns)) throw new Error("invalid collection output");

const mergedItems = current.items.map(normalizeExistingItem);
const insertedBySource = new Map();
for (const candidate of collected.candidates) {
  const sourceId = candidate?.source?.id;
  if (sourceId && !insertedBySource.has(sourceId)) insertedBySource.set(sourceId, 0);
  if (isQuarantined(candidate) || !candidate?.originalUrl || !candidate?.title || !candidate?.publishedAt) continue;
  let indexes;
  let matchingIndex;
  try {
    indexes = buildIndexes(mergedItems);
    matchingIndex = findMatchingItem(candidate, indexes);
  } catch {
    continue;
  }
  const existing = matchingIndex === null ? undefined : mergedItems[matchingIndex];
  const merged = toPolicyItem(candidate, existing);
  if (existing) {
    mergedItems[matchingIndex] = merged;
  } else {
    mergedItems.push(merged);
    if (sourceId) insertedBySource.set(sourceId, (insertedBySource.get(sourceId) || 0) + 1);
  }
}

const runBySource = new Map(collected.sourceRuns.map((run) => [run.sourceId, run]));
const sources = current.sources.map((source) => updateSourceFromRun(
  source,
  runBySource.get(source.id),
  insertedBySource.get(source.id),
));

const items = mergedItems
  .sort((left, right) => Number(right.score || 0) - Number(left.score || 0) || String(right.publishedAt).localeCompare(String(left.publishedAt)))
  .slice(0, 500);
const next = {
  meta: {
    ...current.meta,
    generatedAt: now,
    lastCollectionCount: Number.isFinite(Number(collected.count)) ? Number(collected.count) : collected.candidates.length,
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
