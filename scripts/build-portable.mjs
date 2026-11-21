import { execFileSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"));
const version = pkg.version;
const distDir = join(rootDir, "dist");
const serverDir = join(rootDir, "server");
const releaseDir = join(rootDir, "release");
const bundleName = `sig-dream-${version}-web-portable`;
const stageDir = join(releaseDir, bundleName);

if (!existsSync(join(distDir, "index.html"))) {
    console.error("dist/index.html not found. Run `npm run build` first.");
    process.exit(1);
}

rmSync(stageDir, { recursive: true, force: true });
mkdirSync(stageDir, { recursive: true });

cpSync(join(rootDir, "release/canvas-agent.tgz"), join(stageDir, "canvas-agent.tgz"));
cpSync(distDir, join(stageDir, "dist"), { recursive: true });
cpSync(serverDir, join(stageDir, "server"), { recursive: true });
cpSync(join(rootDir, "src/styles/LICENSE.shadcn.md"), join(stageDir, "LICENSE.shadcn.md"));
cpSync(join(rootDir, "LICENSE"), join(stageDir, "LICENSE"));
cpSync(join(rootDir, "LICENSE.upstream-infinite-canvas"), join(stageDir, "LICENSE.upstream-infinite-canvas"));
mkdirSync(join(stageDir, "docs"));
cpSync(join(rootDir, "docs/agent-connections.md"), join(stageDir, "docs/agent-connections.md"));
cpSync(join(rootDir, "docs/launch-readiness.md"), join(stageDir, "docs/launch-readiness.md"));

writeFileSync(
    join(stageDir, "package.json"),
    `${JSON.stringify(
        {
            name: "sig-dream-portable",
            version,
            private: true,
            type: "module",
            scripts: {
                start: "node server/index.mjs --open",
            },
        },
        null,
        2,
    )}\n`,
    "utf8",
);

const startSh = `#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "未检测到 Node.js，请先安装 Node.js 20+：https://nodejs.org/"
  echo "Node.js 20+ is required: https://nodejs.org/"
  exit 1
fi

echo "正在启动 sig-dream v${version} ..."
exec node server/index.mjs --open
`;

const startMac = `#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "未检测到 Node.js，请先安装 Node.js 20+：https://nodejs.org/"
  echo "安装完成后重新双击本文件即可启动。"
  echo ""
  read -r -p "按回车键退出..."
  exit 1
fi

echo "正在启动 sig-dream v${version}，浏览器将自动打开..."
echo "关闭此窗口即可停止本地服务。"
node server/index.mjs --open
`;

const startWin = `@echo off
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo 未检测到 Node.js，请先安装 Node.js 20+：https://nodejs.org/
  echo 安装完成后重新双击本文件即可启动。
  echo.
  pause
  exit /b 1
)

echo 正在启动 sig-dream v${version}，浏览器将自动打开...
echo 关闭此窗口即可停止本地服务。
node server\\index.mjs --open
pause
`;

const quickGuide = `sig-dream v${version} · 开箱即用 Web 便携版
============================================

无需数据库、无需 npm install、无需编译，仅需本机已安装 Node.js 20+（https://nodejs.org/）。

启动方式：
- macOS：双击「启动-macOS.command」（如首次提示无法验证开发者，右键 -> 打开即可）
- Windows：双击「启动-Windows.bat」
- Linux / 命令行：运行 ./start.sh 或 node server/index.mjs --open

启动后会自动打开浏览器（默认 http://localhost:3000，如端口被占用会自动顺延）。
打开页面后点击右上角设置图标，填入你的模型渠道（Base URL + API Key）即可开始创作。

数据安全：
所有画布工程、素材和 API Key 仅保存在本机浏览器的 IndexedDB / LocalStorage，不上传任何第三方服务器。
如需要独立免 Node.js 安装的客户端，请直接下载 GitHub Releases 中的桌面安装包（macOS / Windows / Linux）。

项目主页：https://github.com/ChenShuo2004/sig-dream
`;

writeFileSync(join(stageDir, "start.sh"), startSh, "utf8");
writeFileSync(join(stageDir, "启动-macOS.command"), startMac, "utf8");
writeFileSync(join(stageDir, "启动-Windows.bat"), startWin.replace(/\n/g, "\r\n"), "utf8");
writeFileSync(join(stageDir, "使用说明.txt"), quickGuide, "utf8");

chmodSync(join(stageDir, "start.sh"), 0o755);
chmodSync(join(stageDir, "启动-macOS.command"), 0o755);

const zipPath = join(releaseDir, `${bundleName}.zip`);
const tarPath = join(releaseDir, `${bundleName}.tar.gz`);
rmSync(zipPath, { force: true });
rmSync(tarPath, { force: true });

if (process.platform === "win32") {
    execFileSync(
        "powershell",
        ["-NoProfile", "-Command", `Compress-Archive -Path '${stageDir}' -DestinationPath '${zipPath}' -Force`],
        { stdio: "inherit" },
    );
} else {
    execFileSync("zip", ["-rq", zipPath, bundleName], { cwd: releaseDir, stdio: "inherit" });
    execFileSync("tar", ["-czf", tarPath, bundleName], { cwd: releaseDir, stdio: "inherit" });
}

console.log(`Portable release ready:\n- ${zipPath}${existsSync(tarPath) ? `\n- ${tarPath}` : ""}`);
