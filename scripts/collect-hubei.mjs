#!/usr/bin/env node

import * as cheerio from "cheerio";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const SOURCES = [
  {
    id: "hubei-kjt-notices",
    name: "湖北省科技厅通知公告",
    publisherName: "湖北省科学技术厅",
    entryUrl: "https://kjt.hubei.gov.cn/kjdt/tzgg/",
    regionCode: "420000",
    regionName: "湖北省",
    priority: 100,
  },
  {
    id: "wuhan-kj-notices",
    name: "武汉市科技创新局通知公告",
    publisherName: "武汉市科技创新局",
    entryUrl: "https://kjj.wuhan.gov.cn/wmfw/tzgg/",
    regionCode: "420100",
    regionName: "湖北省",
    cityName: "武汉市",
    priority: 98,
  },
  {
    id: "east-lake-notices",
    name: "东湖高新区通知公告",
    publisherName: "武汉东湖新技术开发区管理委员会",
    entryUrl: "https://www.wehdz.gov.cn/2022/ggxw_68627/tz_68628/",
    regionCode: "420100",
    regionName: "湖北省",
    cityName: "武汉市",
    priority: 96,
  },
  {
    id: "hubei-jxt-files",
    name: "湖北省经信厅公开文件",
    publisherName: "湖北省经济和信息化厅",
    entryUrl: "https://jxt.hubei.gov.cn/fbjd/zc/qtzdgkwj/gwfb/",
    regionCode: "420000",
    regionName: "湖北省",
    priority: 94,
  },
  {
    id: "hubei-rst-files",
    name: "湖北省人社厅公开文件",
    publisherName: "湖北省人力资源和社会保障厅",
    entryUrl: "https://rst.hubei.gov.cn/zfxxgk/zc/qtzdgkwj/",
    regionCode: "420000",
    regionName: "湖北省",
    priority: 92,
  },
];

const POLICY_KEYWORDS = /申报|征集|认定|推荐|通知|政策|办法|细则|指南|奖励|补贴|资助|资金|创新券|揭榜|大赛|竞赛|赛事|创业|人才|科技|高新|专精特新|成果|项目|计划/;
const SKIP_KEYWORDS = /领导|人事任免|采购公告|成交公告|招聘|考录|会议纪要|工作总结|专家公示|评审专家|论证专家|名单公示|验收结果|结果公示|项目公示/;
const DATE_PATTERN = /(20\d{2})[年\-\/.](\d{1,2})[月\-\/.](\d{1,2})日?/;

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const key = process.argv[index];
  if (key.startsWith("--")) args.set(key.slice(2), process.argv[index + 1]?.startsWith("--") ? true : process.argv[++index]);
}

const selectedId = typeof args.get("source") === "string" ? args.get("source") : null;
const limit = Math.min(Math.max(Number(args.get("limit") ?? 12), 1), 50);
const minScore = Math.min(Math.max(Number(args.get("min-score") ?? 60), 0), 100);
const sources = selectedId ? SOURCES.filter((source) => source.id === selectedId) : SOURCES;
const outputPath = typeof args.get("output") === "string" ? resolve(args.get("output")) : null;
if (sources.length === 0) throw new Error(`unknown source: ${selectedId}`);

function normalizeText(value) {
  return value.replace(/[\s\u200b-\u200d\ufeff]+/g, " ").trim();
}

