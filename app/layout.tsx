import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "华中政策雷达｜最新政策、项目申报与科创赛事",
  description: "湖北优先的最新政策信息流，持续筛选政策、项目申报与科创赛事。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  openGraph: {
    title: "华中政策雷达｜最新政策，打开就能看",
    description: "公众号优先发现，政府官网权威核验，最新筛选结果直接进入信息流。",
    type: "website",
    images: [
      {
        url: "/og.png",
        width: 1731,
        height: 909,
        alt: "华中政策雷达最新政策信息流",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "华中政策雷达｜最新政策，打开就能看",
    description: "湖北优先的政策、申报与科创赛事筛选信息流。",
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
