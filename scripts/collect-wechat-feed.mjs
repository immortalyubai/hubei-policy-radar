#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeText, screenPolicyArticle } from "./lib/policy-screening.mjs";

const DEFAULT_BASE_URL = "http://127.0.0.1:5000";
const FIRST_LOOKBACK_SECONDS = 48 * 60 * 60;
const FEED_PAGE_LIMIT = 200;
const MAX_FEED_PAGES = 50;
const MAX_RESPONSE_BYTES = 2_000_000;
const REQUEST_TIMEOUT_MS = 20_000;
const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));
const CONFIG_PATH = resolve(REPO_ROOT, "config/wechat-sources.json");
const STATE_PATH = resolve(REPO_ROOT, "work/wechat-feed-state.json");
const DEFAULT_OUTPUT_PATH = resolve(REPO_ROOT, "work/wechat-collection.json");

class ApiError extends Error {
  constructor(message, { status = null, loginExpired = false } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.loginExpired = loginExpired;
  }
}

function parseArgs(argv) {
  const parsed = { dryRun: false, since: null, output: DEFAULT_OUTPUT_PATH, minScore: 60 };
  for (let index = 2; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }
    if (!["--since", "--output", "--min-score"].includes(argument)) {
      throw new Error(`unknown argument: ${argument}`);
    }
    const value = argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
    if (argument === "--since") parsed.since = parseSince(value);
    if (argument === "--output") parsed.output = resolve(process.cwd(), value);
    if (argument === "--min-score") {
      const score = Number(value);
      if (!Number.isFinite(score) || score < 0 || score > 100) throw new Error("--min-score must be between 0 and 100");
      parsed.minScore = score;
    }
  }
  return parsed;
}

function parseSince(value) {
  let seconds = null;
  if (/^\d+$/.test(value)) {
    const numeric = Number(value);
    if (Number.isSafeInteger(numeric) && numeric >= 0) seconds = numeric;
  }
  if (seconds === null) {
    const milliseconds = Date.parse(value);
    if (Number.isFinite(milliseconds) && milliseconds >= 0) seconds = Math.floor(milliseconds / 1000);
  }
  if (seconds === null) throw new Error("--since must be a Unix timestamp or an ISO date");
  if (seconds > Math.floor(Date.now() / 1000) + 300) throw new Error("--since must not be in the future");
  return seconds;
}

function apiBaseUrl() {
  const url = new URL(process.env.WECHAT_DOWNLOAD_API_URL?.trim() || DEFAULT_BASE_URL);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("WECHAT_DOWNLOAD_API_URL must use http or https");
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("WECHAT_DOWNLOAD_API_URL must not contain credentials, query parameters, or a fragment");
  }
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
  return url;
}

function validateWatchlist(raw) {
  if (!Array.isArray(raw) || raw.length === 0) throw new Error("wechat source config must be a non-empty array");
  const fakeids = new Set();
  const aliases = new Set();
  const sourceIds = new Set();
  return raw.map((source, index) => {
    if (!source || typeof source !== "object") throw new Error(`wechat source ${index} is invalid`);
    for (const field of ["fakeid", "alias", "nickname", "sourceId", "publisherName", "regionCode", "regionName"]) {
      if (typeof source[field] !== "string" || !source[field].trim()) throw new Error(`wechat source ${index} is missing ${field}`);
    }
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(source.fakeid)) throw new Error(`wechat source ${index} has an invalid fakeid`);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(source.alias)) throw new Error(`wechat source ${index} has an invalid alias`);
    if (!/^wechat-[a-z0-9-]+$/.test(source.sourceId)) throw new Error(`wechat source ${index} has an invalid sourceId`);
    if (!/^\d{6}$/.test(source.regionCode)) throw new Error(`wechat source ${index} has an invalid regionCode`);
    if (source.cityName !== null && source.cityName !== undefined && typeof source.cityName !== "string") {
      throw new Error(`wechat source ${index} has an invalid cityName`);
    }
    if (source.verifiedIdentityName !== null && source.verifiedIdentityName !== undefined && typeof source.verifiedIdentityName !== "string") {
      throw new Error(`wechat source ${index} has an invalid verifiedIdentityName`);
    }
    if (!Number.isFinite(Number(source.priority)) || Number(source.priority) < 0 || Number(source.priority) > 100) {
      throw new Error(`wechat source ${index} has an invalid priority`);
    }
    if (fakeids.has(source.fakeid) || aliases.has(source.alias) || sourceIds.has(source.sourceId)) {
      throw new Error(`wechat source ${index} duplicates a whitelist identity`);
    }
    fakeids.add(source.fakeid);
    aliases.add(source.alias);
    sourceIds.add(source.sourceId);
    return {
      ...source,
      fakeid: source.fakeid.trim(),
      alias: source.alias.trim(),
      nickname: source.nickname.trim(),
      sourceId: source.sourceId.trim(),
      publisherName: source.publisherName.trim(),
      regionCode: source.regionCode.trim(),
      regionName: source.regionName.trim(),
      cityName: source.cityName?.trim() || null,
      verifiedIdentityName: source.verifiedIdentityName?.trim() || null,
      priority: Number(source.priority),
    };
  });
}