function dateFromText(value) {
  const match = normalizeText(value).match(DATE_PATTERN);
  if (!match) return null;
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

function classify(title, body) {
  if (/申报|征集|认定|推荐|申领|兑付|揭榜/.test(title)) return "application";
  if (/大赛|竞赛|赛事|挑战赛/.test(title)) return "event";
  if (/报名/.test(body) && /大赛|竞赛|赛事|挑战赛/.test(body)) return "event";
  if (/申报|征集|认定|推荐|申领|兑付|揭榜/.test(body)) return "application";
  return "policy";
}

function topicsFrom(title, body) {
  const value = `${title} ${body}`;
  const topics = [
    ["人工智能", /人工智能|AI|大模型/i],
    ["科技企业", /科技型企业|高新技术企业|专精特新/],
    ["成果转化", /成果转化|产业化|中试/],
    ["人才计划", /人才|团队|留学人员/],
    ["惠企资金", /补贴|奖励|资助|资金|创新券/],
    ["科创赛事", /大赛|竞赛|赛事/],
    ["生物医药", /生物医药|生命科学|医疗健康/],
    ["智能制造", /智能制造|工业互联网|制造业/],
  ];
  return topics.filter(([, pattern]) => pattern.test(value)).map(([topic]) => topic).slice(0, 6);
}

function deadlineFromText(value) {
  const snippets = normalizeText(value).match(/(?:截止|截至|报名时间|申报时间)[^。；;]{0,60}/g) ?? [];
  const dates = [];
  for (const snippet of snippets) {
    const range = snippet.match(/(20\d{2})年(\d{1,2})月(\d{1,2})日?\s*[至到\-—－~～]\s*(?:(20\d{2})年)?(\d{1,2})月(\d{1,2})日?/);
    if (range) {
      dates.push(`${range[4] || range[1]}-${range[5].padStart(2, "0")}-${range[6].padStart(2, "0")}`);
    }
    for (const match of snippet.matchAll(new RegExp(DATE_PATTERN.source, "g"))) {
      dates.push(`${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`);
    }
  }
  return dates.sort().at(-1) ?? null;
}

function scoreCandidate(title, body, itemType, deadlineAt, publishedAt) {
  let score = 42;
  const reasons = [];
  if (itemType === "application" || itemType === "event") {
    score += 20;
    reasons.push(itemType === "event" ? "科创赛事" : "可申报事项");
  }
  if (/人工智能|大模型|机器人|智能制造|高新技术|专精特新|成果转化|创新券|人才/.test(`${title} ${body}`)) {
    score += 16;
    reasons.push("命中重点产业或企业关键词");
  }
  if (/奖励|补贴|资助|资金|兑付|最高\d+万/.test(`${title} ${body}`)) {
    score += 10;
    reasons.push("存在明确资金或奖励信号");
  }
  if (deadlineAt) {
    const days = Math.ceil((new Date(`${deadlineAt}T23:59:59+08:00`).getTime() - Date.now()) / 86_400_000);
    if (days >= 0 && days <= 30) {
      score += 9;
      reasons.push("30 天内截止");
    } else if (days < 0) {
      score -= 25;
      reasons.push("已过截止日期");
    }
  }
  const age = Math.ceil((Date.now() - new Date(`${publishedAt}T00:00:00+08:00`).getTime()) / 86_400_000);
  if (age <= 7) {
    score += 5;
    reasons.push("近 7 天发布");
  }
  return {
    score: Math.max(0, Math.min(score, 100)),
    screeningReason: reasons.length > 0 ? `${reasons.join("；")}。` : "来自湖北重点政府信息源，等待规则复核。",
  };
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(25_000),
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": "Mozilla/5.0 (compatible; CentralChinaPolicyRadar/0.1; +policy-monitor)",
    },
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.text();
}

function extractList(html, source) {
  const $ = cheerio.load(html);
  const found = new Map();
  $("a[href]").each((_, element) => {
    const anchor = $(element);
    const title = normalizeText(anchor.attr("title") || anchor.text());
    if (title.length < 10 || title.length > 240 || !POLICY_KEYWORDS.test(title) || SKIP_KEYWORDS.test(title)) return;
    let detailUrl;
    try {
      detailUrl = new URL(anchor.attr("href"), source.entryUrl);
    } catch {
      return;
    }
    if (!/^https?:$/.test(detailUrl.protocol)) return;
    detailUrl.hash = "";
    const parentText = normalizeText(anchor.closest("li, tr, .list-item, .news-item, .item").text());
    const publishedAt = dateFromText(parentText) || dateFromText(detailUrl.pathname);
    if (!publishedAt || found.has(detailUrl.href)) return;
    found.set(detailUrl.href, { title, detailUrl: detailUrl.href, publishedAt });
  });
  return [...found.values()].sort((left, right) => right.publishedAt.localeCompare(left.publishedAt)).slice(0, limit * 4);
}

