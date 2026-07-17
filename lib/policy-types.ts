export type ItemType = "policy" | "application" | "event";
export type VerificationStatus =
  | "official_verified"
  | "pending_official"
  | "source_only"
  | "conflict";

export interface PolicySourceLink {
  label: string;
  url: string;
  sourceType: "official_site" | "wechat" | "manual";
  sourceName: string;
}

export interface PolicyItem {
  id: string;
  title: string;
  itemType: ItemType;
  regionName: string;
  cityName: string | null;
  publisherName: string;
  summary: string;
  applicationTargets: string | null;
  benefits: string | null;
  topics: string[];
  publishedAt: string;
  deadlineAt: string | null;
  lifecycleStatus: string;
  verificationStatus: VerificationStatus;
  primaryUrl: string;
  primarySourceType: string;
  primarySourceName: string;
  sourceCount: number;
  score: number;
  screeningReason: string;
  documentNumber: string | null;
  discoveredAt: string;
  sourceLinks?: PolicySourceLink[];
}

export interface PolicySource {
  id: string;
  name: string;
  sourceType: "official_site" | "wechat" | "rss" | "manual";
  publisherName: string;
  entryUrl: string;
  healthStatus: "healthy" | "degraded" | "failing" | "paused";
  pollIntervalMinutes: number;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  lastInsertedCount?: number;
  loginExpiresAt?: string | null;
  lastErrorAt?: string | null;
  lastErrorMessage?: string | null;
  consecutiveFailures?: number;
  priority: number;
}

export function formatDate(value: string | null): string {
  if (!value) return "长期有效";
  const date = new Date(`${value.slice(0, 10)}T00:00:00+08:00`);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
  }).format(date);
}

export function daysUntil(value: string | null): number | null {
  if (!value) return null;
  const end = new Date(`${value.slice(0, 10)}T23:59:59+08:00`).getTime();
  return Math.ceil((end - Date.now()) / 86_400_000);
}
