/** 素材卡片网格框选：与 `MaterialFileCard` 的 `data-material-card` / `data-material-id` 配合 */

export const MATERIAL_CARD_SELECTOR = "[data-material-card][data-material-id]";

export type MarqueeDrag = { x1: number; y1: number; x2: number; y2: number };

export type MarqueeBox = { left: number; top: number; width: number; height: number };

export function normalizeMarqueeClientRect(m: MarqueeDrag) {
  const left = Math.min(m.x1, m.x2);
  const top = Math.min(m.y1, m.y2);
  const right = Math.max(m.x1, m.x2);
  const bottom = Math.max(m.y1, m.y2);
  return { left, top, right, bottom };
}

export function clientRectIntersects(
  a: { left: number; top: number; right: number; bottom: number },
  b: Pick<DOMRect, "left" | "top" | "right" | "bottom">
) {
  return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
}

/** 在指定容器内收集与框选矩形相交的卡片 id */
export function collectMarqueeHitIds(gridRoot: HTMLElement | null, drag: MarqueeDrag): string[] {
  if (!gridRoot) return [];
  const sel = normalizeMarqueeClientRect(drag);
  const hitIds: string[] = [];
  gridRoot.querySelectorAll<HTMLElement>(MATERIAL_CARD_SELECTOR).forEach((el) => {
    const id = el.getAttribute("data-material-id");
    if (!id) return;
    if (clientRectIntersects(sel, el.getBoundingClientRect())) hitIds.push(id);
  });
  return hitIds;
}
