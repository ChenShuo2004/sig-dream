"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

import AppHeader from "@/components/AppHeader";
import { AssetLibraryProvider } from "@/lib/assetLibrary";

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const hidePlatformHeader = pathname === "/canvas" || pathname.startsWith("/canvas/");

  return (
    <AssetLibraryProvider>
      {hidePlatformHeader ? null : <AppHeader />}
      {children}
    </AssetLibraryProvider>
  );
}