async function readJson(path, fallback = undefined) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (fallback !== undefined && error?.code === "ENOENT") return fallback;
    throw error;
  }
}

function normalizeState(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("invalid WeChat feed state");
  if (!raw.accounts || typeof raw.accounts !== "object" || Array.isArray(raw.accounts)) {
    throw new Error("invalid WeChat feed state accounts");
  }
  return { version: 1, updatedAt: raw.updatedAt ?? null, accounts: { ...raw.accounts } };
}

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
}

function safeErrorMessage(error) {
  if (error instanceof ApiError) return error.message.slice(0, 240);
  const value = error instanceof Error ? error.message : "unknown error";
  return value
    .replace(/https?:\/\/[^\s]+/gi, "[local-api]")
    .replace(/(authorization|token|cookie|sessionid)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .slice(0, 240);
}

async function fetchJson(url) {
  let response;
  try {
    response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new ApiError("本地公众号服务不可达");
  }
  if (!response.ok) {
    throw new ApiError(`本地公众号服务返回 HTTP ${response.status}`, {
      status: response.status,
      loginExpired: response.status === 401 || response.status === 403,
    });
  }
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > MAX_RESPONSE_BYTES) throw new ApiError("本地公众号服务响应过大");
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) throw new ApiError("本地公众号服务响应过大");
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError("本地公众号服务返回了无效 JSON");
  }
}

async function getLoginStatus(baseUrl) {
  try {
    const payload = await fetchJson(new URL("api/admin/status", baseUrl));
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new ApiError("登录状态响应无效");
    const expireTime = Number(payload.expireTime);
    const expireTimeMs = Number.isSafeInteger(expireTime) && expireTime > 0 && expireTime <= 8_640_000_000_000_000
      ? expireTime
      : null;
    const loginExpiresAt = expireTimeMs === null ? null : new Date(expireTimeMs).toISOString();
    const expired = payload.isExpired === true
      || payload.authenticated !== true
      || payload.loggedIn !== true
      || (expireTimeMs !== null && expireTimeMs <= Date.now());
    return { status: expired ? "expired" : "active", loginExpired: expired, loginExpiresAt, checked: true };
  } catch (error) {
    if (error instanceof ApiError && error.loginExpired) {
      return { status: "expired", loginExpired: true, loginExpiresAt: null, checked: true };
    }
    return { status: "unknown", loginExpired: null, loginExpiresAt: null, checked: false };
  }
}

function validateFeedPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || !Array.isArray(payload.articles)) {
    throw new ApiError("公众号增量 Feed 响应结构无效");
  }
  return payload;
}

function canonicalizeWechatUrl(value) {
  const url = new URL(String(value ?? ""));
  if (!["http:", "https:"].includes(url.protocol)
    || url.username
    || url.password
    || url.port
    || url.hostname !== "mp.weixin.qq.com"
    || (url.pathname !== "/s" && !url.pathname.startsWith("/s/"))) {
    throw new Error("不是有效的微信公众号文章链接");
  }
  url.protocol = "https:";
  url.port = "";
  url.hash = "";
  if (url.pathname.startsWith("/s/")) {
    url.search = "";
  } else {
    const identity = new URLSearchParams();
    for (const key of ["__biz", "mid", "idx", "sn"]) {
      const item = url.searchParams.get(key);
      if (item) identity.set(key, item);
    }
    if ([...identity.keys()].length === 0) throw new Error("微信公众号文章链接缺少身份参数");
    url.search = identity.toString();
  }
  return url.toString();
}

