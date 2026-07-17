import { getDatabase } from "@/db";
import { getRuntimeEnv } from "@/lib/runtime-env";

export interface IngestCandidate {
  externalId?: string | null;
  title: string;
  itemType: "policy" | "application" | "event";
  regionCode: string;
  regionName: string;
  cityName?: string | null;
  publisherName: string;
  summary?: string;
  applicationTargets?: string | null;
  benefits?: string | null;
  topics?: string[];
  publishedAt: string;
  deadlineAt?: string | null;
  documentNumber?: string | null;
  source: {
    id: string;
    name: string;
    type: "official_site" | "wechat" | "rss" | "manual";
    publisherName: string;
    entryUrl: string;
    priority?: number;
  };
  originalUrl: string;
  contentText?: string;
  contentHash?: string | null;
  isOfficial: boolean;
  evidenceStatus?: "active" | "quarantined";
  score?: number;
  screeningReason?: string;
}

export interface IngestResult {
  action: "created" | "matched" | "duplicate" | "quarantined";
  itemId: string;
  verificationStatus: "official_verified" | "pending_official" | "source_only";
}

export function canonicalizeUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  url.protocol = "https:";
  for (const name of ["utm_source", "utm_medium", "utm_campaign", "from", "scene"]) {
    url.searchParams.delete(name);
  }
  url.searchParams.sort();
  return url.toString();
}

export function normalizeTitle(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\s\u200b-\u200d\ufeff]+/g, "")
    .replace(/[“”‘’《》【】\[\]()（）:：,，。.!！?？·•—_-]/g, "")
    .toLowerCase();
}

export async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function cleanText(value: string | undefined, maxLength: number): string {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(value);
}

export function validateCandidate(input: IngestCandidate): IngestCandidate {
  const title = cleanText(input.title, 300);
  const publisherName = cleanText(input.publisherName, 120);
  if (!title || !publisherName) throw new Error("title and publisherName are required");
  if (!["policy", "application", "event"].includes(input.itemType)) {
    throw new Error("invalid itemType");
  }
  if (!isIsoDate(input.publishedAt)) throw new Error("invalid publishedAt");
  if (input.deadlineAt && !isIsoDate(input.deadlineAt)) throw new Error("invalid deadlineAt");
  canonicalizeUrl(input.originalUrl);
  canonicalizeUrl(input.source.entryUrl);

  return {
    ...input,
    title,
    publisherName,
    summary: cleanText(input.summary, 1200),
    applicationTargets: cleanText(input.applicationTargets ?? undefined, 600) || null,
    benefits: cleanText(input.benefits ?? undefined, 600) || null,
    documentNumber: cleanText(input.documentNumber ?? undefined, 120) || null,
    screeningReason: cleanText(input.screeningReason, 600),
    contentText: cleanText(input.contentText, 80_000),
    topics: (input.topics ?? []).map((topic) => cleanText(topic, 40)).filter(Boolean).slice(0, 12),
  };
}

