"use client";

import { driver, type Config, type DriveStep, type Side } from "driver.js";
import "driver.js/dist/driver.css";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { loadAuthSession } from "@/lib/auth";
import {
  completeTutorialProgress,
  startTutorialProgress,
  updateTutorialProgress,
} from "@/lib/tutorialProgressApi";
import { getTutorialByKey, type TutorialKey, type TutorialStep } from "@/lib/tutorials";

type TutorialJoyrideProps = {
  pageTutorialKey: TutorialKey;
  activeTutorial: string | null;
  alsoRespondTo?: TutorialKey[];
};

function toDriverSide(placement: string | undefined): Side {
  if (placement === "top" || placement === "bottom" || placement === "left" || placement === "right") return placement;
  return "bottom";
}

/** driver 只在高亮节点上“开孔”；高亮仅按钮时同表单内输入框会被遮罩挡住。表单高亮 + 仅提交点击前进。 */
function shouldAdvanceOnTargetClick(element: Element, ev: MouseEvent): boolean {
  const raw = ev.target;
  if (!(raw instanceof Element)) return false;
  if (element instanceof HTMLFormElement) {
    const submitter = raw.closest('button[type="submit"],input[type="submit"]');
    return Boolean(submitter && element.contains(submitter));
  }
  return true;
}

function resolveTutorialKey(
  activeTutorial: string | null,
  pageTutorialKey: TutorialKey,
  alsoRespondTo: TutorialKey[] | undefined
): TutorialKey | null {
  if (!activeTutorial) return null;
  const allowed: TutorialKey[] = [pageTutorialKey, ...(alsoRespondTo ?? [])];
  return allowed.includes(activeTutorial as TutorialKey) ? (activeTutorial as TutorialKey) : null;
}

