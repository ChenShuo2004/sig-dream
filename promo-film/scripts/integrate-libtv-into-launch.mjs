import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const ROOT = '/Users/chenshuo/.gemini/antigravity/scratch/sig-dream';
const PROMO_OUT = path.join(ROOT, 'promo-film/out');
const BASE_LAUNCH = path.join(PROMO_OUT, 'sig-dream-launch-white-1080p.v1-backup.mp4');
const FINAL_LAUNCH = path.join(PROMO_OUT, 'sig-dream-launch-white-1080p.mp4');
const DOCS_LAUNCH = path.join(ROOT, 'docs/demos/00-open-source-launch.mp4');
const DOCS_GIF = path.join(ROOT, 'docs/screenshots/open-source-promo.gif');
const LIBTV_CLIP = path.join(ROOT, 'promo-film/studio-demos/raw/libtv_replication_final.mp4');
const WORK = path.join(ROOT, 'promo-film/studio-demos/launch-merge');
fs.mkdirSync(WORK, { recursive: true });

// Preserve v1 backup once so script is idempotent
if (!fs.existsSync(BASE_LAUNCH)) {
  fs.copyFileSync(FINAL_LAUNCH, BASE_LAUNCH);
  console.log('Backed up v1 launch film to:', BASE_LAUNCH);
}

// 1. Render Pure-White Gallery Plate matching promo-film/index.html & s4-studios.html
// Video window exact rect: left=160, top=166, width=1600, height=900? Keep 16:9 inside clean margin:
// width=1472, height=828 (exact 16:9!), left=224, top=172 -> bottom=1000 (80px breathing room!)
const platePath = path.join(WORK, 's4b_libtv_plate.png');
const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    width: 1920px; height: 1080px; overflow: hidden;
    background-color: #fbfbfa;
    background-image: radial-gradient(rgba(24, 24, 27, 0.075) 1.2px, transparent 1.2px);
    background-size: 24px 24px;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "PingFang SC", "Hiragino Sans GB", sans-serif;
    color: #09090b;
    -webkit-font-smoothing: antialiased;
  }
  .top {
    position: absolute; left: 224px; right: 224px; top: 58px;
    display: flex; align-items: center; justify-content: space-between;
  }
  .h2 {
    font-size: 52px; font-weight: 800; letter-spacing: -0.03em; color: #09090b;
  }
  .tag {
    padding: 10px 24px; border-radius: 999px;
    background: #ffffff; border: 1px solid rgba(0, 0, 0, 0.1);
    font-size: 24px; font-weight: 600; color: #c86d44;
    box-shadow: 0 4px 16px rgba(0,0,0,0.04);
  }
  .frame {
    position: absolute; left: 224px; top: 164px; width: 1472px; height: 828px;
    border-radius: 24px; background: #09090b;
    border: 1px solid rgba(0, 0, 0, 0.09);
    box-shadow: 0 36px 90px rgba(15, 23, 42, 0.14);
  }
  .caption {
    position: absolute; left: 224px; right: 224px; bottom: 26px;
    display: flex; align-items: center; justify-content: space-between;
    font-size: 20px; font-weight: 500; color: #71717a;
  }
  .caption strong { color: #18181b; font-weight: 600; }
</style>
</head>
<body>
  <div class="top">
    <div class="h2">复刻工作室实拍 · 角色一致与高速运镜</div>
    <div class="tag">LibTV · Seedance 2.5 成片</div>
  </div>
  <div class="frame"></div>
  <div class="caption">
    <span><strong>白西装焰发主角</strong> · 屋顶高速冲刺 → 石阶追逐 → 拱廊逆光回眸</span>
    <span>16:9 · Seedance 2.5 全能参考实测输出</span>
  </div>
</body>
</html>`;

const browser = await chromium.launch({
  headless: true,
  executablePath: '/Users/chenshuo/Library/Caches/ms-playwright/chromium-1255/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
});
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'load' });
  await page.waitForTimeout(150);
  await page.screenshot({ path: platePath, type: 'png' });
} finally {
  await browser.close();
}

function ff(args) {
  execFileSync('ffmpeg', ['-y', '-v', 'error', ...args], { stdio: 'inherit' });
}

const partA = path.join(WORK, 'partA_0_21s.mp4');
const partB = path.join(WORK, 'partB_libtv_8s.mp4');
const partC = path.join(WORK, 'partC_endcard.mp4');

// Part A: 0.0s -> 21.0s of v1 pure-white launch film (S1 Hook + S2 Zero-DB + S3 Canvas + S4A 3 Studios)
ff([
  '-i', BASE_LAUNCH, '-t', '21.0',
  '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-crf', '17', '-preset', 'medium',
  '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', partA
]);

// Part B: 8.0s live LibTV Seedance 2.5 showcase (1.5s -> 9.5s: flame sprint -> stairs chase -> archway turn)
// Mix LibTV clip audio (0.85) with subtle continuity bed from launch film's 21.0-23.5s? No, LibTV clip has its own rich chase drums + footsteps + flame swoosh!
ff([
  '-loop', '1', '-t', '8.0', '-i', platePath,
  '-ss', '1.5', '-t', '8.0', '-i', LIBTV_CLIP,
  '-filter_complex',
  '[1:v]scale=1472:828:flags=lanczos,fps=30,setpts=PTS-STARTPTS[vid];' +
  '[0:v][vid]overlay=224:164:shortest=1,format=yuv420p[vout];' +
  '[1:a]aresample=48000,aformat=channel_layouts=stereo,volume=1.15,afade=t=in:st=0:d=0.35,afade=t=out:st=7.55:d=0.45[aout]',
  '-map', '[vout]', '-map', '[aout]',
  '-t', '8.0', '-c:v', 'libx264', '-crf', '17', '-preset', 'medium',
  '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', partB
]);

// Part C: 23.5s -> 28.0s (4.5s) Endcard of v1 launch film
ff([
  '-ss', '23.5', '-i', BASE_LAUNCH,
  '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-crf', '17', '-preset', 'medium',
  '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', partC
]);

// Splice A (21.0s) + B (8.0s) + C (4.5s) with crisp 0.35s crossfades -> total ~32.8s
ff([
  '-i', partA, '-i', partB, '-i', partC,
  '-filter_complex',
  '[0:v]fps=30,settb=AVTB[v0];[1:v]fps=30,settb=AVTB[v1];[2:v]fps=30,settb=AVTB[v2];' +
  '[v0][v1]xfade=transition=fade:duration=0.35:offset=20.65[v01];' +
  '[v01][v2]xfade=transition=fade:duration=0.35:offset=28.30,format=yuv420p[v];' +
  '[0:a][1:a]acrossfade=d=0.35[a01];[a01][2:a]acrossfade=d=0.35[a]',
  '-map', '[v]', '-map', '[a]',
  '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', FINAL_LAUNCH
]);

// Sync to docs/demos/00-open-source-launch.mp4
fs.copyFileSync(FINAL_LAUNCH, DOCS_LAUNCH);

// Refresh README GIF preview (920px wide, 12fps, highlights Hook + Canvas + LibTV Action + Endcard)
const palette = path.join(WORK, 'palette.png');
ff([
  '-i', FINAL_LAUNCH,
  '-vf', 'fps=12,scale=920:-1:flags=lanczos,palettegen=max_colors=128:stats_mode=diff',
  palette
]);
ff([
  '-i', FINAL_LAUNCH, '-i', palette,
  '-lavfi', 'fps=12,scale=920:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3',
  DOCS_GIF
]);

console.log('SUCCESS:', FINAL_LAUNCH, DOCS_LAUNCH, DOCS_GIF);
