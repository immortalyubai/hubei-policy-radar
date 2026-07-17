import Link from "next/link";
import { getPolicySources } from "@/lib/policy-data";

export const dynamic = "force-dynamic";

function ArrowIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>;
}

const sourceTypeLabels = {
  official_site: "政府官网",
  wechat: "微信公众号",
  rss: "RSS",
  manual: "人工导入",
};

const healthLabels = {
  healthy: "最近正常",
  degraded: "有延迟",
  failing: "异常",
  paused: "待扫码",
};

function formatTimestamp(value: string | null | undefined) {
  if (!value) return "待首次运行";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}

export default async function SourcesPage() {
  const sources = await getPolicySources();

  return (
    <div className="site-shell">
      <header className="topbar">
        <div className="wrap nav-inner">
          <Link href="/" className="brand"><span className="brand-mark"><i /><i /><i /></span><span><b>华中政策雷达</b><small>POLICY RADAR</small></span></Link>
          <nav><Link href="/">政策库</Link><Link className="active" href="/sources">监控源</Link><span className="nav-status"><i /> 查看监控状态</span></nav>
        </div>
      </header>

      <main className="inner-page wrap">
        <Link href="/" className="back-link"><ArrowIcon /> 返回政策库</Link>
        <div className="page-heading">
          <div><span className="section-kicker">Source Monitor</span><h1>监控源状态</h1></div>
          <p>湖北与武汉高价值来源优先。公众号账号已完成管理员授权，本机每两小时扫描一次；本页展示最近一次同步快照，政府官网继续负责最终核验。</p>
        </div>

        <section className="sources-table" aria-label="政策监控源列表">
          <div className="source-row head"><span>来源</span><span>类型</span><span>最近扫描</span><span>本轮发现</span><span>登录有效期</span><span>状态</span></div>
          {sources.map((source) => (
            <div className="source-row" key={source.id}>
              <div className="source-name"><strong>{source.name}</strong><a href={source.entryUrl} target="_blank" rel="noreferrer">{source.publisherName}</a></div>
              <span data-label="类型">{sourceTypeLabels[source.sourceType]}</span>
              <span data-label="最近扫描">{formatTimestamp(source.lastCheckedAt)}<small>{source.pollIntervalMinutes >= 1440 ? "每天" : `每 ${source.pollIntervalMinutes / 60} 小时`}</small></span>
              <span data-label="本轮发现">{source.sourceType === "wechat" ? `${source.lastInsertedCount ?? 0} 篇` : "—"}</span>
              <span data-label="登录有效期">{source.sourceType === "wechat" ? formatTimestamp(source.loginExpiresAt) : "不需要"}</span>
              <span data-label="状态" className={`health-pill ${source.healthStatus}`}>{healthLabels[source.healthStatus]}</span>
            </div>
          ))}
        </section>
        <p className="source-boundary-note">公众号状态是最近一次安全快照。电脑休眠或管理员登录到期时扫描会暂停，页面不会把计划任务冒充为已运行。</p>
      </main>
    </div>
  );
}