function mapArticle(article, source, minScore) {
  if (!article || typeof article !== "object" || Array.isArray(article)) return null;
  if (article.fakeid !== source.fakeid) {
    throw new ApiError(`Feed 返回了不属于白名单账号 ${source.alias} 的文章`);
  }
  const title = normalizeText(article.title);
  const digest = normalizeText(article.digest).slice(0, 600);
  const publishTime = Number(article.publish_time);
  if (!title || !Number.isSafeInteger(publishTime) || publishTime <= 0) return null;

  let originalUrl;
  try {
    originalUrl = canonicalizeWechatUrl(article.link);
  } catch {
    return null;
  }
  const publishedAt = new Date(publishTime * 1000).toISOString();
  const screening = screenPolicyArticle({ title, digest, publishedAt });
  if (!screening.matched || screening.score < minScore) return null;
  const linkHash = createHash("sha256").update(originalUrl).digest("hex").slice(0, 24);

  return {
    externalId: `wechat:${source.fakeid}:${linkHash}`,
    title,
    itemType: screening.itemType,
    regionCode: source.regionCode,
    regionName: source.regionName,
    cityName: source.cityName,
    publisherName: source.publisherName,
    summary: digest || `${source.nickname}发布，详情请查看公众号原文。`,
    topics: screening.topics,
    publishedAt,
    deadlineAt: screening.deadlineAt,
    documentNumber: screening.documentNumber,
    source: {
      id: source.sourceId,
      name: source.nickname,
      type: "wechat",
      publisherName: source.publisherName,
      entryUrl: "https://mp.weixin.qq.com/",
      priority: source.priority,
    },
    originalUrl,
    isOfficial: false,
    evidenceStatus: "active",
    score: screening.score,
    screeningReason: screening.screeningReason,
  };
}

async function collectAccount({ baseUrl, source, since, minScore }) {
  let cursor = since;
  let discoveredCount = 0;
  let rejectedCount = 0;
  const candidates = [];
  const candidateKeys = new Set();

  let drained = false;
  for (let page = 0; page <= MAX_FEED_PAGES; page += 1) {
    const url = new URL("api/feed/articles.json", baseUrl);
    url.searchParams.set("since", String(cursor));
    url.searchParams.set("fakeid", source.fakeid);
    url.searchParams.set("limit", String(FEED_PAGE_LIMIT));
    const payload = validateFeedPayload(await fetchJson(url));
    if (payload.articles.length === 0) {
      drained = true;
      break;
    }
    if (page === MAX_FEED_PAGES) throw new ApiError(`公众号增量 Feed 超过 ${MAX_FEED_PAGES} 页：${source.alias}`);

    let maxPublishedAt = cursor;
    for (const article of payload.articles) {
      if (article?.fakeid !== source.fakeid) {
        throw new ApiError(`Feed 白名单校验失败：${source.alias}`);
      }
      discoveredCount += 1;
      const publishTime = Number(article.publish_time);
      if (Number.isSafeInteger(publishTime) && publishTime > maxPublishedAt) maxPublishedAt = publishTime;
      const candidate = mapArticle(article, source, minScore);
      if (!candidate) {
        rejectedCount += 1;
        continue;
      }
      const key = candidate.externalId;
      if (candidateKeys.has(key)) continue;
      candidateKeys.add(key);
      candidates.push(candidate);
    }

    const responseCursor = Number(payload.next_since);
    const nextCursor = Number.isSafeInteger(responseCursor) && responseCursor > cursor ? responseCursor : maxPublishedAt;
    if (!Number.isSafeInteger(nextCursor) || nextCursor <= cursor) {
      throw new ApiError(`公众号增量游标未前进：${source.alias}`);
    }
    cursor = nextCursor;
  }
  if (!drained) throw new ApiError(`公众号增量 Feed 未完整读取：${source.alias}`);

  return { candidates, discoveredCount, rejectedCount, nextSince: cursor };
}

const args = parseArgs(process.argv);
const baseUrl = apiBaseUrl();
const watchlist = validateWatchlist(await readJson(CONFIG_PATH));
const state = normalizeState(await readJson(STATE_PATH, { version: 1, updatedAt: null, accounts: {} }));
const login = await getLoginStatus(baseUrl);
const fallbackSince = Math.floor(Date.now() / 1000) - FIRST_LOOKBACK_SECONDS;
const allCandidates = [];
const sourceRuns = [];

