import type { CSSProperties } from "react";
import { GithubOutlined } from "@ant-design/icons";
import { Tooltip } from "antd";
import { Keyboard, Puzzle, Settings } from "lucide-react";
import { useTranslation } from "react-i18next";

import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { VersionReleaseModal } from "@/components/layout/version-release-modal";
import { changeAppLocale, type AppLocale } from "@/i18n";
import { canvasThemes } from "@/lib/canvas-theme";
import { useConfigStore } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";

type UserStatusActionsProps = {
    variant?: "default" | "canvas";
    onOpenShortcuts?: () => void;
    onOpenPlugins?: () => void;
};

export function UserStatusActions({ variant = "default", onOpenShortcuts, onOpenPlugins }: UserStatusActionsProps) {
    const { i18n, t } = useTranslation();
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const channels = useConfigStore((state) => state.config.channels);
    const hasConfiguredProvider = channels.some((channel) => channel.baseUrl.trim() && channel.apiKey.trim());
    const canvasTheme = canvasThemes[theme];
    const naturalIconClass =
        "inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-stone-600 transition-colors hover:bg-black/5 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-white/10 dark:hover:text-white [&_svg]:size-4";
    const iconStyle: CSSProperties | undefined = variant === "canvas" ? { color: canvasTheme.node.text } : undefined;
    const versionStyle = iconStyle;
    const locale = i18n.resolvedLanguage as AppLocale;
    const nextLocale = locale === "zh-CN" ? "en-US" : "zh-CN";
    const languageLabel = t("topNav.switchLanguage", { language: t(nextLocale === "zh-CN" ? "locale.zhCN" : "locale.enUS") });
    const settingsLabel = t("topNav.settings");

    return (
        <div className="inline-flex shrink-0 items-center gap-1">
            {onOpenPlugins ? (
                <button type="button" className={naturalIconClass} style={iconStyle} onClick={onOpenPlugins} aria-label={t("topNav.plugins")} title={t("topNav.plugins")}>
                    <Puzzle className="size-4" />
                </button>
            ) : null}
            <Tooltip title={settingsLabel} mouseEnterDelay={0.2}>
                <button
                    type="button"
                    className={`${naturalIconClass} relative`}
                    style={iconStyle}
                    onClick={() => openConfigDialog(false, "channels")}
                    aria-label={settingsLabel}
                >
                    <Settings className="size-4" />
                    {!hasConfiguredProvider ? (
                        <span
                            className="absolute right-1 top-1 size-1.5 rounded-full bg-amber-500 ring-2 ring-background"
                            aria-hidden="true"
                        />
                    ) : null}
                </button>
            </Tooltip>
            <Tooltip title={languageLabel} mouseEnterDelay={0.2}>
                <button
                    type="button"
                    className={`${naturalIconClass} text-[11px] font-semibold tracking-tight`}
                    style={iconStyle}
                    onClick={() => void changeAppLocale(nextLocale)}
                    aria-label={languageLabel}
                >
                    {locale === "zh-CN" ? "中" : "EN"}
                </button>
            </Tooltip>
            <AnimatedThemeToggler
                theme={theme}
                onThemeChange={setTheme}
                className={naturalIconClass}
                style={iconStyle}
                aria-label={t(theme === "dark" ? "topNav.lightTheme" : "topNav.darkTheme")}
                title={t(theme === "dark" ? "topNav.lightTheme" : "topNav.darkTheme")}
            />
            <VersionReleaseModal style={versionStyle} />
            <Tooltip title="GitHub" mouseEnterDelay={0.2}>
                <a
                    className={naturalIconClass}
                    style={iconStyle}
                    href="https://github.com/ChenShuo2004/sig-dream"
                    target="_blank"
                    rel="noreferrer"
                    aria-label="GitHub"
                >
                    <GithubOutlined className="text-[15px]" />
                </a>
            </Tooltip>
            {onOpenShortcuts ? (
                <button type="button" className={naturalIconClass} style={iconStyle} onClick={onOpenShortcuts} aria-label={t("topNav.shortcuts")} title={t("topNav.shortcuts")}>
                    <Keyboard className="size-4" />
                </button>
            ) : null}
        </div>
    );
}
