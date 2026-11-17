"use client";

import { useSearchParams } from "next/navigation";

import TutorialJoyride from "@/components/tutorials/TutorialJoyride";
import type { TutorialKey } from "@/lib/tutorials";

export default function TutorialGate({
  pageTutorialKey,
  alsoRespondTo,
}: {
  pageTutorialKey: TutorialKey;
  alsoRespondTo?: TutorialKey[];
}) {
  const searchParams = useSearchParams();
  const activeTutorial = searchParams.get("tutorial");
  return (
    <TutorialJoyride pageTutorialKey={pageTutorialKey} alsoRespondTo={alsoRespondTo} activeTutorial={activeTutorial} />
  );
}