for (const source of watchlist) {
  const startedAt = new Date().toISOString();
  const stored = state.accounts[source.fakeid] && typeof state.accounts[source.fakeid] === "object"
    ? state.accounts[source.fakeid]
    : {};
  const storedSince = Number.isSafeInteger(Number(stored.since)) && Number(stored.since) >= 0
    ? Number(stored.since)
    : null;
  const since = args.since ?? storedSince ?? fallbackSince;

  if (login.loginExpired === true) {
    const finishedAt = new Date().toISOString();
    sourceRuns.push({
      sourceId: source.sourceId,
      status: "login_expired",
      startedAt,
      finishedAt,
      count: 0,
      discoveredCount: 0,
      newMatchCount: 0,
      filteredCount: 0,
      loginStatus: "expired",
      loginExpired: true,
      loginExpiresAt: login.loginExpiresAt,
      since,
      nextSince: storedSince,
      error: "微信公众号登录已过期，请在本地管理页重新扫码。",
    });
    const storedWithoutSince = { ...stored };
    delete storedWithoutSince.since;
    state.accounts[source.fakeid] = {
      ...storedWithoutSince,
      ...(storedSince !== null ? { since: storedSince } : {}),
      alias: source.alias,
      lastRunAt: finishedAt,
      lastSuccessAt: stored.lastSuccessAt ?? null,
      lastErrorAt: finishedAt,
      lastErrorCode: "WECHAT_LOGIN_EXPIRED",
      lastErrorMessage: "微信公众号登录已过期，请在本地管理页重新扫码。",
    };
    process.stderr.write(`[${source.sourceId}] login_expired: skipped feed and preserved cursor\n`);
    continue;
  }

  try {
    const result = await collectAccount({ baseUrl, source, since, minScore: args.minScore });
    allCandidates.push(...result.candidates);
    const finishedAt = new Date().toISOString();
    sourceRuns.push({
      sourceId: source.sourceId,
      status: login.loginExpired ? "login_expired" : "success",
      startedAt,
      finishedAt,
      count: result.candidates.length,
      discoveredCount: result.discoveredCount,
      newMatchCount: result.candidates.length,
      filteredCount: result.rejectedCount,
      loginStatus: login.status,
      loginExpired: login.loginExpired,
      loginExpiresAt: login.loginExpiresAt,
      since,
      nextSince: result.nextSince,
      ...(login.loginExpired ? { error: "微信公众号登录已过期，请在本地管理页重新扫码。" } : {}),
    });
    state.accounts[source.fakeid] = {
      since: Math.max(storedSince ?? 0, result.nextSince),
      alias: source.alias,
      lastRunAt: finishedAt,
      lastSuccessAt: finishedAt,
      lastErrorAt: null,
      lastErrorCode: null,
    };
    process.stderr.write(`[${source.sourceId}] discovered=${result.discoveredCount} matched=${result.candidates.length} status=${login.loginExpired ? "login_expired" : "success"}\n`);
  } catch (error) {
    const finishedAt = new Date().toISOString();
    const loginExpired = login.loginExpired === true || (error instanceof ApiError && error.loginExpired);
    const message = loginExpired ? "微信公众号登录已过期，请在本地管理页重新扫码。" : safeErrorMessage(error);
    sourceRuns.push({
      sourceId: source.sourceId,
      status: loginExpired ? "login_expired" : "failed",
      startedAt,
      finishedAt,
      count: 0,
      discoveredCount: 0,
      newMatchCount: 0,
      filteredCount: 0,
      loginStatus: loginExpired ? "expired" : login.status,
      loginExpired,
      loginExpiresAt: login.loginExpiresAt,
      since,
      nextSince: storedSince,
      error: message,
    });
    const storedWithoutSince = { ...stored };
    delete storedWithoutSince.since;
    state.accounts[source.fakeid] = {
      ...storedWithoutSince,
      ...(storedSince !== null ? { since: storedSince } : {}),
      alias: source.alias,
      lastRunAt: finishedAt,
      lastSuccessAt: stored.lastSuccessAt ?? null,
      lastErrorAt: finishedAt,
      lastErrorCode: loginExpired ? "WECHAT_LOGIN_EXPIRED" : "WECHAT_FEED_FAILED",
      lastErrorMessage: message,
    };
    process.stderr.write(`[${source.sourceId}] ${loginExpired ? "login_expired" : "failed"}: ${message}\n`);
  }
}

const output = {
  collectedAt: new Date().toISOString(),
  count: allCandidates.length,
  candidates: allCandidates,
  sourceRuns,
  ingestResult: null,
};

await writeJsonAtomic(args.output, output);
process.stderr.write(`collection saved: ${args.output}\n`);
if (!args.dryRun) {
  state.updatedAt = new Date().toISOString();
  await writeJsonAtomic(STATE_PATH, state);
  process.stderr.write(`feed state saved: ${STATE_PATH}\n`);
} else {
  process.stderr.write("dry run: feed state was not updated\n");
}
