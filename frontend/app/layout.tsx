import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import AppShell from "@/components/AppShell";

export const metadata: Metadata = {
  title: "轻量内容流程平台",
  icons: {
    icon: [
      { url: "/favicon.ico" },
      { url: "/favicon-48.png", sizes: "48x48", type: "image/png" },
      { url: "/brand/youwendu-mark.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen text-slate-100 antialiased">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
