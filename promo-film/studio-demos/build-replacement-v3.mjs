import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const REPO = '/Users/chenshuo/.gemini/antigravity/scratch/sig-dream';
const ROOT = path.join(REPO, 'promo-film/studio-demos');
const RAW = path.join(ROOT, 'raw');
const PLATES = path.join(ROOT, 'plates-v3');
const OUT = path.join(ROOT, 'out');
const DOCS_DEMOS = path.join(REPO, 'docs/demos');
fs.mkdirSync(PLATES, { recursive: true });

const SRC_TEST_VIDEO = '/Users/chenshuo/1.aigc/素材角色/测试视频.mp4';
const LIBTV_SWAP_VIDEO = path.join(RAW, 'libtv_replacement_final.mp4');
const SWAP_REF_SHEET = path.join(RAW, 'replacement_img_0.png');

function toDataUri(filePath) {
  return `data:image/png;base64,${fs.readFileSync(filePath).toString('base64')}`;
}

function baseHtml(bodyHtml) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    width: 1920px; height: 1080px; overflow: hidden;
    background-color: #fbfbfa;
    background-image: radial-gradient(rgba(24, 24, 27, 0.06) 1.2px, transparent 1.2px);
    background-size: 24px 24px;
    color: #0A0A0A;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "PingFang SC", "Hiragino Sans GB", sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .shell { width: 1920px; height: 1080px; display: flex; flex-direction: column; }
  .topbar {
    height: 76px; padding: 0 56px; display: flex; align-items: center; justify-content: space-between;
    border-bottom: 1px solid #EAECEF; background: rgba(255,255,255,0.92);
  }
  .brand { display: flex; align-items: center; gap: 14px; font-size: 20px; font-weight: 700; letter-spacing: -0.02em; }
  .brand-dot { width: 10px; height: 10px; border-radius: 50%; background: #c86d44; }
  .brand-sub { color: #6B7280; font-weight: 500; }
  .steps { display: flex; align-items: center; gap: 10px; }
  .step {
    padding: 8px 18px; border-radius: 999px; font-size: 16px; font-weight: 500;
    color: #6B7280; background: #F5F6F8; border: 1px solid #E5E7EB;
  }
  .step.active { color: #FFFFFF; background: #0A0A0A; border-color: #0A0A0A; }
  .step.done { color: #0A0A0A; background: #FFFFFF; border-color: #D1D5DB; }
  .badge {
    padding: 7px 16px; border-radius: 999px; font-size: 14px; font-weight: 600;
    color: #c86d44; background: #FFFFFF; border: 1px solid #E5E7EB;
  }
  .main { flex: 1; padding: 30px 56px 32px; display: flex; flex-direction: column; gap: 20px; position: relative; }
  .hero-head { display: flex; align-items: flex-end; justify-content: space-between; }
  .kicker { font-size: 14px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #c86d44; margin-bottom: 6px; }
  h1 { font-size: 36px; font-weight: 800; letter-spacing: -0.03em; line-height: 1.15; color: #0A0A0A; }
  .meta-pills { display: flex; gap: 10px; }
  .pill {
    padding: 8px 16px; border-radius: 10px; font-size: 15px; font-weight: 500;
    background: #FFFFFF; border: 1px solid #E5E7EB; color: #374151;
  }
  .pill strong { color: #0A0A0A; font-weight: 700; }
  .card {
    background: #FFFFFF; border: 1px solid #E5E7EB; border-radius: 20px; overflow: hidden;
    box-shadow: 0 12px 32px rgba(15,23,42,0.04);
  }
  .slot-box {
    background: #0B0B0D; border-radius: 20px; border: 1px solid rgba(0,0,0,0.08);
    box-shadow: 0 24px 60px rgba(15,23,42,0.12);
  }
  .foot {
    height: 46px; padding: 0 56px; border-top: 1px solid #EAECEF; background: rgba(255,255,255,0.86);
    display: flex; align-items: center; justify-content: space-between;
    font-size: 14px; color: #71717a;
  }
</style>
</head>
<body>${bodyHtml}</body>
</html>`;
}

function ff(args) {
  execFileSync('ffmpeg', ['-y', '-v', 'error', ...args], { stdio: 'inherit' });
}

const swapRefUri = toDataUri(SWAP_REF_SHEET);

const plates = [
  {
    // Step 1: live 测试视频.mp4 at x=88, y=76+142=218, w=384, h=682
    name: 's3v3_step1.png',
    html: baseHtml(`
      <div class="shell">
        <div class="topbar">
          <div class="brand"><div class="brand-dot"></div>SIG-DREAM <span class="brand-sub">/ 替换工作室 Replacement Studio</span></div>
          <div class="steps">
            <div class="step active">1 素材设定</div>
            <div class="step">2 图像替换</div>
            <div class="step">3 视频替换</div>
            <div class="step">4 声音克隆</div>
            <div class="step">5 合成视频</div>
          </div>
          <div class="badge">人物主体 + 口播双替换</div>
        </div>
        <div class="main">
          <div class="hero-head">
            <div>
              <div class="kicker">STEP 01 · SOURCE VIDEO INTAKE & CHARACTER BINDING</div>
              <h1>导入英文口播原片，自动识别人物并绑定「女主二」三视图</h1>
            </div>
            <div class="meta-pills">
              <div class="pill">原片：<strong>英文保温杯种草 · 15.1s</strong></div>
              <div class="pill">目标：<strong>女主二 + 中文女声配音</strong></div>
            </div>
          </div>
          <div class="slot-box" style="position:absolute; left:88px; top:142px; width:384px; height:682px;"></div>
          <div style="position:absolute; left:520px; top:142px; right:56px; height:682px; display:flex; flex-direction:column; gap:20px;">
            <div class="card" style="padding:24px; display:flex; gap:26px; align-items:center; height: 420px;">
              <div style="width:540px; height:100%; border-radius:14px; overflow:hidden; border:1px solid #EAECEF;"><img src="${swapRefUri}" style="width:100%; height:100%; object-fit:cover;" /></div>
              <div style="flex:1; display:flex; flex-direction:column; gap:12px;">
                <div class="pill" style="align-self:flex-start;">目标替换角色 · 三视图</div>
                <div style="font-size:28px; font-weight:800;">女主二（黑短发橙挑染）</div>
                <div style="font-size:17px; color:#4B5563; line-height:1.7;">
                  完整替换原片金发人物的身份与穿搭，同时保留手持黑色哑光保温杯的姿态、室内光影与产品细节。
                </div>
              </div>
            </div>
            <div class="card" style="padding:26px 30px; flex:1; display:flex; align-items:center; justify-content:space-between;">
              <div>
                <div style="font-size:14px; font-weight:700; color:#c86d44;">当前播放：原片英文人声（下一步自动替换为中文口播）</div>
                <div style="font-size:20px; font-weight:700; margin-top:8px;">“I didn't expect to like this cup this much. Sleek black with that engraved detail...”</div>
              </div>
              <div class="pill" style="background:#0A0A0A; color:#FFFFFF; border-color:#0A0A0A; padding:12px 22px; font-size:16px;">原片实播中</div>
            </div>
          </div>
        </div>
        <div class="foot"><span>SIG-DREAM · 替换工作室功能展示</span><span>Step 1 / 5 · 原片英文口播与目标角色装载</span></div>
      </div>
    `)
  },
  {
    // Step 2-5 LIVE SIDE-BY-SIDE VIDEO COMPARISON:
    // Left (Original 测试视频.mp4): x=104, y=76+170=246, w=396, h=704
    // Right (Replaced libtv_replacement_final.mp4): x=596, y=76+170=246, w=396, h=704
    // Info column: x=1048..1864
    name: 's3v3_step_compare.png',
    html: baseHtml(`
      <div class="shell">
        <div class="topbar">
          <div class="brand"><div class="brand-dot"></div>SIG-DREAM <span class="brand-sub">/ 替换工作室 Replacement Studio</span></div>
          <div class="steps">
            <div class="step done">✓ 素材设定</div>
            <div class="step done">✓ 图像替换</div>
            <div class="step active">3–5 视频与配音对比</div>
          </div>
          <div class="badge">真动态视频同屏对比 · 同步中文口播</div>
        </div>
        <div class="main">
          <div class="hero-head">
            <div>
              <div class="kicker">STEP 02–05 · LIVE BEFORE / AFTER VIDEO & VOICE REPLACEMENT</div>
              <h1>原片英文视频 ⇄ 替换后「女主二」中文口播动态视频同屏对比</h1>
            </div>
            <div class="meta-pills">
              <div class="pill">视频：<strong>9:16 实拍动态替换</strong></div>
              <div class="pill">配音：<strong>英文 → 中文女声口型同步</strong></div>
            </div>
          </div>

          <div style="position:absolute; left:104px; top:136px; width:396px; text-align:center; font-size:16px; font-weight:700; color:#6B7280;">原片视频（金发女主 · 英文原声）</div>
          <div class="slot-box" style="position:absolute; left:104px; top:170px; width:396px; height:704px;"></div>

          <div style="position:absolute; left:516px; top:486px; width:64px; height:64px; border-radius:50%; background:#0A0A0A; color:#FFFFFF; display:flex; align-items:center; justify-content:center; font-size:28px; font-weight:700;">→</div>

          <div style="position:absolute; left:596px; top:136px; width:396px; text-align:center; font-size:16px; font-weight:800; color:#0A0A0A;">替换后视频（女主二 · 中文配音）</div>
          <div class="slot-box" style="position:absolute; left:596px; top:170px; width:396px; height:704px; border:2px solid #0A0A0A;"></div>

          <div style="position:absolute; left:1048px; top:170px; right:56px; height:704px; display:flex; flex-direction:column; gap:20px;">
            <div class="card" style="padding:26px 30px;">
              <div style="font-size:14px; font-weight:700; color:#059669; margin-bottom:10px;">✓ 同步中文口播台词（正在播放替换后音轨）</div>
              <div style="font-size:21px; font-weight:700; color:#0A0A0A; line-height:1.65;">
                “真没想到会这么喜欢这个杯子，哑光黑配雕花细节特别高级，杯盖和提绳也很贴心，出门每天都想带着它。”
              </div>
            </div>
            <div class="card" style="padding:26px 30px; flex:1; display:flex; flex-direction:column; justify-content:space-between;">
              <div>
                <div style="font-size:14px; font-weight:700; color:#c86d44; margin-bottom:14px;">人物 + 声音双替换实测核验</div>
                <div style="display:flex; flex-direction:column; gap:14px; font-size:17px; color:#111827; line-height:1.6;">
                  <div>• <strong>人物主体替换</strong>：黑短发橙挑染、橙色发卡、黑底橙线背心全程稳定</div>
                  <div>• <strong>商品零畸变</strong>：黑色哑光保温杯、杯盖与提绳结构完整保留</div>
                  <div>• <strong>跨语种配音同步</strong>：英文原片无缝转为自然中文女声种草口播</div>
                  <div>• <strong>一键合成导出</strong>：支持继续接入无限画布做多镜头剪辑</div>
                </div>
              </div>
              <div style="padding:14px 18px; border-radius:12px; background:#0A0A0A; color:#FFFFFF; font-size:15px; font-weight:600; text-align:center;">
                OpenLux gpt-image-2 换帧 + LibTV Seedance 2.5 动态实拍
              </div>
            </div>
          </div>
        </div>
        <div class="foot"><span>SIG-DREAM · 替换工作室功能展示</span><span>Step 2–5 / 5 · 左右真实动态视频同屏同步对比</span></div>
      </div>
    `)
  }
];

const browser = await chromium.launch({
  headless: true,
  executablePath: '/Users/chenshuo/Library/Caches/ms-playwright/chromium-1255/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
});
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  for (const p of plates) {
    await page.setContent(p.html, { waitUntil: 'load' });
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(PLATES, p.name), type: 'png' });
    console.log('Rendered plate:', p.name);
  }
} finally {
  await browser.close();
}

const p1 = path.join(PLATES, 's3v3_step1.png');
const p2 = path.join(PLATES, 's3v3_step_compare.png');
const seg1 = path.join(PLATES, 'd3v3_seg1.mp4');
const seg2 = path.join(PLATES, 'd3v3_seg2.mp4');
const outMp4 = path.join(OUT, '03-replacement-studio-demo.mp4');
const docMp4 = path.join(DOCS_DEMOS, '06-replacement-studio.mp4');
const docGif = path.join(DOCS_DEMOS, '06-replacement-studio.gif');
const docPoster = path.join(DOCS_DEMOS, '06-replacement-studio-poster.png');

// Segment 1 (4.8s): Original English video playing live with original English voice!
ff([
  '-loop', '1', '-t', '4.8', '-i', p1,
  '-ss', '0', '-t', '4.8', '-i', SRC_TEST_VIDEO,
  '-filter_complex',
  '[1:v]scale=384:682:flags=lanczos,fps=30,setpts=PTS-STARTPTS[vid];' +
  '[0:v][vid]overlay=88:218:shortest=1,format=yuv420p[vout];' +
  '[1:a]aresample=48000,aformat=channel_layouts=stereo,afade=t=in:st=0:d=0.25,afade=t=out:st=4.35:d=0.45[aout]',
  '-map', '[vout]', '-map', '[aout]',
  '-t', '4.8', '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-c:a', 'aac', '-b:a', '192k', seg1
]);

// Segment 2 (10.0s): Side-by-side LIVE original (x=104, y=246) vs LIVE replaced 女主二 (x=596, y=246) + REAL synced Chinese audio!
ff([
  '-loop', '1', '-t', '10.0', '-i', p2,
  '-ss', '0', '-t', '10.0', '-i', SRC_TEST_VIDEO,
  '-i', LIBTV_SWAP_VIDEO,
  '-filter_complex',
  '[1:v]scale=396:704:flags=lanczos,fps=30,setpts=PTS-STARTPTS[vorig];' +
  '[2:v]scale=396:704:flags=lanczos,fps=30,setpts=PTS-STARTPTS[vrep];' +
  '[0:v][vorig]overlay=104:246:shortest=1[tmp];[tmp][vrep]overlay=596:246:shortest=1,format=yuv420p[vout];' +
  '[2:a]aresample=48000,aformat=channel_layouts=stereo,volume=1.15,afade=t=in:st=0:d=0.25,afade=t=out:st=9.5:d=0.5[aout]',
  '-map', '[vout]', '-map', '[aout]',
  '-t', '10.0', '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-c:a', 'aac', '-b:a', '192k', seg2
]);

// Smooth 0.4s crossfade -> total 14.4s
ff([
  '-i', seg1, '-i', seg2,
  '-filter_complex',
  '[0:v]fps=30,settb=AVTB[v0];[1:v]fps=30,settb=AVTB[v1];' +
  '[v0][v1]xfade=transition=fade:duration=0.4:offset=4.4,format=yuv420p[v];' +
  '[0:a][1:a]acrossfade=d=0.4[a]',
  '-map', '[v]', '-map', '[a]',
  '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', outMp4
]);

// Sync to docs/demos/06-replacement-studio.*
fs.copyFileSync(outMp4, docMp4);
ff(['-ss', '8.0', '-i', outMp4, '-vframes', '1', docPoster]);
const pal = path.join(PLATES, 'pal.png');
ff(['-i', outMp4, '-vf', 'fps=8,scale=760:-1:flags=lanczos,palettegen=max_colors=96:stats_mode=diff', pal]);
ff(['-i', outMp4, '-i', pal, '-lavfi', 'fps=8,scale=760:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3', docGif]);

console.log('SUCCESS V3 REPLACEMENT DEMO:', outMp4, docMp4, docGif);
