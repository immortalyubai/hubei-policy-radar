import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "../app/globals.css";
import "./pages.css";
import initialData from "./data/policy-data.json";

const typeLabels = { policy: "政策", application: "申报", event: "赛事" };
const PAGE_REFRESH_INTERVAL_MS = 120_000;
const FEED_BATCH_SIZE = 8;
const verificationLabels = {
  official_verified: "官网已核验",
  pending_official: "公众号首发 · 待核验",
  source_only: "来源待确认",
  conflict: "信息有冲突",
};

function formatDate(value, withYear = false) {
  if (!value) return "长期有效";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return new Intl.DateTimeFormat("zh-CN", {
    year: withYear ? "numeric" : undefined,
    month: "numeric",
    day: "numeric",
    hour: value.includes("T") ? "2-digit" : undefined,
    minute: value.includes("T") ? "2-digit" : undefined,
    hour12: false,
  }).format(date);
}

function formatClock(value) {
  if (!value) return "待首次扫描";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间待确认";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(date);
}

function formatCompactDateTime(value) {
  if (!value) return "待重新登录";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间待确认";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(date);
}

function sourceStatus(source, nowTimestamp) {
  const loginExpired = source.sourceType === "wechat"
    && source.loginExpiresAt
    && new Date(source.loginExpiresAt).getTime() <= nowTimestamp;
  if (loginExpired) return { label: "登录已到期", tone: "failing" };
  if (source.lastErrorMessage || Number(source.consecutiveFailures || 0) > 0 || source.healthStatus === "failing") {
    return { label: "上次扫描异常", tone: "failing" };
  }
  if (source.healthStatus === "degraded") return { label: "上次扫描延迟", tone: "degraded" };
  if (source.healthStatus === "healthy") return { label: "上次扫描正常", tone: "healthy" };
  if (source.healthStatus === "configured") return { label: "已配置", tone: "configured" };
  return { label: "待启用", tone: "paused" };
}

function daysUntil(value, nowTimestamp) {
  if (!value) return null;
  const end = new Date(`${String(value).slice(0, 10)}T23:59:59+08:00`).getTime();
  return Math.ceil((end - nowTimestamp) / 86_400_000);
}

