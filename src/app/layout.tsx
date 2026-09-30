import type { Metadata, Viewport } from "next";
import "./globals.css";
import 'katex/dist/katex.min.css';
import { OverscrollGuard } from "@/components/overscroll-guard";

export const metadata: Metadata = {
  title: "支点课堂｜ClassNode",
  description: "连接学习单、探究空间与智能学伴的课堂互动工具",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>
        {children}
        {/* 浮层里的滚轮守卫（见 `@/lib/overscroll-guard`）。全局只装一个，什么都不渲染。 */}
        <OverscrollGuard />
      </body>
    </html>
  );
}
