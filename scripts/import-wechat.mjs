#!/usr/bin/env node

const articleUrl = process.argv[2];
const baseUrl = process.env.POLICY_RADAR_URL?.replace(/\/$/, "");
const ingestKey = process.env.POLICY_INGEST_KEY;

if (!articleUrl) {
  process.stderr.write("Usage: npm run import:wechat -- 'https://mp.weixin.qq.com/s/...'\n");
  process.exit(2);
}
if (!baseUrl || !ingestKey) {
  process.stderr.write("POLICY_RADAR_URL and POLICY_INGEST_KEY are required.\n");
  process.exit(2);
}

const response = await fetch(`${baseUrl}/api/import/wechat`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${ingestKey}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({ url: articleUrl }),
  signal: AbortSignal.timeout(60_000),
});

const result = await response.json();
if (!response.ok) {
  process.stderr.write(`Import failed (${response.status}): ${result.error ?? "unknown error"}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