function safeTimestamp(value) {
  const timestamp = new Date(value || 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function publishedTimestamp(item) {
  return safeTimestamp(item?.publishedAt) || safeTimestamp(item?.discoveredAt);
}

function isValidSiteData(value) {
  return Boolean(
    value
    && typeof value === "object"
    && value.meta
    && Array.isArray(value.items)
    && Array.isArray(value.sources),
  );
}

function useSiteData() {
  const [siteData, setSiteData] = useState(initialData);
  const [refreshState, setRefreshState] = useState({
    status: "ready",
    checkedAt: null,
    error: null,
    newItemCount: 0,
  });
  const mountedRef = useRef(true);
  const abortControllerRef = useRef(null);
  const requestSequenceRef = useRef(0);
  const knownIdsRef = useRef(new Set(initialData.items.map((item) => item.id)));

  const refreshData = useCallback(async () => {
    if (document.visibilityState === "hidden") return;
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    const requestSequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = requestSequence;
    abortControllerRef.current = controller;
    setRefreshState((current) => ({ ...current, status: "checking", error: null }));
    try {
      const dataUrl = new URL("data/policy-data.json", document.baseURI);
      dataUrl.searchParams.set("checked", String(Date.now()));
      const response = await fetch(dataUrl, {
        cache: "no-store",
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (!isValidSiteData(payload)) throw new Error("数据格式不完整");
      if (!mountedRef.current || requestSequence !== requestSequenceRef.current) return;

      const newItemCount = payload.items.reduce((count, item) => (
        item?.id && !knownIdsRef.current.has(item.id) ? count + 1 : count
      ), 0);
      payload.items.forEach((item) => {
        if (item?.id) knownIdsRef.current.add(item.id);
      });

      setSiteData(payload);
      setRefreshState((current) => ({
        status: "ready",
        checkedAt: new Date().toISOString(),
        error: null,
        newItemCount: current.newItemCount + newItemCount,
      }));
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (!mountedRef.current || requestSequence !== requestSequenceRef.current) return;
      setRefreshState((current) => ({
        ...current,
        status: "error",
        checkedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : "检查失败",
      }));
    } finally {
      if (requestSequence === requestSequenceRef.current) abortControllerRef.current = null;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    let intervalId = null;

    const stopPolling = () => {
      if (intervalId !== null) window.clearInterval(intervalId);
      intervalId = null;
    };
    const startPolling = () => {
      stopPolling();
      if (document.visibilityState === "hidden") return;
      void refreshData();
      intervalId = window.setInterval(() => void refreshData(), PAGE_REFRESH_INTERVAL_MS);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        stopPolling();
        abortControllerRef.current?.abort();
      }
      else startPolling();
    };

    startPolling();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      mountedRef.current = false;
      stopPolling();
      abortControllerRef.current?.abort();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [refreshData]);

  const dismissNewItems = useCallback(() => {
    setRefreshState((current) => ({ ...current, newItemCount: 0 }));
  }, []);

  return { siteData, refreshState, refreshData, dismissNewItems };
}

function deadlineCopy(value, lifecycleStatus, nowTimestamp) {
  if (!value && lifecycleStatus === "pending_deadline") {
    return { label: "截止时间待核验", tone: "muted" };
  }
  const days = daysUntil(value, nowTimestamp);
  if (days === null) return { label: "长期有效", tone: "calm" };
  if (days < 0) return { label: "已截止", tone: "muted" };
  if (days === 0) return { label: "今天截止", tone: "urgent" };
  if (days <= 7) return { label: `${days} 天后截止`, tone: "urgent" };
  return { label: `${formatDate(value)} 截止`, tone: "calm" };
}

function useHashRoute() {
  const read = () => window.location.hash.replace(/^#/, "") || "/";
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const onChange = () => {
      setRoute(read());
      window.scrollTo({ top: 0, behavior: "instant" });
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

function Brand() {
  return (
    <a href="#/" className="brand" aria-label="华中政策雷达首页">
      <span className="brand-mark"><i /><i /><i /></span>
      <span><b>华中政策雷达</b><small>POLICY RADAR</small></span>
    </a>
  );
}

function Header({ route, siteData }) {
  const isSources = route === "/sources";
  const wechatAccountCount = siteData.sources.filter((source) => source.sourceType === "wechat").length;
  return (
    <header className="topbar">
      <div className="wrap nav-inner">
        <Brand />
        <nav aria-label="主导航">
          <a className={!isSources ? "active" : ""} href="#/">政策库</a>
          <a className={isSources ? "active" : ""} href="#/sources">监控源</a>
          <span className="nav-status"><i /> {wechatAccountCount} 个公众号账号已接入</span>
        </nav>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <div className="wrap">
        <span>华中政策雷达 · 湖北试运行版</span>
        <span>所有事项以政府或主办方原文为最终依据</span>
      </div>
    </footer>
  );
}

function PolicyCard({ item, isLatest, nowTimestamp }) {
  const deadline = deadlineCopy(item.deadlineAt, item.lifecycleStatus, nowTimestamp);
  return (
    <article className="policy-card stream-card">
      <a className="stream-card-link" href={`#/items/${encodeURIComponent(item.id)}`} aria-label={`查看 ${item.title}`}>
        <div className="policy-card-body">
          <div className="stream-card-topline">
            <span className={isLatest ? "latest-time" : ""}>{isLatest && <i />} {formatDate(item.publishedAt)} 发布</span>
            <span>{item.publisherName}</span>
          </div>
          <div className="badge-row">
            <span className={`type-badge ${item.itemType}`}>{typeLabels[item.itemType]}</span>
            <span className="region-badge">{item.cityName || item.regionName}</span>
            <span className={`verify-badge ${item.verificationStatus}`}>
              {item.verificationStatus === "official_verified" ? "✓ " : ""}
              {verificationLabels[item.verificationStatus]}
            </span>
          </div>
          <h3 className="policy-title">{item.title}</h3>
          <p className="policy-summary">{item.summary}</p>
          {item.topics?.length > 0 && (
            <div className="topic-row">
              {item.topics.slice(0, 4).map((topic) => <span key={topic}>{topic}</span>)}
            </div>
          )}
        </div>
        <div className="policy-card-side stream-card-side">
          <span className={`deadline ${deadline.tone}`}>{deadline.label}</span>
          <span className="score"><b>{item.score}</b> 匹配度</span>
          <span className="card-read-more">查看详情 →</span>
        </div>
      </a>
    </article>
  );
}

function HomePage({ siteData, refreshState, refreshData, dismissNewItems }) {
  const items = siteData.items;
  const sources = siteData.sources;
  const [type, setType] = useState("all");
  const [verification, setVerification] = useState("all");
  const [query, setQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(FEED_BATCH_SIZE);
  const [viewTimestamp] = useState(() => Date.now());
  const loadMoreRef = useRef(null);

  const visibleItems = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items
      .filter((item) => type === "all" || item.itemType === type)
      .filter((item) => verification === "all" || item.verificationStatus === verification)
      .filter((item) => {
        if (!needle) return true;
        return [item.title, item.publisherName, item.summary, item.applicationTargets, ...(item.topics || [])]
          .filter(Boolean).join(" ").toLowerCase().includes(needle);
      })
      .sort((left, right) => (
        publishedTimestamp(right) - publishedTimestamp(left)
        || safeTimestamp(right.discoveredAt) - safeTimestamp(left.discoveredAt)
        || Number(right.score || 0) - Number(left.score || 0)
        || String(left.id).localeCompare(String(right.id))
      ));
  }, [items, query, type, verification]);

  const loadMore = useCallback(() => {
    setVisibleCount((current) => Math.min(current + FEED_BATCH_SIZE, visibleItems.length));
  }, [visibleItems.length]);
  const displayedItems = visibleItems.slice(0, visibleCount);
  const hasMore = displayedItems.length < visibleItems.length;

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || !hasMore || typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadMore();
    }, { rootMargin: "320px 0px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMore, loadMore]);

  const verifiedCount = items.filter((item) => item.verificationStatus === "official_verified").length;
  const pendingCount = items.filter((item) => item.verificationStatus === "pending_official").length;
  const urgentCount = items.filter((item) => {
    const days = daysUntil(item.deadlineAt, viewTimestamp);
    return days !== null && days >= 0 && days <= 14;
  }).length;
  const wechatSources = sources.filter((source) => source.sourceType === "wechat");
  const completedScans = wechatSources
    .map((source) => source.lastCheckedAt)
    .filter(Boolean)
    .map((value) => new Date(value).getTime())
    .filter(Number.isFinite);
  const latestCompleteScan = completedScans.length === wechatSources.length
    ? new Date(Math.min(...completedScans)).toISOString()
    : null;
  const insertedCount = wechatSources.reduce(
    (total, source) => total + Number(source.lastInsertedCount || 0),
    0,
  );
  const accountStatuses = wechatSources.map((source) => sourceStatus(source, viewTimestamp));
  const monitorStatus = accountStatuses.some((status) => status.tone === "failing")
    ? { label: "上次扫描部分异常", tone: "failing" }
    : accountStatuses.some((status) => status.tone === "degraded")
      ? { label: "上次扫描延迟", tone: "degraded" }
      : { label: "上次扫描正常", tone: "healthy" };
  const updateQuery = (event) => {
    setQuery(event.target.value);
    setVisibleCount(FEED_BATCH_SIZE);
  };
  const selectType = (value) => {
    setType(value);
    setVisibleCount(FEED_BATCH_SIZE);
  };
  const selectVerification = (value) => {
    setVerification(value);
    setVisibleCount(FEED_BATCH_SIZE);
  };
  const reset = () => {
    setType("all");
    setVerification("all");
    setQuery("");
    setVisibleCount(FEED_BATCH_SIZE);
  };
  const showNewestItems = () => {
    reset();
    dismissNewItems();
    window.requestAnimationFrame(() => {
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      document.querySelector("#policy-list .policy-card")?.scrollIntoView({
        behavior: reduceMotion ? "auto" : "smooth",
        block: "start",
      });
    });
  };

  return (
    <>
      <section className="feed-intro wrap">
        <div className="feed-intro-copy">
          <div className="eyebrow"><span /> 湖北优先 · 筛选后的政策信息流</div>
          <h1>最新政策，打开就能看</h1>
          <p>按发布时间从新到旧排列。页面每 2 分钟检查新数据，不代表采集器已产生新内容；信息采集器计划每 2 小时扫描一次来源。</p>
          <div className="feed-summary-chips" aria-label="政策概览">
            <span><b>{items.length}</b> 条收录</span>
            <span><b>{verifiedCount}</b> 条官网核验</span>
            <span><b>{pendingCount}</b> 条公众号首发</span>
            <span><b>{urgentCount}</b> 条 14 天内截止</span>
          </div>
        </div>
        <aside className={`refresh-panel refresh-${refreshState.status}`} aria-live="polite">
          <div className="refresh-panel-head">
            <span className={`monitor-dot monitor-${monitorStatus.tone}`} />
            <div>
              <small>公众号监测 · 状态快照</small>
              <strong>{wechatSources.length} 个账号 · {monitorStatus.label}</strong>
            </div>
            <button type="button" disabled={refreshState.status === "checking"} onClick={() => void refreshData()}>
              {refreshState.status === "checking" ? "检查中…" : "立即检查"}
            </button>
          </div>
          <div className="refresh-panel-grid">
            <span>数据发布 <b>{formatCompactDateTime(siteData.meta.generatedAt)}</b></span>
            <span>最近完整扫描 <b>{formatCompactDateTime(latestCompleteScan)}</b></span>
            <span>本轮新增 <b>{insertedCount} 条</b></span>
            <span>页面检查 <b>{refreshState.checkedAt ? formatClock(refreshState.checkedAt) : "待首次检查"}</b></span>
          </div>
          {refreshState.status === "error" && (
            <p className="refresh-error">页面本轮检查失败，正在继续显示上次成功数据。</p>
          )}
        </aside>
      </section>

      {refreshState.newItemCount > 0 && (
        <div className="new-items-notice" role="region" aria-label="新政策提示">
          <button type="button" className="new-items-main" onClick={showNewestItems}>
            发现 {refreshState.newItemCount} 条新信息，点击查看
          </button>
          <button type="button" className="new-items-dismiss" onClick={dismissNewItems} aria-label="关闭新信息提示">×</button>
        </div>
      )}
      <div className="persistent-status" role="status" aria-live="polite" aria-atomic="true">
        {refreshState.newItemCount > 0
          ? `发现 ${refreshState.newItemCount} 条新信息`
          : refreshState.status === "error"
            ? "页面本轮检查失败，继续显示上次成功数据"
            : refreshState.status === "checking" ? "正在检查新数据" : ""}
      </div>

      <section className="content-shell live-feed-shell wrap" id="policy-list">
        <main className="feed live-feed">
          <div className="feed-head">
            <div><span className="section-kicker">最新政策流</span><h2>与你相关的当下信息</h2></div>
            <span className="result-count">共 {visibleItems.length} 条 · 已显示 {displayedItems.length} 条</span>
          </div>
          <div className="feed-controls" aria-label="政策信息筛选">
            <label className="search-box feed-search"><span aria-hidden="true">⌕</span><input aria-label="搜索政策" value={query} onChange={updateQuery} placeholder="搜索政策、单位或关键词" /></label>
            <div className="filter-cluster type-filter">
              <span className="control-label">类型</span>
              <div className="control-tabs" aria-label="信息类型" role="group">
                {["all", "policy", "application", "event"].map((value) => (
                  <button aria-pressed={type === value} className={type === value ? "active" : ""} key={value} type="button" onClick={() => selectType(value)}>{value === "all" ? "全部" : typeLabels[value]}</button>
                ))}
              </div>
            </div>
            <div className="filter-cluster verification-filter">
              <span className="control-label">核验</span>
              <div className="control-tabs" aria-label="核验状态" role="group">
                <button aria-pressed={verification === "all"} className={verification === "all" ? "active" : ""} type="button" onClick={() => selectVerification("all")}>全部</button>
                <button aria-pressed={verification === "official_verified"} className={verification === "official_verified" ? "active" : ""} type="button" onClick={() => selectVerification("official_verified")}>官网核验</button>
                <button aria-pressed={verification === "pending_official"} className={verification === "pending_official" ? "active" : ""} type="button" onClick={() => selectVerification("pending_official")}>公众号首发</button>
              </div>
            </div>
            <label className="mobile-verification-select">
              <span>核验</span>
              <select aria-label="核验状态" value={verification} onChange={(event) => selectVerification(event.target.value)}>
                <option value="all">全部</option>
                <option value="official_verified">官网核验</option>
                <option value="pending_official">公众号首发</option>
              </select>
            </label>
            <button className="filter-reset" type="button" onClick={reset}>重置</button>
          </div>
          {visibleItems.length > 0 ? (
            <>
              <div className="policy-list">{displayedItems.map((item, index) => <PolicyCard item={item} isLatest={index === 0 && type === "all" && verification === "all" && !query} key={item.id} nowTimestamp={viewTimestamp} />)}</div>
              {hasMore && (
                <div className="load-more-shell" ref={loadMoreRef}>
                  <button type="button" onClick={loadMore}>继续加载下一批</button>
                  <span>向下滑动会自动加载</span>
                </div>
              )}
            </>
          ) : <div className="empty-state"><span>暂无匹配结果</span><p>换一个关键词，或者重置筛选条件。</p></div>}
        </main>
      </section>

      <section className="source-strip wrap">
        <div><span className="section-kicker">信息源</span><h2>公众号抢速度，官网保准确</h2></div>
        <div className="source-flow" aria-label="采集工作流"><span>公众号 / 官网</span><b>→</b><span>统一去重</span><b>→</b><span>规则筛选</span><b>→</b><strong>政策雷达</strong></div>
        <a href="#/sources">查看全部来源状态 →</a>
      </section>
    </>
  );
}

function SourcesPage({ siteData }) {
  const wechatSources = siteData.sources.filter((source) => source.sourceType === "wechat");
  const [snapshotTimestamp] = useState(() => Date.now());
  const insertedCount = wechatSources.reduce(
    (total, source) => total + Number(source.lastInsertedCount || 0),
    0,
  );
  return (
    <main className="inner-page wrap">
      <a href="#/" className="back-link">← 返回政策库</a>
      <div className="page-heading">
        <div><span className="section-kicker">Source Monitor</span><h1>监控源状态</h1></div>
        <p>以下为 {formatDate(siteData.meta.generatedAt, true)} 发布的公开状态。页面每 2 分钟检查新数据，不代表采集器已产生新内容；采集器计划每 2 小时扫描来源。</p>
      </div>
      <section className="sources-table" aria-label="政策监控源列表">
        <div className="source-row head"><span>来源</span><span>类型</span><span>最近扫描</span><span>本轮新增</span><span>登录有效期</span><span>状态</span></div>
        {siteData.sources.map((source) => {
          const status = sourceStatus(source, snapshotTimestamp);
          const isWechat = source.sourceType === "wechat";
          const loginExpired = isWechat
            && source.loginExpiresAt
            && new Date(source.loginExpiresAt).getTime() <= snapshotTimestamp;
          return (
            <div className={`source-row ${isWechat ? "wechat-source" : ""}`} key={source.id}>
              <div className="source-name"><strong>{source.name}</strong><a href={source.entryUrl} target="_blank" rel="noreferrer">{source.publisherName}</a></div>
              <span className="source-cell" data-label="类型">{isWechat ? "已核验公众号" : "政府官网"}</span>
              <span className="source-cell" data-label="最近扫描">{source.lastCheckedAt ? formatDate(source.lastCheckedAt, true) : "待首次自动运行"}</span>
              <span className="source-cell" data-label="本轮新增">{isWechat ? `${Number(source.lastInsertedCount || 0)} 篇` : "—"}</span>
              <span className="source-cell" data-label="登录有效期">{isWechat ? (loginExpired ? "已到期" : formatDate(source.loginExpiresAt, true)) : "无需登录"}</span>
              <div className="source-status" data-label="状态">
                <span className={`health-pill ${status.tone}`}>{status.label}</span>
                {source.lastErrorMessage && <small>{source.lastErrorMessage}</small>}
              </div>
            </div>
          );
        })}
      </section>
      <aside className="source-boundary-note">
        <strong>公众号状态快照</strong>
        <p>已接入 {wechatSources.length} 个已核验账号，本轮共新增 {insertedCount} 篇文章。账号扫描依赖当前电脑和已登录会话；电脑休眠、扫描程序停止或登录到期时会暂停。页面会自动检查新的公开快照，但不代表采集器正在实时扫描。</p>
      </aside>
    </main>
  );
}

function DetailPage({ id, siteData }) {
  const item = siteData.items.find((candidate) => candidate.id === id);
  if (!item) {
    return <main className="inner-page wrap"><a href="#/" className="back-link">← 返回政策库</a><div className="empty-state"><span>未找到这条政策</span></div></main>;
  }
  const sourceLabel = item.primarySourceType === "wechat" ? "打开公众号原文" : "打开官网原文";
  const sourceLinks = item.sourceLinks?.length
    ? item.sourceLinks
    : [{
        label: sourceLabel,
        url: item.primaryUrl,
        sourceType: item.primarySourceType,
        sourceName: item.primarySourceName,
      }];
  return (
    <main className="inner-page wrap">
      <a href="#/" className="back-link">← 返回政策库</a>
      <div className="detail-layout">
        <article className="detail-main">
          <div className="badge-row">
            <span className={`type-badge ${item.itemType}`}>{typeLabels[item.itemType]}</span>
            <span className="region-badge">{item.cityName || item.regionName}</span>
            <span className={`verify-badge ${item.verificationStatus}`}>{verificationLabels[item.verificationStatus]}</span>
          </div>
          <h1>{item.title}</h1>
          <p className="detail-lead">{item.summary}</p>
          <section className="detail-section"><h2>关键信息</h2><div className="detail-grid">
            <div><span>适用对象</span><strong>{item.applicationTargets || "以原文为准"}</strong></div>
            <div><span>支持内容</span><strong>{item.benefits || "以原文为准"}</strong></div>
            <div><span>发布单位</span><strong>{item.publisherName}</strong></div>
            <div><span>截止日期</span><strong>{item.deadlineAt ? formatDate(item.deadlineAt, true) : item.lifecycleStatus === "pending_deadline" ? "待核验" : "长期有效"}</strong></div>
          </div></section>
          <section className="detail-section"><h2>为什么值得看</h2><p>{item.screeningReason}</p></section>
          <section className="detail-section"><h2>来源核验</h2><p>当前记录由「{item.primarySourceName}」提供，共关联 {item.sourceCount || 1} 个来源。网站仅保留摘要和筛选结果，申报条件、材料清单及时间调整均以原文为准。</p></section>
        </article>
        <aside className="detail-side">
          <div className="detail-side-section"><span>发布时间</span><strong>{formatDate(item.publishedAt, true)}</strong></div>
          <div className="detail-side-section"><span>匹配度</span><strong>{item.score} / 100</strong></div>
          <div className="detail-side-section"><span>信息来源</span><strong>{item.primarySourceName}</strong></div>
          {item.documentNumber && <div className="detail-side-section"><span>文号</span><strong>{item.documentNumber}</strong></div>}
          <div className="source-link-list" aria-label="政策原文来源">
            {sourceLinks.map((source) => (
              <a
                className={`official-link ${source.sourceType === "wechat" ? "secondary" : ""}`}
                href={source.url}
                key={source.url}
                target="_blank"
                rel="noreferrer"
              >
                {source.label} →
              </a>
            ))}
          </div>
        </aside>
      </div>
    </main>
  );
}

function App() {
  const route = useHashRoute();
  const detailMatch = route.match(/^\/items\/([^/]+)$/);
  const { siteData, refreshState, refreshData, dismissNewItems } = useSiteData();
  useEffect(() => {
    document.title = route === "/sources" ? "监控源｜华中政策雷达" : "华中政策雷达｜最新政策、项目申报与科创赛事";
  }, [route]);
  return (
    <div className="site-shell static-pages">
      <Header route={route} siteData={siteData} />
      {route === "/sources" ? (
        <SourcesPage siteData={siteData} />
      ) : detailMatch ? (
        <DetailPage id={decodeURIComponent(detailMatch[1])} siteData={siteData} />
      ) : (
        <HomePage
          siteData={siteData}
          refreshState={refreshState}
          refreshData={refreshData}
          dismissNewItems={dismissNewItems}
        />
      )}
      <Footer />
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
