#!/usr/bin/env node

const input = process.argv[2];
if (!input || input.length > 2048) {
  process.stderr.write("Usage: npm run check:wechat -- 'https://mp.weixin.qq.com/s/...'\n");
  process.exit(2);
}

const articleUrl = new URL(input);
if (articleUrl.hostname !== "mp.weixin.qq.com" || articleUrl.port || (articleUrl.pathname !== "/s" && !articleUrl.pathname.startsWith("/s/"))) {
  process.stderr.write("Only public mp.weixin.qq.com article URLs are allowed.\n");
  process.exit(2);
}
articleUrl.protocol = "https:";
articleUrl.hash = "";

const endpoint = `https://down.mptext.top/api/public/v1/download?url=${encodeURIComponent(articleUrl.toString())}&format=json`;
const response = await fetch(endpoint, {
  signal: AbortSignal.timeout(30_000),
  headers: { accept: "application/json" },
});
if (!response.ok) {
  process.stderr.write(`Public article check failed: ${response.status}\n`);
  process.exit(1);
}

const text = await response.text();
if (text.length > 12_000_000) throw new Error("response is too large");
const root = JSON.parse(text);
let article = root?.data ?? root;
if (Array.isArray(article)) article = article[0];
if (!article || typeof article !== "object") throw new Error("article data is missing");

const content = String(article.content_noencode ?? "")
  .replace(/<script[\s\S]*?<\/script>/gi, " ")
  .replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/gi, " ")
  .replace(/&amp;/gi, "&")
  .replace(/\s+/g, " ")
  .trim();

// Intentionally print only the same allowlisted fields used by the importer.
// Never print the full response because it can contain session and user state.
process.stdout.write(`${JSON.stringify({
  title: String(article.title ?? "").trim(),
  publisher: String(article.nick_name ?? article.author ?? "").trim(),
  publishedAt: article.ori_create_time ?? article.create_timestamp ?? article.create_time ?? null,
  sourceUrl: String(article.link ?? articleUrl.toString()),
  accountIdPresent: Boolean(article.user_name),
  articleIdPresent: Boolean(article.mid),
  summaryLength: String(article.desc ?? "").length,
  contentTextLength: content.length,
}, null, 2)}\n`);
