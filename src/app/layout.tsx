import type { Metadata, Viewport } from "next";
import "./globals.css";
import 'katex/dist/katex.min.css';

export const metadata: Metadata = {
  title: "AI互动课堂",
  description: "局域网AI互动教学工具",
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
      <body>{children}</body>
    </html>
  );
}
