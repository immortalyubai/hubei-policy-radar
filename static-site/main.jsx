import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "../app/globals.css";
import "./pages.css";
import data from "./data/policy-data.json";

const typeLabels = { policy: "政策", application: "申报", event: "赛事" };
const snapshotTimestamp = new Date(data.meta.generatedAt).getTime();
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

function sourceStatus(source) {
  const loginExpired = source.sourceType === "wechat"
    && source.loginExpiresAt
    && new Date(source.loginExpiresAt).getTime() <= snapshotTimestamp;
  if (loginExpired) return { label: "登录已到期", tone: "failing" };
  if (source.lastErrorMessage || Number(source.consecutiveFailures || 0) > 0 || source.healthStatus === "failing") {
    return { label: "扫描异常", tone: "failing" };
  }
  if (source.healthStatus === "degraded") return { label: "扫描延迟", tone: "degraded" };
  if (source.healthStatus === "healthy") return { label: "运行正常", tone: "healthy" };
  if (source.healthStatus === "configured") return { label: "已配置", tone: "configured" };
  return { label: "待启用", tone: "paused" };
}

function daysUntil(value) {
  if (!value) return null;
  const end = new Date(`${String(value).slice(0, 10)}T23:59:59+08:00`).getTime();
  return Math.ceil((end - snapshotTimestamp) / 86_400_000);
}

