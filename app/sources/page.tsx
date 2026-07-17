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

export default async function SourcesPage() {
  const sources = await getPolicySources();

  return (
    <div className="site-shell">
      <header className="topbar">
        <div className="wrap nav-inner">
          <Link href="/" className="brand"><span className="brand-mark"><i /><i /><i /></span><span><b>华中政策雷达</b><small>POLICY RADAR</small></span></Link>
          <nav><Link href="/">政策库</Link><Link className="active" href="/sources">监控源</Link><span className="nav-status"><i /> 系统运行中</span></nav>
        </div>
      </header>

      <main className="inner-page wrap">
        <Link href="/" className="back-link"><ArrowIcon /> 返回政策库</Link>
        <div className="page-heading">
          <div><span className="section-kicker">Source Monitor</span><h1>监控源状态</h1></div>
          <p>第一阶段以湖北省与武汉市高价值信息源为主。公众号白名单将在首次扫码授权后启用账号级定时扫描。</p>
        </div>

        <section className="sources-table" aria-label="政策监控源列表">
          <div className="source-row head"><span>来源</span><span>类型</span><span>扫描频率</span><span>最近成功</span><span>状态</span></div>
          {sources.map((source) => (
            <div className="source-row" key={source.id}>
              <div className="source-name"><strong>{source.name}</strong><a href={source.entryUrl} target="_blank" rel="noreferrer">{source.publisherName}</a></div>
              <span>{sourceTypeLabels[source.sourceType]}</span>
              <span>{source.pollIntervalMinutes >= 1440 ? "每天" : `每 ${source.pollIntervalMinutes / 60} 小时`}</span>
              <span>{source.lastSuccessAt ? source.lastSuccessAt.slice(0, 16).replace("T", " ") : "待首次运行"}</span>
              <span className={`health-pill ${source.healthStatus}`}>{source.healthStatus === "healthy" ? "可用" : source.healthStatus === "paused" ? "待启用" : "异常"}</span>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}
