"use client";

import type { MarqueeBox } from "@/lib/materialGridMarquee";

export function MaterialGridMarqueeOverlay({ box }: { box: MarqueeBox | null }) {
  if (!box) return null;
  return (
    <div
      className="pointer-events-none fixed z-[5000] border border-sky-400 bg-sky-500/20"
      style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
    />
  );
}