function deadlineCopy(value, lifecycleStatus) {
  if (!value && lifecycleStatus === "pending_deadline") {
    return { label: "截止时间待核验", tone: "muted" };
  }
  const days = daysUntil(value);
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

function Header({ route }) {
  const isSources = route === "/sources";
  const wechatAccountCount = data.sources.filter((source) => source.sourceType === "wechat").length;
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

function PolicyCard({ item }) {
  const deadline = deadlineCopy(item.deadlineAt, item.lifecycleStatus);
  return (
    <article className="policy-card">
      <div className="policy-card-body">
        <div className="badge-row">
          <span className={`type-badge ${item.itemType}`}>{typeLabels[item.itemType]}</span>
          <span className="region-badge">{item.cityName || item.regionName}</span>
          <span className={`verify-badge ${item.verificationStatus}`}>
            {item.verificationStatus === "official_verified" ? "✓ " : ""}
            {verificationLabels[item.verificationStatus]}
          </span>
        </div>
        <a href={`#/items/${encodeURIComponent(item.id)}`} className="policy-title">{item.title}</a>
        <p className="policy-summary">{item.summary}</p>
        {item.topics?.length > 0 && (
          <div className="topic-row">
            {item.topics.slice(0, 4).map((topic) => <span key={topic}>{topic}</span>)}
          </div>
        )}
        <div className="policy-meta">
          <span>{item.publisherName}</span><i />
          <span>{formatDate(item.publishedAt)} 发布</span><i />
          <span>{item.sourceCount || 1} 个来源</span>
        </div>
      </div>
      <div className="policy-card-side">
        <span className={`deadline ${deadline.tone}`}>{deadline.label}</span>
        <span className="score"><b>{item.score}</b> 匹配度</span>
        <a className="card-arrow" href={`#/items/${encodeURIComponent(item.id)}`} aria-label={`查看 ${item.title}`}>→</a>
      </div>
    </article>
  );
}

function HomePage() {
  const items = data.items;
  const sources = data.sources;
  const [type, setType] = useState("all");
  const [verification, setVerification] = useState("all");
  const [query, setQuery] = useState("");

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
      .sort((left, right) => {
        const leftClosed = daysUntil(left.deadlineAt) < 0;
        const rightClosed = daysUntil(right.deadlineAt) < 0;
        return Number(leftClosed) - Number(rightClosed) || right.score - left.score;
      });
  }, [items, query, type, verification]);

  const verifiedCount = items.filter((item) => item.verificationStatus === "official_verified").length;
  const pendingCount = items.filter((item) => item.verificationStatus === "pending_official").length;
  const urgentCount = items.filter((item) => {
    const days = daysUntil(item.deadlineAt);
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
  const loginExpiry = wechatSources
    .map((source) => source.loginExpiresAt)
    .filter(Boolean)
    .sort()[0] || null;
  const accountStatuses = wechatSources.map(sourceStatus);
  const monitorStatus = accountStatuses.some((status) => status.tone === "failing")
    ? { label: "部分异常", tone: "failing" }
    : accountStatuses.some((status) => status.tone === "degraded")
      ? { label: "扫描延迟", tone: "degraded" }
      : { label: "运行正常", tone: "healthy" };
  const reset = () => { setType("all"); setVerification("all"); setQuery(""); };

  return (
    <>
      <section className="hero wrap">
        <div className="hero-copy">
          <div className="eyebrow"><span /> 湖北优先 · 计划每 2 小时扫描</div>
          <h1>每天，只看值得<br />跟进的政策</h1>
          <p>公众号负责优先发现，政府官网负责权威核验。政策、申报和科创赛事统一筛选、去重，再送到你面前。</p>
          <div className="hero-actions">
            <a href="#policy-list" className="primary-action">查看政策清单 <span>→</span></a>
            <a href="#/sources" className="secondary-action">查看监控源</a>
          </div>
        </div>
        <aside className="radar-card" aria-label="公众号扫描状态快照">
          <div className="radar-card-top">
            <div><span className="panel-kicker">公众号监测 · 状态快照</span><strong>{wechatSources.length} 个账号运行中</strong></div>
            <span className={`live-dot monitor-${monitorStatus.tone}`}>{monitorStatus.label}</span>
          </div>
          <div className="radar-visual" aria-hidden="true">
            <span className="radar-ring ring-one" /><span className="radar-ring ring-two" /><span className="radar-ring ring-three" />
            <span className="radar-sweep" /><span className="radar-point point-one" /><span className="radar-point point-two" /><span className="radar-point point-three" />
            <span className="radar-core">鄂</span>
          </div>
          <div className="radar-legend monitor-legend">
            <span>最近完整扫描 <b>{formatClock(latestCompleteScan)}</b></span>
            <span>本轮命中 / 新增 <b>{insertedCount} / {insertedCount}</b></span>
            <span>登录有效期 <b>{formatCompactDateTime(loginExpiry)}</b></span>
          </div>
        </aside>
      </section>

      <section className="metrics wrap" aria-label="政策概览">
        <article><span>当前收录</span><strong>{items.length}</strong><small>条湖北重点信息</small></article>
        <article><span>官网已核验</span><strong>{verifiedCount}</strong><small>✓ 可直接查看原文</small></article>
        <article><span>待官网核验</span><strong>{pendingCount}</strong><small>公众号优先发现</small></article>
        <article><span>14 天内截止</span><strong>{urgentCount}</strong><small>建议优先处理</small></article>
      </section>

      <section className="content-shell wrap" id="policy-list">
        <aside className="filter-panel">
          <div className="filter-heading"><span>筛选政策</span><button type="button" onClick={reset}>重置</button></div>
          <label className="search-box"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、单位或关键词" /></label>
          <div className="filter-group">
            <span className="filter-label">信息类型</span>
            <div className="filter-options">
              {["all", "policy", "application", "event"].map((value) => (
                <button className={type === value ? "active" : ""} key={value} type="button" onClick={() => setType(value)}>
                  {value === "all" ? "全部" : typeLabels[value]}
                  <em>{value === "all" ? items.length : items.filter((item) => item.itemType === value).length}</em>
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
          <div className="scope-note"><span>当前监控范围</span><strong>湖北省 · 武汉市优先</strong><p>下一阶段扩展河南、湖南、安徽、江西。</p></div>
        </aside>

        <main className="feed">
          <div className="feed-head"><div><span className="section-kicker">政策流</span><h2>与你相关的重点信息</h2></div><span className="result-count">找到 {visibleItems.length} 条</span></div>
          <div className="mobile-search">
            <label className="search-box"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索政策、单位或关键词" /></label>
            <div className="mobile-verify-tabs">
              <button className={verification === "all" ? "active" : ""} onClick={() => setVerification("all")}>全部</button>
              <button className={verification === "official_verified" ? "active" : ""} onClick={() => setVerification("official_verified")}>官网核验</button>
              <button className={verification === "pending_official" ? "active" : ""} onClick={() => setVerification("pending_official")}>公众号首发</button>
            </div>
          </div>
          <div className="mobile-type-tabs" aria-label="信息类型筛选">
            {["all", "policy", "application", "event"].map((value) => (
              <button className={type === value ? "active" : ""} key={value} type="button" onClick={() => setType(value)}>{value === "all" ? "全部" : typeLabels[value]}</button>
            ))}
          </div>
          {visibleItems.length > 0 ? <div className="policy-list">{visibleItems.map((item) => <PolicyCard item={item} key={item.id} />)}</div> : <div className="empty-state"><span>暂无匹配结果</span><p>换一个关键词，或者重置筛选条件。</p></div>}
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

function SourcesPage() {
  const wechatSources = data.sources.filter((source) => source.sourceType === "wechat");
  const insertedCount = wechatSources.reduce(
    (total, source) => total + Number(source.lastInsertedCount || 0),
    0,
  );
  return (
    <main className="inner-page wrap">
      <a href="#/" className="back-link">← 返回政策库</a>
      <div className="page-heading">
        <div><span className="section-kicker">Source Monitor</span><h1>监控源状态</h1></div>
        <p>以下为 {formatDate(data.meta.generatedAt, true)} 生成的公开状态快照，展示真实扫描时间、文章数和登录有效期。</p>
      </div>
      <section className="sources-table" aria-label="政策监控源列表">
        <div className="source-row head"><span>来源</span><span>类型</span><span>最近扫描</span><span>本轮新增</span><span>登录有效期</span><span>状态</span></div>
        {data.sources.map((source) => {
          const status = sourceStatus(source);
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
        <p>首次扫描已接入 {wechatSources.length} 个已核验账号，本轮共新增 {insertedCount} 篇文章。账号扫描依赖当前电脑和已登录会话；电脑休眠、扫描程序停止或登录到期时会暂停。本页是生成时的状态快照，不会在页面打开期间自动变化。</p>
      </aside>
    </main>
  );
}

function DetailPage({ id }) {
  const item = data.items.find((candidate) => candidate.id === id);
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
  useEffect(() => {
    document.title = route === "/sources" ? "监控源｜华中政策雷达" : "华中政策雷达｜湖北政策、申报与科创赛事";
  }, [route]);
  return (
    <div className="site-shell static-pages">
      <Header route={route} />
      {route === "/sources" ? <SourcesPage /> : detailMatch ? <DetailPage id={decodeURIComponent(detailMatch[1])} /> : <HomePage />}
      <Footer />
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
