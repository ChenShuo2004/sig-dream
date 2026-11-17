import { useMemo } from "react";
import { useTranslation } from "react-i18next";

const STUDIO_SRC = "/canvas-app/yue2-studio/index.html";

export default function SongPage() {
    const { t } = useTranslation();
    const src = useMemo(() => `${STUDIO_SRC}?v=20261111chfix`, []);

    return (
        <main className="flex h-[calc(100dvh-2.5rem)] min-h-0 flex-col bg-neutral-100">
            <iframe title={t("songPage.title")} src={src} className="min-h-0 w-full flex-1 border-0 bg-white" allow="microphone; autoplay" />
        </main>
    );
}
