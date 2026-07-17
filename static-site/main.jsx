import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "../app/globals.css";
import "./pages.css";
import data from "./data/policy-data.json";

const typeLabels = { policy: "政策", application: "申报", event: "赛事" };
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

function daysUntil(value) {
  if (!value) return null;
  const end = new Date(`${String(value).slice(0, 10)}T23:59:59+08:00`).getTime();
  return Math.ceil((end - Date.now()) / 86_400_000);
}

function deadlineCopy(value) {
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
  return (
    <header className="topbar">
      <div className="wrap nav-inner">
        <Brand />
        <nav aria-label="主导航">
          <a className={!isSources ? "active" : ""} href="#/">政策库</a>
          <a className={isSources ? "active" : ""} href="#/sources">监控源</a>
          <span className="nav-status"><i /> 计划每 2 小时更新</span>
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
  const deadline = deadlineCopy(item.deadlineAt);
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
  const officialSourceCount = sources.filter((source) => source.sourceType === "official_site").length;
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
        <aside className="radar-card" aria-label="系统更新计划">
          <div className="radar-card-top">
            <div><span className="panel-kicker">当前范围</span><strong>{officialSourceCount} 个政府官网源已配置</strong></div>
            <span className="live-dot">试运行</span>
          </div>
          <div className="radar-visual" aria-hidden="true">
            <span className="radar-ring ring-one" /><span className="radar-ring ring-two" /><span className="radar-ring ring-three" />
            <span className="radar-sweep" /><span className="radar-point point-one" /><span className="radar-point point-two" /><span className="radar-point point-three" />
            <span className="radar-core">鄂</span>
          </div>
          <div className="radar-legend">
            <span><i className="official" /> 官网核验</span>
            <span><i className="wechat" /> 公众号发现</span>
            <span>数据更新 <b>{formatDate(data.meta.generatedAt)}</b></span>
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
  const statusLabels = { healthy: "可用", configured: "已配置", degraded: "延迟", failing: "异常", paused: "待启用" };
  return (
    <main className="inner-page wrap">
      <a href="#/" className="back-link">← 返回政策库</a>
      <div className="page-heading">
        <div><span className="section-kicker">Source Monitor</span><h1>监控源状态</h1></div>
        <p>第一阶段以湖北省与武汉市高价值信息源为主。每个来源显示真实配置和最近运行状态，不把“计划扫描”冒充为“已采集”。</p>
      </div>
      <section className="sources-table" aria-label="政策监控源列表">
        <div className="source-row head"><span>来源</span><span>类型</span><span>扫描计划</span><span>最近成功</span><span>状态</span></div>
        {data.sources.map((source) => (
          <div className="source-row" key={source.id}>
            <div className="source-name"><strong>{source.name}</strong><a href={source.entryUrl} target="_blank" rel="noreferrer">{source.publisherName}</a></div>
            <span>{source.sourceType === "wechat" ? "微信公众号" : "政府官网"}</span>
            <span>每 {source.pollIntervalMinutes / 60} 小时</span>
            <span>{source.lastSuccessAt ? formatDate(source.lastSuccessAt, true) : "待首次自动运行"}</span>
            <span className={`health-pill ${source.healthStatus}`}>{statusLabels[source.healthStatus] || "待确认"}</span>
          </div>
        ))}
      </section>
      <aside className="source-boundary-note">
        <strong>公众号扫描边界</strong>
        <p>账号级同步依赖用户扫码后的浏览器会话。页面关闭、电脑休眠或登录到期时会暂停；政府官网定时扫描不受影响。</p>
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
            <div><span>截止日期</span><strong>{item.deadlineAt ? formatDate(item.deadlineAt, true) : "长期有效"}</strong></div>
          </div></section>
          <section className="detail-section"><h2>为什么值得看</h2><p>{item.screeningReason}</p></section>
          <section className="detail-section"><h2>来源核验</h2><p>当前记录由「{item.primarySourceName}」提供，共关联 {item.sourceCount || 1} 个来源。网站仅保留摘要和筛选结果，申报条件、材料清单及时间调整均以原文为准。</p></section>
        </article>
        <aside className="detail-side">
          <div className="detail-side-section"><span>发布时间</span><strong>{formatDate(item.publishedAt, true)}</strong></div>
          <div className="detail-side-section"><span>匹配度</span><strong>{item.score} / 100</strong></div>
          <div className="detail-side-section"><span>信息来源</span><strong>{item.primarySourceName}</strong></div>
          {item.documentNumber && <div className="detail-side-section"><span>文号</span><strong>{item.documentNumber}</strong></div>}
          <a className="official-link" href={item.primaryUrl} target="_blank" rel="noreferrer">{sourceLabel} →</a>
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
