import {
  canonicalizeUrl,
  getIngestKey,
  isIngestAuthorized,
  sha256,
  upsertCandidate,
} from "@/lib/ingest";

const TRUSTED_PUBLISHERS: Record<string, { regionCode: string; regionName: string; cityName?: string }> = {
  "湖北发布": { regionCode: "420000", regionName: "湖北省" },
  "湖北省科技厅": { regionCode: "420000", regionName: "湖北省" },
  "湖北科技": { regionCode: "420000", regionName: "湖北省" },
  "武汉科技创新": { regionCode: "420100", regionName: "湖北省", cityName: "武汉市" },
  "武汉市科技创新局": { regionCode: "420100", regionName: "湖北省", cityName: "武汉市" },
};

function parseWechatUrl(input: string): string {
  if (input.length > 2048) throw new Error("url is too long");
  const url = new URL(input);
  if (url.hostname !== "mp.weixin.qq.com" || url.port) throw new Error("only mp.weixin.qq.com article URLs are allowed");
  if (url.pathname !== "/s" && !url.pathname.startsWith("/s/")) throw new Error("not a WeChat article URL");
  url.protocol = "https:";
  url.hash = "";
  return canonicalizeUrl(url.toString());
}

function htmlToText(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function articleObject(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object") throw new Error("unexpected WeChat response");
  const root = payload as Record<string, unknown>;
  const value = root.data && typeof root.data === "object" ? root.data : root;
  if (Array.isArray(value)) {
    const first = value[0];
    if (first && typeof first === "object") return first as Record<string, unknown>;
  }
  if (value && typeof value === "object") return value as Record<string, unknown>;
  throw new Error("article data is missing");
}

function timestampToIso(value: unknown): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds > 1_000_000_000) return new Date(seconds * 1000).toISOString();
  return new Date().toISOString();
}

async function fetchWechatArticle(url: string): Promise<Record<string, unknown>> {
  const endpoint = `https://down.mptext.top/api/public/v1/download?url=${encodeURIComponent(url)}&format=json`;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
        signal: AbortSignal.timeout(30_000),
        headers: { accept: "application/json" },
      });
      const contentLength = Number(response.headers.get("content-length") ?? 0);
      if (contentLength > 12_000_000) throw new Error("WeChat response is too large");
      if (!response.ok) {
        if (![429, 502, 503, 504].includes(response.status)) {
          throw new Error(`WeChat export failed with ${response.status}`);
        }
        throw new Error(`retryable WeChat error ${response.status}`);
      }
      const text = await response.text();
      if (text.length > 12_000_000) throw new Error("WeChat response is too large");
      return articleObject(JSON.parse(text));
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("WeChat export failed");
      if (attempt < 2 && /retryable|fetch|network|timeout|aborted/i.test(lastError.message)) {
        await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 1000));
        continue;
      }
      break;
    }
  }
  throw lastError ?? new Error("WeChat export failed");
}

export async function POST(request: Request) {
  if (!getIngestKey()) {
    return Response.json({ error: "wechat import is not configured" }, { status: 503 });
  }
  if (!isIngestAuthorized(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as { url?: string };
    const inputUrl = parseWechatUrl(body.url?.trim() ?? "");
    const article = await fetchWechatArticle(inputUrl);
    const title = String(article.title ?? "").trim();
    if (!title) throw new Error("article title is missing");

    const publisher = String(article.nick_name ?? article.author ?? "未知公众号").trim();
    const contentText = htmlToText(String(article.content_noencode ?? ""));
    const summary = String(article.desc ?? "").trim() || contentText.slice(0, 320);
    const publishedAt = timestampToIso(
      article.ori_create_time ?? article.create_timestamp ?? article.create_time
    );
    const accountId = String(article.user_name ?? article.bizuin ?? "unknown");
    const mid = String(article.mid ?? "unknown");
    const idx = String(article.idx ?? "1");
    const trusted = TRUSTED_PUBLISHERS[publisher];
    const sourceKey = (await sha256(accountId)).slice(0, 16);
    const sourceUrl = String(article.link ?? inputUrl);
    const result = await upsertCandidate({
      externalId: `wechat:${accountId}:${mid}:${idx}`,
      title,
      itemType: /大赛|竞赛|赛事|路演|揭榜/.test(title) ? "event" : /申报|征集|推荐|认定|申领/.test(title) ? "application" : "policy",
      regionCode: trusted?.regionCode ?? "420000",
      regionName: trusted?.regionName ?? "湖北省",
      cityName: trusted?.cityName ?? null,
      publisherName: publisher,
      summary,
      topics: [],
      publishedAt,
      source: {
        id: `wechat-${sourceKey}`,
        name: publisher,
        type: "wechat",
        publisherName: publisher,
        entryUrl: "https://mp.weixin.qq.com/",
        priority: trusted ? 90 : 10,
      },
      originalUrl: sourceUrl,
      contentText,
      contentHash: contentText ? await sha256(contentText) : null,
      isOfficial: false,
      evidenceStatus: trusted ? "active" : "quarantined",
      score: trusted ? 70 : 20,
      screeningReason: trusted ? "公众号优先发现，等待政府官网同源信息核验。" : "来源账号不在白名单，已隔离等待人工确认。",
    });

    return Response.json({ ok: true, ...result }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "import failed";
    return Response.json({ error: message }, { status: 400 });
  }
}