export default function TutorialJoyride({ pageTutorialKey, activeTutorial, alsoRespondTo }: TutorialJoyrideProps) {
  const pathname = usePathname();
  const [isMobile, setIsMobile] = useState(() => (typeof window !== "undefined" ? window.innerWidth < 768 : false));
  const driverRef = useRef<ReturnType<typeof driver> | null>(null);
  const stepMetaRef = useRef<TutorialStep[]>([]);
  const highlightCleanupRef = useRef<(() => void) | null>(null);

  const tutorialKey = useMemo(
    () => resolveTutorialKey(activeTutorial, pageTutorialKey, alsoRespondTo),
    [activeTutorial, pageTutorialKey, alsoRespondTo]
  );

  const config = useMemo(() => (tutorialKey ? getTutorialByKey(tutorialKey) : undefined), [tutorialKey]);

  const filteredSteps = useMemo(() => {
    if (!config) return [];
    return config.steps.filter((s) => !s.routePrefix || pathname.startsWith(s.routePrefix));
  }, [config, pathname]);

  const filteredFingerprint = useMemo(
    () => filteredSteps.map((s) => `${s.target}|${s.title}|${s.routePrefix ?? ""}`).join(";;"),
    [filteredSteps]
  );

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (!tutorialKey || !config || !isMobile) return;
    const session = loadAuthSession();
    if (!session?.access_token) return;
    void startTutorialProgress(session.access_token, tutorialKey).catch(() => {});
  }, [tutorialKey, config, isMobile]);

  useEffect(() => {
    highlightCleanupRef.current?.();
    highlightCleanupRef.current = null;

    if (!tutorialKey || !config) {
      driverRef.current?.destroy();
      driverRef.current = null;
      return;
    }
    if (isMobile) return;
    if (filteredSteps.length === 0) {
      driverRef.current?.destroy();
      driverRef.current = null;
      return;
    }

    const session = loadAuthSession();
    if (!session?.access_token) return;

    let cancelled = false;
    stepMetaRef.current = filteredSteps;

    const patchProgress = (idx: number) => {
      void updateTutorialProgress(session.access_token, tutorialKey, idx + 1).catch(() => {});
    };

    const buildDriveSteps = (): DriveStep[] =>
      filteredSteps.map((s) => {
        const hideNext = Boolean(s.advanceOnTargetClick || s.waitForCollectSuccess);
        return {
          element: s.target,
          popover: {
            title: s.title,
            description: s.content,
            side: toDriverSide(s.placement),
            ...(hideNext
              ? {
                  showButtons: ["previous", "close"] as const,
                  disableButtons: ["next"] as const,
                }
              : {}),
          },
        };
      });

    const driverConfig: Config = {
      showProgress: true,
      smoothScroll: true,
      allowClose: true,
      overlayOpacity: 0.78,
      stageRadius: 8,
      prevBtnText: "上一步",
      nextBtnText: "下一步",
      doneBtnText: "完成",
      steps: buildDriveSteps(),
      onHighlighted: (element) => {
        highlightCleanupRef.current?.();
        highlightCleanupRef.current = null;
        const drv = driverRef.current;
        if (!drv) return;
        const idx = drv.getActiveIndex() ?? 0;
        const meta = stepMetaRef.current[idx];
        if (!meta) return;

        if (meta.advanceOnTargetClick && element) {
          const onClick = (ev: Event) => {
            if (!(ev instanceof MouseEvent)) return;
            if (!shouldAdvanceOnTargetClick(element, ev)) return;
            const d = driverRef.current;
            if (!d) return;
            patchProgress(idx);
            if (!d.hasNextStep()) {
              void completeTutorialProgress(session.access_token, tutorialKey).catch(() => {});
              d.destroy();
            } else {
              d.moveNext();
            }
          };
          element.addEventListener("click", onClick, { capture: true });
          highlightCleanupRef.current = () => element.removeEventListener("click", onClick, { capture: true });
        }

        if (meta.waitForCollectSuccess) {
          const onDone = () => {
            window.removeEventListener("lcp-tutorial-collect-done", onDone);
            const d = driverRef.current;
            if (!d) return;
            patchProgress(idx);
            if (!d.hasNextStep()) {
              void completeTutorialProgress(session.access_token, tutorialKey).catch(() => {});
              d.destroy();
            } else {
              d.moveNext();
            }
          };
          window.addEventListener("lcp-tutorial-collect-done", onDone);
          highlightCleanupRef.current = () => window.removeEventListener("lcp-tutorial-collect-done", onDone);
        }
      },
      onNextClick: (_element, _step, { driver: drv }) => {
        const idx = drv.getActiveIndex() ?? 0;
        const meta = stepMetaRef.current[idx];
        if (meta?.nextRoute) {
          patchProgress(idx);
          drv.destroy();
          window.location.assign(meta.nextRoute);
          return;
        }
        patchProgress(idx);
        if (!drv.hasNextStep()) {
          void completeTutorialProgress(session.access_token, tutorialKey).catch(() => {});
          drv.destroy();
        } else {
          drv.moveNext();
        }
      },
      onPrevClick: (_element, _step, { driver: drv }) => {
        drv.movePrevious();
      },
      onCloseClick: (_element, _step, { driver: drv }) => {
        const idx = drv.getActiveIndex() ?? 0;
        patchProgress(idx);
        drv.destroy();
        driverRef.current = null;
      },
    };

    void (async () => {
      try {
        await startTutorialProgress(session.access_token, tutorialKey);
      } catch {
        /* 无进度 API 时仍允许引导 */
      }
      if (cancelled) return;
      driverRef.current?.destroy();
      const drv = driver(driverConfig);
      driverRef.current = drv;
      requestAnimationFrame(() => {
        if (!cancelled) drv.drive(0);
      });
    })();

    return () => {
      cancelled = true;
      highlightCleanupRef.current?.();
      highlightCleanupRef.current = null;
      driverRef.current?.destroy();
      driverRef.current = null;
    };
  }, [tutorialKey, config, filteredFingerprint, isMobile, pathname, activeTutorial]);

  if (!config || tutorialKey === null) return null;

  if (isMobile) {
    return (
      <MobileTutorialPanel
        config={config}
        filteredSteps={filteredSteps}
        progressTutorialKey={tutorialKey}
        onComplete={() => {
          const session = loadAuthSession();
          if (!session?.access_token) return;
          void completeTutorialProgress(session.access_token, tutorialKey).catch(() => {});
        }}
      />
    );
  }

  return null;
}

function MobileTutorialPanel({
  config,
  filteredSteps,
  progressTutorialKey,
  onComplete,
}: {
  config: NonNullable<ReturnType<typeof getTutorialByKey>>;
  filteredSteps: TutorialStep[];
  progressTutorialKey: TutorialKey;
  onComplete: () => void;
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-[10050] max-h-[50vh] overflow-y-auto rounded-t-2xl border border-slate-200 bg-white p-4 shadow-2xl">
      <div className="text-sm font-semibold text-slate-900">{config.title} · 图文步骤</div>
      <p className="mt-1 text-xs text-slate-500">窄屏下为简化说明；当前页相关步骤共 {filteredSteps.length} 步。</p>
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-slate-700">
        {filteredSteps.map((s) => (
          <li key={`${progressTutorialKey}-${s.title}-${s.target}`}>
            <span className="font-medium text-slate-900">{s.title}</span>：{s.content}
          </li>
        ))}
      </ol>
      <button
        type="button"
        className="mt-4 w-full rounded-lg bg-blue-600 py-2 text-sm font-medium text-white"
        onClick={onComplete}
      >
        标记为已完成
      </button>
    </div>
  );
}
