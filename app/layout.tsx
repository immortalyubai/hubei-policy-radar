import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "华中政策雷达",
  description: "湖北政策、项目申报与科创赛事的实时筛选和核验平台。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  openGraph: {
    title: "华中政策雷达",
    description: "公众号优先发现，政府官网权威核验。",
    type: "website",
    images: [
      {
        url: "/og.png",
        width: 1731,
        height: 909,
        alt: "华中政策雷达",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "华中政策雷达",
    description: "公众号优先发现，政府官网权威核验。",
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