function extractDetail(html) {
  const $ = cheerio.load(html);
  $("script, style, nav, header, footer, form, .share, .print").remove();
  const selectors = [
    "#zwnr .view",
    ".TRS_UEDITOR",
    ".TRS_Editor",
    ".hbgov-article-content",
    ".article-content",
    ".news-content",
    ".view_con",
    "#zoom",
    "article",
    "main",
  ];
  let content = "";
  for (const selector of selectors) {
    const text = normalizeText($(selector).first().text());
    if (text.length > content.length) content = text;
  }
  if (!content) content = normalizeText($("body").text());
  const description = normalizeText($("meta[name='description']").attr("content") || "");
  const summary = description.length >= 30 ? description.slice(0, 500) : content.slice(0, 500);
  return { content: content.slice(0, 80_000), summary, deadlineAt: deadlineFromText(content) };
}

async function collectSource(source) {
  const listHtml = await fetchHtml(source.entryUrl);
  const listItems = extractList(listHtml, source);
  const candidates = [];
  for (const item of listItems) {
    try {
      const detailHtml = await fetchHtml(item.detailUrl);
      const detail = extractDetail(detailHtml);
      const itemType = classify(item.title, detail.content);
      const scoring = scoreCandidate(item.title, detail.content, itemType, detail.deadlineAt, item.publishedAt);
      if (scoring.score < minScore) {
        process.stderr.write(`[${source.id}] filtered score=${scoring.score}: ${item.title}\n`);
        continue;
      }
      candidates.push({
        externalId: `${source.id}:${new URL(item.detailUrl).pathname}${new URL(item.detailUrl).search}`,
        title: item.title,
        itemType,
        regionCode: source.regionCode,
        regionName: source.regionName,
        cityName: source.cityName ?? null,
        publisherName: source.publisherName,
        summary: detail.summary,
        topics: topicsFrom(item.title, detail.content),
        publishedAt: item.publishedAt,
        deadlineAt: detail.deadlineAt,
        source: {
          id: source.id,
          name: source.name,
          type: "official_site",
          publisherName: source.publisherName,
          entryUrl: source.entryUrl,
          priority: source.priority,
        },
        originalUrl: item.detailUrl,
        contentText: detail.content,
        isOfficial: true,
        score: scoring.score,
        screeningReason: scoring.screeningReason,
      });
      if (candidates.length >= limit) break;
    } catch (error) {
      process.stderr.write(`[${source.id}] detail skipped: ${error instanceof Error ? error.message : "unknown error"}\n`);
    }
    if (!args.has("no-delay")) await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  return candidates;
}

async function postCandidates(candidates) {
  const baseUrl = process.env.POLICY_RADAR_URL?.replace(/\/$/, "");
  const ingestKey = process.env.POLICY_INGEST_KEY;
  if (!baseUrl || !ingestKey || args.has("dry-run")) return null;
  const response = await fetch(`${baseUrl}/api/ingest`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${ingestKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(candidates),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`ingest failed: ${response.status} ${await response.text()}`);
  return response.json();
}

const allCandidates = [];
const sourceRuns = [];
for (const source of sources) {
  const startedAt = new Date().toISOString();
  try {
    const candidates = await collectSource(source);
    allCandidates.push(...candidates);
    sourceRuns.push({ sourceId: source.id, status: "success", startedAt, finishedAt: new Date().toISOString(), count: candidates.length });
    process.stderr.write(`[${source.id}] ${candidates.length} candidates\n`);
  } catch (error) {
    sourceRuns.push({
      sourceId: source.id,
      status: "failed",
      startedAt,
      finishedAt: new Date().toISOString(),
      count: 0,
      error: error instanceof Error ? error.message.slice(0, 300) : "unknown error",
    });
    process.stderr.write(`[${source.id}] failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
  }
  if (!args.has("no-delay")) await new Promise((resolve) => setTimeout(resolve, 2_500));
}

const ingestResult = await postCandidates(allCandidates);
const output = ingestResult
  ? {
      collectedAt: new Date().toISOString(),
      count: allCandidates.length,
      titles: allCandidates.map((candidate) => candidate.title),
      sourceRuns,
      ingestResult,
    }
  : {
      collectedAt: new Date().toISOString(),
      count: allCandidates.length,
      candidates: allCandidates,
      sourceRuns,
      ingestResult: null,
    };
const serialized = `${JSON.stringify(output, null, 2)}\n`;
if (outputPath) {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, serialized, "utf8");
  process.stderr.write(`collection saved: ${outputPath}\n`);
} else {
  process.stdout.write(serialized);
}