function id(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

export async function upsertCandidate(rawInput: IngestCandidate): Promise<IngestResult> {
  const input = validateCandidate(rawInput);
  const db = getDatabase();
  const now = new Date().toISOString();
  const canonicalUrl = canonicalizeUrl(input.originalUrl);
  const sourceEntryUrl = canonicalizeUrl(input.source.entryUrl);
  const normalizedTitle = normalizeTitle(input.title);
  const dedupeKey = input.documentNumber
    ? `${input.regionCode}|doc|${normalizeTitle(input.documentNumber)}`
    : `${input.regionCode}|${normalizedTitle}|${normalizeTitle(input.publisherName)}|${input.publishedAt.slice(0, 10)}`;
  const verificationStatus = input.evidenceStatus === "quarantined"
    ? "source_only"
    : input.isOfficial
      ? "official_verified"
      : "pending_official";

  await db
    .prepare(
      `INSERT INTO sources (
        id, name, source_type, region_code, publisher_name, entry_url,
        priority, is_active, health_status, last_checked_at, last_success_at,
        created_at, updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'healthy', ?9, ?9, ?9, ?9)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        publisher_name = excluded.publisher_name,
        entry_url = excluded.entry_url,
        last_checked_at = excluded.last_checked_at,
        last_success_at = excluded.last_success_at,
        updated_at = excluded.updated_at`
    )
    .bind(
      input.source.id,
      input.source.name,
      input.source.type,
      input.regionCode,
      input.source.publisherName,
      sourceEntryUrl,
      input.source.priority ?? 50,
      input.evidenceStatus === "quarantined" ? 0 : 1,
      now
    )
    .run();

  const sourceMatch = await db
    .prepare(
      `SELECT item_id FROM item_sources
       WHERE canonical_url = ?1 OR (source_id = ?2 AND external_id = ?3)
       LIMIT 1`
    )
    .bind(canonicalUrl, input.source.id, input.externalId ?? null)
    .first<{ item_id: string }>();

  if (sourceMatch) {
    await db
      .prepare("UPDATE item_sources SET last_seen_at = ?1 WHERE item_id = ?2 AND source_id = ?3")
      .bind(now, sourceMatch.item_id, input.source.id)
      .run();
    return {
      action: "duplicate",
      itemId: sourceMatch.item_id,
      verificationStatus,
    };
  }

  const itemMatch = await db
    .prepare("SELECT id, verification_status FROM items WHERE dedupe_key = ?1 LIMIT 1")
    .bind(dedupeKey)
    .first<{ id: string; verification_status: string }>();

  const itemId = itemMatch?.id ?? id("item");
  if (!itemMatch) {
    await db
      .prepare(
        `INSERT INTO items (
          id, dedupe_key, title, normalized_title, document_number, item_type,
          region_code, region_name, city_name, publisher_name, summary,
          application_targets, benefits, topics_json, published_at, deadline_at,
          lifecycle_status, verification_status, verified_at, primary_url,
          primary_source_type, primary_source_name, source_count, score,
          screening_reason, discovered_at, updated_at
        ) VALUES (
          ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13,
          ?14, ?15, ?16, 'open', ?17, ?18, ?19, ?20, ?21, 1, ?22, ?23, ?24, ?24
        )`
      )
      .bind(
        itemId,
        dedupeKey,
        input.title,
        normalizedTitle,
        input.documentNumber ?? null,
        input.itemType,
        input.regionCode,
        input.regionName,
        input.cityName ?? null,
        input.publisherName,
        input.summary ?? "",
        input.applicationTargets ?? null,
        input.benefits ?? null,
        JSON.stringify(input.topics ?? []),
        input.publishedAt,
        input.deadlineAt ?? null,
        verificationStatus,
        input.isOfficial ? now : null,
        canonicalUrl,
        input.source.type,
        input.source.name,
        input.score ?? 50,
        input.screeningReason ?? "",
        now
      )
      .run();
  }

  const sourceId = id("evidence");
  await db
    .prepare(
      `INSERT INTO item_sources (
        id, item_id, source_id, external_id, original_url, canonical_url,
        source_title, source_publisher, published_at, discovered_at,
        last_seen_at, content_hash, content_text, is_official, is_primary,
        match_type, match_confidence, evidence_status
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)`
    )
    .bind(
      sourceId,
      itemId,
      input.source.id,
      input.externalId ?? null,
      input.originalUrl,
      canonicalUrl,
      input.title,
      input.publisherName,
      input.publishedAt,
      now,
      input.contentHash ?? null,
      input.contentText ?? null,
      input.isOfficial ? 1 : 0,
      itemMatch ? 0 : 1,
      itemMatch ? (input.documentNumber ? "document_number" : "title_date") : "new",
      itemMatch ? 95 : 100,
      input.evidenceStatus ?? "active"
    )
    .run();

  if (itemMatch) {
    await db
      .prepare(
        `UPDATE items SET
          source_count = source_count + 1,
          verification_status = CASE WHEN ?1 = 1 THEN 'official_verified' ELSE verification_status END,
          verified_at = CASE WHEN ?1 = 1 THEN ?2 ELSE verified_at END,
          primary_url = CASE WHEN ?1 = 1 THEN ?3 ELSE primary_url END,
          primary_source_type = CASE WHEN ?1 = 1 THEN ?4 ELSE primary_source_type END,
          primary_source_name = CASE WHEN ?1 = 1 THEN ?5 ELSE primary_source_name END,
          updated_at = ?2
        WHERE id = ?6`
      )
      .bind(
        input.isOfficial ? 1 : 0,
        now,
        canonicalUrl,
        input.source.type,
        input.source.name,
        itemId
      )
      .run();
  }

  return {
    action: input.evidenceStatus === "quarantined" ? "quarantined" : itemMatch ? "matched" : "created",
    itemId,
    verificationStatus,
  };
}

export function getIngestKey(): string {
  return (getRuntimeEnv().POLICY_INGEST_KEY ?? "").trim();
}

export function isIngestAuthorized(request: Request): boolean {
  const configured = getIngestKey();
  if (!configured) return false;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  return supplied === configured;
}
