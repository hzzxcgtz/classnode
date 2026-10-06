import type { Metadata, Viewport } from "next";
import "./globals.css";
import 'katex/dist/katex.min.css';
import { OverscrollGuard } from "@/components/overscroll-guard";
import { BrowserCompatShims } from "@/components/browser-compat-shims";

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
        {/* 老 iPad 的 API 兜底（`structuredClone` 等，见 `@/components/browser-compat-shims`）。
            ⚠️ 位置有意放在最外层：绘图画板全是懒加载的，兜底必须先于它们跑完。 */}
        <BrowserCompatShims />
      </body>
    </html>
  );
}
