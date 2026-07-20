import type { Metadata } from "next";
import Link from "next/link";
import PolicyDashboard from "./components/PolicyDashboard";
import { getPolicyItems, getPolicySources } from "@/lib/policy-data";

export const metadata: Metadata = {
  title: "华中政策雷达｜湖北政策、申报与科创赛事",
  description: "公众号优先发现，政府官网权威核验。聚合湖北政策、项目申报和科创赛事。",
};

export const dynamic = "force-dynamic";

export default async function Home() {
  const [items, sources] = await Promise.all([
    getPolicyItems(),
    getPolicySources(),
  ]);

  return (
    <div className="site-shell">
      <header className="topbar">
        <div className="wrap nav-inner">
          <Link href="/" className="brand" aria-label="华中政策雷达首页">
            <span className="brand-mark"><i /><i /><i /></span>
            <span><b>华中政策雷达</b><small>POLICY RADAR</small></span>
          </Link>
          <nav aria-label="主导航">
            <a className="active" href="#policy-list">政策库</a>
            <a href="/sources">监控源</a>
            <span className="nav-status"><i /> 页面自动检查更新</span>
          </nav>
        </div>
      </header>

      <PolicyDashboard initialItems={items} sources={sources} />

      <footer className="footer">
        <div className="wrap">
          <span>华中政策雷达 · 湖北试运行版</span>
          <span>所有事项以政府官网原文为最终依据</span>
        </div>
      </footer>
    </div>
  );
}
