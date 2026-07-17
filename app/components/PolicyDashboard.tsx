"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  daysUntil,
  formatDate,
  type ItemType,
  type PolicyItem,
  type PolicySource,
  type VerificationStatus,
} from "@/lib/policy-types";

const typeLabels: Record<ItemType, string> = {
  policy: "政策",
  application: "申报",
  event: "赛事",
};

const statusLabels: Record<VerificationStatus, string> = {
  official_verified: "官网已核验",
  pending_official: "公众号首发 · 待核验",
  source_only: "来源待确认",
  conflict: "信息有冲突",
};

function Icon({ name }: { name: "search" | "arrow" | "check" | "clock" | "source" | "calendar" }) {
  const paths = {
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    arrow: <><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></>,
    check: <><path d="M20 6 9 17l-5-5"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    source: <><path d="M5 4h14v16H5z"/><path d="M8 8h8M8 12h8M8 16h5"/></>,
    calendar: <><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
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
  const [type, setType] = useState<"all" | ItemType>("all");
  const [verification, setVerification] = useState<"all" | VerificationStatus>("all");
  const [query, setQuery] = useState("");

  const visibleItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return initialItems.filter((item) => {
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
  }, [initialItems, query, type, verification]);

  const verifiedCount = initialItems.filter(
    (item) => item.verificationStatus === "official_verified"
  ).length;
  const pendingCount = initialItems.filter(
    (item) => item.verificationStatus === "pending_official"
  ).length;
  const urgentCount = initialItems.filter((item) => {
    const days = daysUntil(item.deadlineAt);
    return days !== null && days >= 0 && days <= 14;
  }).length;
  const wechatSources = sources.filter((source) => source.sourceType === "wechat");
  const healthyWechatSources = wechatSources.filter(
    (source) => source.healthStatus === "healthy"
  );
  const completeWechatScanAt = wechatSources
    .map((source) => source.lastCheckedAt)
    .filter((value): value is string => Boolean(value))
    .sort()[0] ?? null;
  const wechatInsertedCount = wechatSources.reduce(
    (sum, source) => sum + (source.lastInsertedCount ?? 0),
    0
  );
  const wechatLoginExpiresAt = wechatSources
    .map((source) => source.loginExpiresAt)
    .filter((value): value is string => Boolean(value))
    .sort()[0] ?? null;
  const scanTime = completeWechatScanAt
    ? new Intl.DateTimeFormat("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: "Asia/Shanghai",
      }).format(new Date(completeWechatScanAt))
    : "待首次扫描";
  const loginDate = wechatLoginExpiresAt
    ? new Intl.DateTimeFormat("zh-CN", {
        month: "numeric",
        day: "numeric",
        timeZone: "Asia/Shanghai",
      }).format(new Date(wechatLoginExpiresAt))
    : "待登录";

  return (
    <>
      <section className="hero wrap">
        <div className="hero-copy">
          <div className="eyebrow"><span /> 湖北优先 · 本机每 2 小时扫描</div>
          <h1>每天，只看值得<br />跟进的政策</h1>
          <p>
            公众号负责第一时间发现，政府官网负责权威核验。政策、申报和科创赛事被统一筛选、去重，再送到你面前。
          </p>
          <div className="hero-actions">
            <a href="#policy-list" className="primary-action">查看今日政策 <Icon name="arrow" /></a>
            <Link href="/sources" className="secondary-action">查看监控源</Link>
          </div>
        </div>

        <aside className="radar-card" aria-label="最近一次公众号扫描快照">
          <div className="radar-card-top">
            <div>
              <span className="panel-kicker">公众号监测 · 最近快照</span>
              <strong>{healthyWechatSources.length}/{wechatSources.length} 个账号最近正常</strong>
            </div>
            <span className="live-dot">{scanTime} 最近扫描</span>
          </div>
          <div className="radar-visual" aria-hidden="true">
            <span className="radar-ring ring-one" />
            <span className="radar-ring ring-two" />
            <span className="radar-ring ring-three" />
            <span className="radar-sweep" />
            <span className="radar-point point-one" />
            <span className="radar-point point-two" />
            <span className="radar-point point-three" />
            <span className="radar-core">鄂</span>
          </div>
          <div className="radar-legend">
            <span><i className="wechat" /> {wechatSources.length} 个公众号</span>
            <span>本轮发现 <b>{wechatInsertedCount} 篇</b></span>
            <span>登录有效至 <b>{loginDate}</b></span>
          </div>
        </aside>
      </section>

      <section className="metrics wrap" aria-label="政策概览">
        <article><span>当前收录</span><strong>{initialItems.length}</strong><small>条湖北重点信息</small></article>
        <article><span>官网已核验</span><strong>{verifiedCount}</strong><small><Icon name="check" /> 可直接查看原文</small></article>
        <article><span>待官网核验</span><strong>{pendingCount}</strong><small><Icon name="clock" /> 公众号优先发现</small></article>
        <article><span>14 天内截止</span><strong>{urgentCount}</strong><small><Icon name="calendar" /> 建议优先处理</small></article>
      </section>

      <section className="content-shell wrap" id="policy-list">
        <aside className="filter-panel">
          <div className="filter-heading">
            <span>筛选政策</span>
            <button type="button" onClick={() => { setType("all"); setVerification("all"); setQuery(""); }}>重置</button>
          </div>

          <label className="search-box">
            <Icon name="search" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、单位或关键词" />
          </label>

          <div className="filter-group">
            <span className="filter-label">信息类型</span>
            <div className="filter-options">
              {(["all", "policy", "application", "event"] as const).map((value) => (
                <button className={type === value ? "active" : ""} key={value} type="button" onClick={() => setType(value)}>
                  {value === "all" ? "全部" : typeLabels[value]}
                  <em>{value === "all" ? initialItems.length : initialItems.filter((item) => item.itemType === value).length}</em>
                </button>
              ))}
            </div>
          </div>

          <div className="filter-group">
            <span className="filter-label">核验状态</span>
            <div className="filter-options">
              <button className={verification === "all" ? "active" : ""} type="button" onClick={() => setVerification("all")}>全部来源</button>
              <button className={verification === "official_verified" ? "active" : ""} type="button" onClick={() => setVerification("official_verified")}>官网已核验</button>
              <button className={verification === "pending_official" ? "active" : ""} type="button" onClick={() => setVerification("pending_official")}>公众号首发</button>
            </div>
          </div>

          <div className="scope-note">
            <span>当前监控范围</span>
            <strong>湖北省 · 武汉市优先</strong>
            <p>下一阶段扩展河南、湖南、安徽、江西。</p>
          </div>
        </aside>

        <main className="feed">
          <div className="feed-head">
            <div><span className="section-kicker">政策流</span><h2>与你相关的最新信息</h2></div>
            <span className="result-count">找到 {visibleItems.length} 条</span>
          </div>

          <div className="mobile-type-tabs" aria-label="信息类型筛选">
            {(["all", "policy", "application", "event"] as const).map((value) => (
              <button className={type === value ? "active" : ""} key={value} type="button" onClick={() => setType(value)}>
                {value === "all" ? "全部" : typeLabels[value]}
              </button>
            ))}
          </div>

          {visibleItems.length > 0 ? (
            <div className="policy-list">
              {visibleItems.map((item) => {
                const deadline = deadlineCopy(item.deadlineAt, item.lifecycleStatus);
                return (
                  <article className="policy-card" key={item.id}>
                    <div className="policy-card-body">
                      <div className="badge-row">
                        <span className={`type-badge ${item.itemType}`}>{typeLabels[item.itemType]}</span>
                        <span className="region-badge">{item.cityName ?? item.regionName}</span>
                        <span className={`verify-badge ${item.verificationStatus}`}>
                          {item.verificationStatus === "official_verified" && <Icon name="check" />}
                          {statusLabels[item.verificationStatus]}
                        </span>
                      </div>
                      <Link href={`/items/${item.id}`} className="policy-title">{item.title}</Link>
                      <p className="policy-summary">{item.summary}</p>
                      {item.topics.length > 0 && <div className="topic-row">{item.topics.slice(0, 4).map((topic) => <span key={topic}>{topic}</span>)}</div>}
                      <div className="policy-meta">
                        <span>{item.publisherName}</span>
                        <i />
                        <span>{formatDate(item.publishedAt)} 发布</span>
                        <i />
                        <span>{item.sourceCount} 个来源</span>
                      </div>
                    </div>
                    <div className="policy-card-side">
                      <span className={`deadline ${deadline.tone}`}>{deadline.label}</span>
                      <span className="score"><b>{item.score}</b> 匹配度</span>
                      <Link href={`/items/${item.id}`} aria-label={`查看 ${item.title}`}><Icon name="arrow" /></Link>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="empty-state">
              <span>暂无匹配结果</span>
              <p>换一个关键词，或者重置筛选条件。</p>
            </div>
          )}
        </main>
      </section>

      <section className="source-strip wrap">
        <div><span className="section-kicker">信息源</span><h2>公众号抢速度，官网保准确</h2></div>
        <div className="source-flow" aria-label="采集工作流">
          <span>公众号 / 官网</span><Icon name="arrow" /><span>统一去重</span><Icon name="arrow" /><span>规则筛选</span><Icon name="arrow" /><strong>政策雷达</strong>
        </div>
        <Link href="/sources">查看全部来源状态 <Icon name="arrow" /></Link>
      </section>
    </>
  );
}
