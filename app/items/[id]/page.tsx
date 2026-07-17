import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPolicyItem } from "@/lib/policy-data";
import { formatDate } from "@/lib/policy-types";

export const dynamic = "force-dynamic";

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const item = await getPolicyItem(id);
  return {
    title: item ? `${item.title}｜华中政策雷达` : "政策详情｜华中政策雷达",
    description: item?.summary ?? "湖北政策、项目申报与科创赛事详情。",
  };
}

export default async function PolicyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const item = await getPolicyItem(id);
  if (!item) notFound();

  const typeLabel = {
    policy: "政策",
    application: "申报",
    event: "赛事",
  }[item.itemType];

  return (
    <div className="site-shell">
      <header className="topbar">
        <div className="wrap nav-inner">
          <Link href="/" className="brand">
            <span className="brand-mark"><i /><i /><i /></span>
            <span><b>华中政策雷达</b><small>POLICY RADAR</small></span>
          </Link>
          <nav><Link href="/">政策库</Link><Link href="/sources">监控源</Link><span className="nav-status"><i /> 系统运行中</span></nav>
        </div>
      </header>

      <main className="inner-page wrap">
        <Link href="/" className="back-link"><ArrowIcon /> 返回政策库</Link>
        <div className="detail-layout">
          <article className="detail-main">
            <div className="badge-row">
              <span className={`type-badge ${item.itemType}`}>{typeLabel}</span>
              <span className="region-badge">{item.cityName ?? item.regionName}</span>
              <span className={`verify-badge ${item.verificationStatus}`}>
                {item.verificationStatus === "official_verified" ? "官网已核验" : "待官网核验"}
              </span>
            </div>
            <h1>{item.title}</h1>
            <p className="detail-lead">{item.summary}</p>

            <section className="detail-section">
              <h2>关键信息</h2>
              <div className="detail-grid">
                <div><span>适用对象</span><strong>{item.applicationTargets ?? "以官网申报指南为准"}</strong></div>
                <div><span>支持内容</span><strong>{item.benefits ?? "以官网原文为准"}</strong></div>
                <div><span>发布单位</span><strong>{item.publisherName}</strong></div>
                <div><span>截止日期</span><strong>{item.deadlineAt ? item.deadlineAt.slice(0, 16).replace("T", " ") : "长期有效"}</strong></div>
              </div>
            </section>

            <section className="detail-section">
              <h2>为什么值得看</h2>
              <p>{item.screeningReason}</p>
            </section>

            <section className="detail-section">
              <h2>来源核验</h2>
              <p>
                当前记录由「{item.primarySourceName}」提供，共关联 {item.sourceCount} 个来源。
                网站保留摘要和筛选结果，申报条件、材料清单及时间调整均以政府官网原文为准。
              </p>
            </section>
          </article>

          <aside className="detail-side">
            <div className="detail-side-section"><span>发布时间</span><strong>{formatDate(item.publishedAt)}</strong></div>
            <div className="detail-side-section"><span>匹配度</span><strong>{item.score} / 100</strong></div>
            <div className="detail-side-section"><span>信息来源</span><strong>{item.primarySourceName}</strong></div>
            {item.documentNumber && <div className="detail-side-section"><span>文号</span><strong>{item.documentNumber}</strong></div>}
            <a className="official-link" href={item.primaryUrl} target="_blank" rel="noreferrer">打开官网原文 <ArrowIcon /></a>
          </aside>
        </div>
      </main>
    </div>
  );
}
