import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const sources = sqliteTable(
  "sources",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    sourceType: text("source_type").notNull(),
    regionCode: text("region_code").notNull().default("420000"),
    publisherName: text("publisher_name").notNull(),
    entryUrl: text("entry_url").notNull(),
    priority: integer("priority").notNull().default(50),
    pollIntervalMinutes: integer("poll_interval_minutes").notNull().default(120),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    healthStatus: text("health_status").notNull().default("healthy"),
    lastCheckedAt: text("last_checked_at"),
    lastSuccessAt: text("last_success_at"),
    lastErrorAt: text("last_error_at"),
    lastErrorMessage: text("last_error_message"),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("sources_type_url_idx").on(table.sourceType, table.entryUrl),
    index("sources_active_priority_idx").on(table.isActive, table.priority),
    index("sources_region_type_idx").on(table.regionCode, table.sourceType),
  ]
);

export const items = sqliteTable(
  "items",
  {
    id: text("id").primaryKey(),
    dedupeKey: text("dedupe_key").notNull(),
    title: text("title").notNull(),
    normalizedTitle: text("normalized_title").notNull(),
    documentNumber: text("document_number"),
    itemType: text("item_type").notNull(),
    regionCode: text("region_code").notNull().default("420000"),
    regionName: text("region_name").notNull().default("湖北省"),
    cityName: text("city_name"),
    publisherName: text("publisher_name").notNull(),
    summary: text("summary").notNull().default(""),
    applicationTargets: text("application_targets"),
    benefits: text("benefits"),
    topicsJson: text("topics_json").notNull().default("[]"),
    publishedAt: text("published_at").notNull(),
    effectiveAt: text("effective_at"),
    deadlineAt: text("deadline_at"),
    lifecycleStatus: text("lifecycle_status").notNull().default("unknown"),
    verificationStatus: text("verification_status").notNull().default("pending_official"),
    verifiedAt: text("verified_at"),
    primaryUrl: text("primary_url").notNull(),
    primarySourceType: text("primary_source_type").notNull(),
    primarySourceName: text("primary_source_name").notNull(),
    sourceCount: integer("source_count").notNull().default(1),
    score: integer("score").notNull().default(50),
    screeningReason: text("screening_reason").notNull().default(""),
    discoveredAt: text("discovered_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("items_dedupe_key_unique").on(table.dedupeKey),
    index("items_region_published_idx").on(table.regionCode, table.publishedAt),
    index("items_type_deadline_idx").on(table.itemType, table.deadlineAt),
    index("items_verification_discovered_idx").on(table.verificationStatus, table.discoveredAt),
    index("items_document_number_idx").on(table.documentNumber),
  ]
);

export const itemSources = sqliteTable(
  "item_sources",
  {
    id: text("id").primaryKey(),
    itemId: text("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "restrict" }),
    externalId: text("external_id"),
    originalUrl: text("original_url").notNull(),
    canonicalUrl: text("canonical_url").notNull(),
    sourceTitle: text("source_title").notNull(),
    sourcePublisher: text("source_publisher").notNull(),
    publishedAt: text("published_at"),
    discoveredAt: text("discovered_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    lastSeenAt: text("last_seen_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    contentHash: text("content_hash"),
    contentText: text("content_text"),
    isOfficial: integer("is_official", { mode: "boolean" }).notNull().default(false),
    isPrimary: integer("is_primary", { mode: "boolean" }).notNull().default(false),
    matchType: text("match_type").notNull().default("new"),
    matchConfidence: integer("match_confidence").notNull().default(100),
    evidenceStatus: text("evidence_status").notNull().default("active"),
  },
  (table) => [
    uniqueIndex("item_sources_canonical_url_unique").on(table.canonicalUrl),
    uniqueIndex("item_sources_external_unique").on(table.sourceId, table.externalId),
    index("item_sources_item_primary_idx").on(table.itemId, table.isPrimary),
    index("item_sources_hash_idx").on(table.contentHash),
  ]
);

export const sourceRuns = sqliteTable(
  "source_runs",
  {
    id: text("id").primaryKey(),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at"),
    status: text("status").notNull().default("running"),
    discoveredCount: integer("discovered_count").notNull().default(0),
    insertedCount: integer("inserted_count").notNull().default(0),
    updatedCount: integer("updated_count").notNull().default(0),
    matchedCount: integer("matched_count").notNull().default(0),
    httpStatus: integer("http_status"),
    latencyMs: integer("latency_ms"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
  },
  (table) => [
    index("source_runs_source_started_idx").on(table.sourceId, table.startedAt),
    index("source_runs_status_started_idx").on(table.status, table.startedAt),
  ]
);
