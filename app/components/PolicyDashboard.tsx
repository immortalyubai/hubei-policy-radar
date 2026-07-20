"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  daysUntil,
  formatDate,
  type ItemType,
  type PolicyItem,
  type PolicySource,
  type VerificationStatus,
} from "@/lib/policy-types";

const PAGE_SIZE = 8;
const REFRESH_INTERVAL_MS = 120_000;

const typeLabels: Record<ItemType, string> = {
  policy: "政策",
  application: "申报",
  event: "赛事",
};

const statusLabels: Record<VerificationStatus, string> = {
  official_verified: "官网已核验",
  pending_official: "公众号首发",
  source_only: "来源待确认",
  conflict: "信息有冲突",
};

function Icon({ name }: { name: "search" | "arrow" | "check" | "clock" }) {
  const paths = {
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    arrow: <><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></>,
    check: <><path d="M20 6 9 17l-5-5"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

function safeTimestamp(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function itemTimestamp(item: PolicyItem): number {
  return safeTimestamp(item.publishedAt) || safeTimestamp(item.discoveredAt);
}

function sortNewestFirst(items: PolicyItem[]): PolicyItem[] {
  return [...items].sort(
    (left, right) =>
      itemTimestamp(right) - itemTimestamp(left) ||
      safeTimestamp(right.discoveredAt) - safeTimestamp(left.discoveredAt) ||
      right.score - left.score,
  );
}

function newestDataTimestamp(items: PolicyItem[]): string | null {
  const timestamps = items.map((item) => safeTimestamp(item.discoveredAt)).filter(Boolean);
  return timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : null;
}

function formatDateTime(value: string | null): string {
  if (!value) return "等待首批数据";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间待核验";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(date);
}

function relativeTime(value: string, now: number | null): string {
  if (!value.includes("T")) return `${formatDate(value)} 发布`;
  if (!now) return `${formatDate(value)} 发布`;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return `${formatDate(value)} 发布`;
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60_000));
  if (minutes < 60) return minutes <= 1 ? "刚刚发布" : `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  if (hours < 72) return `${Math.floor(hours / 24)} 天前`;
  return `${formatDate(value)} 发布`;
}

function deadlineCopy(deadlineAt: string | null, lifecycleStatus: string) {
  if (!deadlineAt && lifecycleStatus === "pending_deadline") {
    return { label: "截止时间待核验", tone: "muted" };
  }
  const days = daysUntil(deadlineAt);
  if (days === null) return { label: "长期有效", tone: "calm" };
  if (days < 0) return { label: "已截止", tone: "muted" };
  if (days === 0) return { label: "今天截止", tone: "urgent" };
  if (days <= 7) return { label: `${days} 天后截止`, tone: "urgent" };
  return { label: `${formatDate(deadlineAt)} 截止`, tone: "calm" };
}

export default function PolicyDashboard({
  initialItems,
  sources,
}: {
  initialItems: PolicyItem[];
  sources: PolicySource[];
}) {
  const [items, setItems] = useState(() => sortNewestFirst(initialItems));
  const [monitoredSources, setMonitoredSources] = useState(sources);
  const [type, setType] = useState<"all" | ItemType>("all");
  const [verification, setVerification] = useState<"all" | VerificationStatus>("all");
  const [query, setQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [newItemsCount, setNewItemsCount] = useState(0);
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [now, setNow] = useState<number | null>(null);
  const loadMoreRef = useRef<HTMLButtonElement | null>(null);
  const itemsRef = useRef(items);
  const activeRequestRef = useRef<AbortController | null>(null);
  const requestSequenceRef = useRef(0);

  const refreshItems = useCallback(async () => {
    const sequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = sequence;
    activeRequestRef.current?.abort();
    const controller = new AbortController();
    activeRequestRef.current = controller;
    try {
      const [response, sourceResponse] = await Promise.all([
        fetch("/api/items?limit=100", { cache: "no-store", signal: controller.signal }),
        fetch("/api/sources", { cache: "no-store", signal: controller.signal }),
      ]);
      if (!response.ok || !sourceResponse.ok) {
        throw new Error(`Policy refresh failed: ${response.status}/${sourceResponse.status}`);
      }
      const [payload, sourcePayload] = await Promise.all([
        response.json() as Promise<{ items?: PolicyItem[] }>,
        sourceResponse.json() as Promise<{ sources?: PolicySource[] }>,
      ]);
      if (!Array.isArray(payload.items)) throw new Error("Policy refresh returned invalid data");
      if (!Array.isArray(sourcePayload.sources)) throw new Error("Source refresh returned invalid data");
      if (sequence !== requestSequenceRef.current || controller.signal.aborted) return;
      const knownIds = new Set(itemsRef.current.map((item) => item.id));
      const added = payload.items.filter((item) => !knownIds.has(item.id)).length;
      const nextItems = sortNewestFirst(payload.items);
      itemsRef.current = nextItems;
      setItems(nextItems);
      setMonitoredSources(sourcePayload.sources);
      if (added > 0 && window.scrollY > 240) {
        setNewItemsCount((count) => count + added);
      }
      const checkedAt = Date.now();
      setLastCheckedAt(checkedAt);
      setNow(checkedAt);
      setRefreshFailed(false);
    } catch {
      if (!controller.signal.aborted && sequence === requestSequenceRef.current) {
        setRefreshFailed(true);
      }
    } finally {
      if (activeRequestRef.current === controller) activeRequestRef.current = null;
    }
  }, []);

  useEffect(() => {
    const initialRefresh = window.setTimeout(() => void refreshItems(), 0);
    const minuteTimer = window.setInterval(() => setNow(Date.now()), 60_000);
    const refreshTimer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshItems();
    }, REFRESH_INTERVAL_MS);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void refreshItems();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearTimeout(initialRefresh);
      window.clearInterval(minuteTimer);
      window.clearInterval(refreshTimer);
      activeRequestRef.current?.abort();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [refreshItems]);

  const visibleItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return items.filter((item) => {
      const typeMatches = type === "all" || item.itemType === type;
      const verificationMatches =
        verification === "all" || item.verificationStatus === verification;
      const queryMatches =
        !normalizedQuery ||
        [
          item.title,
          item.publisherName,
          item.summary,
          item.applicationTargets ?? "",
          item.topics.join(" "),
        ]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery);
      return typeMatches && verificationMatches && queryMatches;
    });
  }, [items, query, type, verification]);

  const displayedItems = visibleItems.slice(0, visibleCount);
  const hasMore = visibleCount < visibleItems.length;

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || !hasMore || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisibleCount((count) => Math.min(count + PAGE_SIZE, visibleItems.length));
        }
      },
      { rootMargin: "240px 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMore, visibleItems.length]);

  const verifiedCount = items.filter(
    (item) => item.verificationStatus === "official_verified",
  ).length;
  const urgentCount = items.filter((item) => {
    const days = daysUntil(item.deadlineAt);
    return days !== null && days >= 0 && days <= 14;
  }).length;
  const wechatSources = monitoredSources.filter((source) => source.sourceType === "wechat");
  const healthyWechatSources = wechatSources.filter(
    (source) => source.healthStatus === "healthy",
  );
  const completedScanTimes = wechatSources
    .map((source) => source.lastCheckedAt)
    .filter((value): value is string => Boolean(value))
    .map((value) => Date.parse(value))
    .filter(Number.isFinite);
  const completeWechatScanAt =
    wechatSources.length > 0 && completedScanTimes.length === wechatSources.length
      ? new Date(Math.min(...completedScanTimes)).toISOString()
      : null;
  const dataUpdatedAt = newestDataTimestamp(items);
  const reset = () => {
    setType("all");
    setVerification("all");
    setQuery("");
    setVisibleCount(PAGE_SIZE);
  };
  const revealNewItems = () => {
    setNewItemsCount(0);
    reset();
    window.requestAnimationFrame(() => {
      const firstCard = document.querySelector<HTMLElement>(".stream-card");
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      firstCard?.scrollIntoView({
        behavior: reduceMotion ? "auto" : "smooth",
        block: "start",
      });
    });
  };

  return (
    <>
      <section className="stream-hero wrap">
        <div className="stream-heading">
          <div className="eyebrow"><span /> 湖北优先 · 已筛选政策流</div>
          <h1>最新政策，打开就能看</h1>
          <p>按发布时间持续更新。只保留与你相关的政策、项目申报和科创赛事。</p>
        </div>
        <aside className="stream-status" aria-label="政策流更新状态">
          <span className={`stream-live ${refreshFailed ? "warning" : ""}`}><i /> {refreshFailed ? "页面本轮检查失败" : "页面每 2 分钟检查新数据"}</span>
          <strong>数据最近更新于 {formatDateTime(dataUpdatedAt)}</strong>
          <small>
            {healthyWechatSources.length}/{wechatSources.length} 个公众号上次扫描正常
            <span aria-hidden="true"> · </span>
            最近完整扫描 {formatDateTime(completeWechatScanAt)}
          </small>
        </aside>
      </section>

      <section className="stream-overview wrap" aria-label="政策流概览">
        <span><b>{items.length}</b> 条已筛选</span>
        <span><b>{verifiedCount}</b> 条官网核验</span>
        <span><b>{urgentCount}</b> 条 14 天内截止</span>
        <Link href="/sources">查看监控源 <Icon name="arrow" /></Link>
      </section>

      <section className="feed-controls-shell" aria-label="政策筛选">
        <div className="feed-controls wrap">
          <div className="type-tabs" aria-label="信息类型" role="group">
            {(["all", "policy", "application", "event"] as const).map((value) => (
              <button
                aria-pressed={type === value}
                className={type === value ? "active" : ""}
                key={value}
                type="button"
                onClick={() => {
                  setType(value);
                  setVisibleCount(PAGE_SIZE);
                }}
              >
                {value === "all" ? "全部" : typeLabels[value]}
              </button>
            ))}
          </div>

          <label className="stream-search">
            <Icon name="search" />
            <input
              aria-label="搜索政策"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setVisibleCount(PAGE_SIZE);
              }}
              placeholder="搜索政策、单位或关键词"
            />
          </label>

          <div className="verify-tabs" aria-label="核验状态" role="group">
            <button aria-pressed={verification === "all"} className={verification === "all" ? "active" : ""} type="button" onClick={() => { setVerification("all"); setVisibleCount(PAGE_SIZE); }}>全部来源</button>
            <button aria-pressed={verification === "official_verified"} className={verification === "official_verified" ? "active" : ""} type="button" onClick={() => { setVerification("official_verified"); setVisibleCount(PAGE_SIZE); }}>官网核验</button>
            <button aria-pressed={verification === "pending_official"} className={verification === "pending_official" ? "active" : ""} type="button" onClick={() => { setVerification("pending_official"); setVisibleCount(PAGE_SIZE); }}>公众号首发</button>
          </div>

          <label className="mobile-verification-select">
            <span>核验</span>
            <select
              aria-label="核验状态"
              value={verification}
              onChange={(event) => {
                setVerification(event.target.value as "all" | VerificationStatus);
                setVisibleCount(PAGE_SIZE);
              }}
            >
              <option value="all">全部来源</option>
              <option value="official_verified">官网核验</option>
              <option value="pending_official">公众号首发</option>
            </select>
          </label>
        </div>
      </section>

      <main className="stream-content wrap" id="policy-list">
        <div className="feed-head stream-feed-head">
          <div>
            <span className="section-kicker">LATEST POLICY FEED</span>
            <h2>最新筛选结果</h2>
          </div>
          <div className="feed-result-meta">
            <span aria-live="polite">{visibleItems.length} 条结果 · 最新优先</span>
            {lastCheckedAt && <small>页面检查于 {new Date(lastCheckedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })}</small>}
          </div>
        </div>

        <span aria-atomic="true" aria-live="polite" className="feed-announcer" role="status">
          {newItemsCount > 0 ? `发现 ${newItemsCount} 条新政策` : ""}
        </span>

        {newItemsCount > 0 && (
          <button
            className="new-items-banner"
            type="button"
            onClick={revealNewItems}
          >
            发现 {newItemsCount} 条新政策，点击查看 <span aria-hidden="true">↑</span>
          </button>
        )}

        {displayedItems.length > 0 ? (
          <div className="policy-list stream-list">
            {displayedItems.map((item, index) => {
              const deadline = deadlineCopy(item.deadlineAt, item.lifecycleStatus);
              const isLatest = index === 0 && type === "all" && verification === "all" && !query;
              return (
                <article className="policy-card stream-card" key={item.id}>
                  <Link className="stream-card-link" href={`/items/${item.id}`} aria-label={`查看 ${item.title}`}>
                    <div className="policy-card-body">
                      <div className="stream-card-topline">
                        <span className={isLatest ? "latest-time" : ""}>{isLatest && <i />} {relativeTime(item.publishedAt, now)}</span>
                        <span>{item.publisherName}</span>
                      </div>
                      <div className="badge-row">
                        <span className={`type-badge ${item.itemType}`}>{typeLabels[item.itemType]}</span>
                        <span className="region-badge">{item.cityName ?? item.regionName}</span>
                        <span className={`verify-badge ${item.verificationStatus}`}>
                          {item.verificationStatus === "official_verified" && <Icon name="check" />}
                          {statusLabels[item.verificationStatus]}
                        </span>
                      </div>
                      <h3 className="policy-title">{item.title}</h3>
                      <p className="policy-summary">{item.summary}</p>
                      {item.topics.length > 0 && (
                        <div className="topic-row">
                          {item.topics.slice(0, 4).map((topic) => <span key={topic}>{topic}</span>)}
                        </div>
                      )}
                    </div>
                    <div className="policy-card-side stream-card-side">
                      <span className={`deadline ${deadline.tone}`}>{deadline.label}</span>
                      <span className="score"><b>{item.score}</b> 匹配度</span>
                      <span className="card-read-more">查看详情 <Icon name="arrow" /></span>
                    </div>
                  </Link>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="empty-state">
            <span>暂无匹配结果</span>
            <p>换一个关键词，或者重置筛选条件。</p>
            <button type="button" onClick={reset}>重置筛选</button>
          </div>
        )}

        {hasMore && (
          <button
            className="load-more"
            ref={loadMoreRef}
            type="button"
            onClick={() => setVisibleCount((count) => Math.min(count + PAGE_SIZE, visibleItems.length))}
          >
            继续向下加载
          </button>
        )}
        {!hasMore && visibleItems.length > PAGE_SIZE && (
          <p className="feed-end">已经看到当前筛选结果的底部</p>
        )}
      </main>
    </>
  );
}
