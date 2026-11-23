import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const REPO = '/Users/chenshuo/.gemini/antigravity/scratch/sig-dream';
const ROOT = path.join(REPO, 'promo-film/studio-demos');
const RAW = path.join(ROOT, 'raw');
const PLATES = path.join(ROOT, 'plates-v2');
const OUT = path.join(ROOT, 'out');
const DOCS_DEMOS = path.join(REPO, 'docs/demos');
fs.mkdirSync(PLATES, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

const SRC_007_VIDEO = '/Users/chenshuo/.t3/userdata/attachments/f0f05c1e-9780-4401-86c1-a80508397232-fceb44da-59b9-4e42-803f-1ab226c2cb0f-mp4.mp4';
const SRC_TEST_VIDEO = '/Users/chenshuo/1.aigc/素材角色/测试视频.mp4';
const SRC_VOICE_MP3 = '/Users/chenshuo/1.aigc/xiamen-geo-film/audio/lines/line_01.mp3';
const LIBTV_CLIP = path.join(RAW, 'libtv_replication_final.mp4');

function toDataUri(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
  return `data:${mime};base64,${fs.readFileSync(filePath).toString('base64')}`;
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
  .main { flex: 1; padding: 34px 56px 36px; display: flex; flex-direction: column; gap: 24px; position: relative; }
  .hero-head { display: flex; align-items: flex-end; justify-content: space-between; }
  .kicker { font-size: 14px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #c86d44; margin-bottom: 6px; }
  h1 { font-size: 38px; font-weight: 800; letter-spacing: -0.03em; line-height: 1.15; color: #0A0A0A; }
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

async function renderV2Plates(browser) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });

  const repHeroSheet = toDataUri('/Users/chenshuo/.t3/userdata/attachments/f0f05c1e-9780-4401-86c1-a80508397232-14216682-fb3b-4f4a-8d00-f85c9a89bfbe.png');
  const repScene = toDataUri(path.join(RAW, 'replication_asset_2.png'));
  const swapRef = toDataUri(path.join(RAW, 'replacement_img_0.png'));

  const plates = [
    // ===== STUDIO 2 (REPLICATION) - UPGRADED WITH LIBTV 16:9 ACTION =====
    {
      // Step 1-2: 007 reference video live at x=88, y=76+148=224, w=384, h=682
      name: 's2v2_step12.png',
      html: baseHtml(`
        <div class="shell">
          <div class="topbar">
            <div class="brand"><div class="brand-dot"></div>SIG-DREAM <span class="brand-sub">/ 复刻工作室 Replication Studio</span></div>
            <div class="steps">
              <div class="step done">1 上传原片</div>
              <div class="step active">2 原片分析</div>
              <div class="step">3 角色替换</div>
              <div class="step">4 成片输出</div>
            </div>
            <div class="badge">动作拆解 · 运镜复刻</div>
          </div>
          <div class="main">
            <div class="hero-head">
              <div>
                <div class="kicker">STEP 01–02 · ACTION REFERENCE & CAMERA CHOREOGRAPHY</div>
                <h1>上传高速动作原片，AI 自动拆解屋顶冲刺与下台阶运镜节奏</h1>
              </div>
              <div class="meta-pills">
                <div class="pill">原片：<strong>007_动作参考</strong></div>
                <div class="pill">分析引擎：<strong>GPT-4o + Seedance 2.5</strong></div>
              </div>
            </div>
            <div class="slot-box" style="position:absolute; left:88px; top:148px; width:384px; height:682px;"></div>
            <div style="position:absolute; left:520px; top:148px; right:56px; height:682px; display:flex; flex-direction:column; gap:20px;">
              <div class="card" style="padding:26px 30px; display:flex; gap:28px; align-items:center; height: 390px;">
                <div style="width:520px; height:100%; border-radius:14px; overflow:hidden; border:1px solid #EAECEF; background:#FFFFFF;">
                  <img src="${repHeroSheet}" style="width:100%; height:100%; object-fit:contain;" />
                </div>
                <div style="flex:1; display:flex; flex-direction:column; gap:12px;">
                  <div class="pill" style="align-self:flex-start;">目标替换主角 · 三视图锁定</div>
                  <div style="font-size:28px; font-weight:800;">白西装焰发主角</div>
                  <div style="font-size:17px; color:#4B5563; line-height:1.7;">
                    纯白修身西装、纯黑虚幻面庞与蓝金烈焰卷发。锁定三视图后，直接驱动高速追逐、急转下台阶与逆光回眸。
                  </div>
                </div>
              </div>
              <div class="card" style="padding:24px 30px; flex:1; display:grid; grid-template-columns: repeat(3, 1fr); gap:16px; align-items:center;">
                <div style="padding:18px; border-radius:14px; background:#F8F8F7; border:1px solid #E5E7EB;">
                  <div style="font-size:13px; font-weight:700; color:#c86d44;">0–3.5s · 屋顶冲刺</div>
                  <div style="font-size:17px; font-weight:700; margin-top:6px;">手持高速侧跟拍</div>
                  <div style="font-size:14px; color:#6B7280; margin-top:4px;">蓝金烈焰拖出动态能量尾迹</div>
                </div>
                <div style="padding:18px; border-radius:14px; background:#F8F8F7; border:1px solid #E5E7EB;">
                  <div style="font-size:13px; font-weight:700; color:#c86d44;">3.5–7.5s · 石阶追逐</div>
                  <div style="font-size:17px; font-weight:700; margin-top:6px;">俯拍急转下台阶</div>
                  <div style="font-size:14px; color:#6B7280; margin-top:4px;">暖阳古城石墙与落叶动势</div>
                </div>
                <div style="padding:18px; border-radius:14px; background:#0A0A0A; color:#FFFFFF;">
                  <div style="font-size:13px; font-weight:700; color:#F59E0B;">7.5–10s · 拱廊定格</div>
                  <div style="font-size:17px; font-weight:700; margin-top:6px;">推进刹停逆光回眸</div>
                  <div style="font-size:14px; color:#D1D5DB; margin-top:4px;">电影鼓点 + 脚步与烈焰音效</div>
                </div>
              </div>
            </div>
          </div>
          <div class="foot"><span>SIG-DREAM · 复刻工作室功能展示</span><span>Step 1–3 / 4 · 原片动势拆解与角色锁定</span></div>
        </div>
      `)
    },
    {
      // Step 4: FULL-WIDTH 16:9 LibTV Seedance 2.5 video slot at x=160, y=76+136=212, w=1280, h=720!
      // Right info rail: x=1476..1864
      name: 's2v2_step4_libtv.png',
      html: baseHtml(`
        <div class="shell">
          <div class="topbar">
            <div class="brand"><div class="brand-dot"></div>SIG-DREAM <span class="brand-sub">/ 复刻工作室 Replication Studio</span></div>
            <div class="steps">
              <div class="step done">✓ 上传原片</div>
              <div class="step done">✓ 原片分析</div>
              <div class="step done">✓ 角色替换</div>
              <div class="step active">4 成片输出</div>
            </div>
            <div class="badge">LibTV · Seedance 2.5 实拍成片</div>
          </div>
          <div class="main">
            <div class="hero-head">
              <div>
                <div class="kicker">STEP 04 · LIBTV SEEDANCE 2.5 ACTION REPLICATION OUTPUT</div>
                <h1>16:9 电影级动作复刻成片：高速运镜、光影与角色高度一致</h1>
              </div>
              <div class="meta-pills">
                <div class="pill">规格：<strong>1280×720 · 16:9 · 10.0s</strong></div>
                <div class="pill">音轨：<strong>立体声原生音效</strong></div>
              </div>
            </div>
            <div class="slot-box" style="position:absolute; left:56px; top:142px; width:1312px; height:738px;"></div>
            <div style="position:absolute; left:1404px; top:142px; right:56px; height:738px; display:flex; flex-direction:column; gap:18px;">
              <div class="card" style="padding:20px; display:flex; flex-direction:column; gap:12px;">
                <div style="font-size:13px; font-weight:700; color:#6B7280;">锁定参考角色</div>
                <div style="height:220px; border-radius:12px; overflow:hidden; border:1px solid #EAECEF; background:#FFFFFF;">
                  <img src="${repHeroSheet}" style="width:100%; height:100%; object-fit:contain;" />
                </div>
                <div style="font-size:17px; font-weight:700;">白西装焰发主角</div>
              </div>
              <div class="card" style="padding:22px; flex:1; display:flex; flex-direction:column; justify-content:space-between;">
                <div>
                  <div style="font-size:13px; font-weight:700; color:#059669; margin-bottom:10px;">✓ 复刻成片核验通过</div>
                  <div style="display:flex; flex-direction:column; gap:12px; font-size:15px; color:#374151; line-height:1.6;">
                    <div>• <strong>高速动态无崩坏</strong>：疾跑翻飞衣摆与蓝金烈焰尾迹自然</div>
                    <div>• <strong>多机位连贯切换</strong>：俯拍屋顶 → 低机位石阶 → 拱廊近景</div>
                    <div>• <strong>角色 100% 一致</strong>：全程保持白西装、黑轮廓面与焰发特征</div>
                  </div>
                </div>
                <div style="padding:13px 16px; border-radius:12px; background:#0A0A0A; color:#FFFFFF; font-size:14px; font-weight:600; text-align:center;">
                  支持一键同步画布 · 继续多节点精修
                </div>
              </div>
            </div>
          </div>
          <div class="foot"><span>SIG-DREAM · 复刻工作室功能展示</span><span>Step 4 / 4 · LibTV Seedance 2.5 全幅实播中</span></div>
        </div>
      `)
    },

    // ===== STUDIO 3 (REPLACEMENT) - UPGRADED WITH LIVE ANIMATED WIPE-REVEAL =====
    {
      // Step 1: live 测试视频.mp4 at x=88, y=76+148=224, w=384, h=682
      name: 's3v2_step1.png',
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
            <div class="badge">人物 + 音色双替换</div>
          </div>
          <div class="main">
            <div class="hero-head">
              <div>
                <div class="kicker">STEP 01 · PERSON DETECTION, TARGET CHARACTER & VOICE BINDING</div>
                <h1>上传原片自动框选人物，绑定「女主二」三视图与参考音色</h1>
              </div>
              <div class="meta-pills">
                <div class="pill">原片：<strong>测试视频.mp4 · 15.1s</strong></div>
                <div class="pill">识别结果：<strong>自动框选人物 A</strong></div>
              </div>
            </div>
            <div class="slot-box" style="position:absolute; left:88px; top:148px; width:384px; height:682px;"></div>
            <div style="position:absolute; left:520px; top:148px; right:56px; height:682px; display:flex; flex-direction:column; gap:20px;">
              <div class="card" style="padding:24px; display:flex; gap:26px; align-items:center; height: 420px;">
                <div style="width:540px; height:100%; border-radius:14px; overflow:hidden; border:1px solid #EAECEF;"><img src="${swapRef}" style="width:100%; height:100%; object-fit:cover;" /></div>
                <div style="flex:1; display:flex; flex-direction:column; gap:12px;">
                  <div class="pill" style="align-self:flex-start;">目标替换人物</div>
                  <div style="font-size:28px; font-weight:800;">女主二 · 三视图</div>
                  <div style="font-size:17px; color:#4B5563; line-height:1.7;">
                    黑短发橙挑染 + 橙色发卡 + 黑色橙边无袖背心。直接拖入人物定位框即可精准替换身份与服装，保持动作与遮挡关系不变。
                  </div>
                </div>
              </div>
              <div class="card" style="padding:26px 30px; flex:1; display:flex; align-items:center; justify-content:space-between;">
                <div>
                  <div style="font-size:14px; font-weight:700; color:#c86d44;">目标声音参考 · Demucs + IndexTTS</div>
                  <div style="font-size:22px; font-weight:700; margin-top:6px;">target_voice_line01.mp3（9.4s 干声样本）</div>
                  <div style="font-size:16px; color:#4B5563; margin-top:6px;">支持自动提取人声干音、保留原背景音轨并逐句克隆目标音色</div>
                </div>
                <div class="pill" style="background:#0A0A0A; color:#FFFFFF; border-color:#0A0A0A; padding:12px 22px; font-size:16px;">已绑定就绪 ✓</div>
              </div>
            </div>
          </div>
          <div class="foot"><span>SIG-DREAM · 替换工作室功能展示</span><span>Step 1 / 5 · 原片人物识别与目标资产装载</span></div>
        </div>
      `)
    },
    {
      // Step 2 animated wipe-reveal plate:
      // Main large 9:16 interactive reveal viewport at x=120, y=76+142=218, w=420, h=746 (exact 9:16!)
      // Right side: detail cards explaining pixel-exact swap + Step 3-5 pipeline
      name: 's3v2_step2_wipe_plate.png',
      html: baseHtml(`
        <div class="shell">
          <div class="topbar">
            <div class="brand"><div class="brand-dot"></div>SIG-DREAM <span class="brand-sub">/ 替换工作室 Replacement Studio</span></div>
            <div class="steps">
              <div class="step done">✓ 素材设定</div>
              <div class="step active">2 图像替换</div>
              <div class="step">3 视频替换</div>
              <div class="step">4 声音克隆</div>
              <div class="step">5 合成视频</div>
            </div>
            <div class="badge">OpenLux · gpt-image-2 实时对比</div>
          </div>
          <div class="main">
            <div class="hero-head">
              <div>
                <div class="kicker">STEP 02 · LIVE BEFORE / AFTER WIPE COMPARISON</div>
                <h1>拖拽人物卡到定位框：像素级精准替换人物，手部与光影零穿帮</h1>
              </div>
              <div class="meta-pills">
                <div class="pill">关键帧：<strong>1/1 已完成</strong></div>
                <div class="pill">左：<strong>替换后（女主二）</strong> · 右：<strong>原片首帧</strong></div>
              </div>
            </div>
            <div class="slot-box" style="position:absolute; left:120px; top:142px; width:420px; height:746px;"></div>
            <div style="position:absolute; left:596px; top:142px; right:56px; height:746px; display:flex; flex-direction:column; gap:20px;">
              <div class="card" style="padding:28px 32px; display:flex; flex-direction:column; gap:14px;">
                <div style="font-size:14px; font-weight:700; color:#059669;">✓ 拖拽替换关键帧实测效果</div>
                <div style="font-size:26px; font-weight:800;">完整保留持杯手指、遮挡关系与室内自然光</div>
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:16px; margin-top:6px;">
                  <div style="padding:18px; border-radius:14px; background:#F8F8F7; border:1px solid #E5E7EB;">
                    <div style="font-size:15px; font-weight:700;">身份与穿搭 1:1 还原</div>
                    <div style="font-size:14px; color:#4B5563; margin-top:6px; line-height:1.6;">黑短发橙挑染、橙色发卡、黑色橙线无袖背心完整贴合原人物姿态。</div>
                  </div>
                  <div style="padding:18px; border-radius:14px; background:#F8F8F7; border:1px solid #E5E7EB;">
                    <div style="font-size:15px; font-weight:700;">自动去字幕与 LOGO</div>
                    <div style="font-size:14px; color:#4B5563; margin-top:6px; line-height:1.6;">保持杯身握持手指与背景家具不变，仅替换指定人物定位框区域。</div>
                  </div>
                </div>
              </div>
              <div class="card" style="padding:28px 32px; flex:1; display:flex; flex-direction:column; justify-content:space-between;">
                <div>
                  <div style="font-size:14px; font-weight:700; color:#c86d44; margin-bottom:14px;">全链路 5 步闭环（支持「视频+声音全替」或「只克隆声音」）</div>
                  <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:14px;">
                    <div style="padding:18px; border-radius:14px; background:#F8F8F7; border:1px solid #E5E7EB;">
                      <div style="font-size:13px; font-weight:700; color:#6B7280;">STEP 03</div>
                      <div style="font-size:17px; font-weight:700; margin-top:4px;">视频主体替换</div>
                      <div style="font-size:14px; color:#4B5563; margin-top:6px;">首帧参考 + 原动作驱动，逐镜生成替换视频</div>
                    </div>
                    <div style="padding:18px; border-radius:14px; background:#F8F8F7; border:1px solid #E5E7EB;">
                      <div style="font-size:13px; font-weight:700; color:#6B7280;">STEP 04</div>
                      <div style="font-size:17px; font-weight:700; margin-top:4px;">声音克隆 / 翻唱</div>
                      <div style="font-size:14px; color:#4B5563; margin-top:6px;">Demucs 人声分离 + IndexTTS 逐句音色克隆</div>
                    </div>
                    <div style="padding:18px; border-radius:14px; background:#0A0A0A; color:#FFFFFF;">
                      <div style="font-size:13px; font-weight:700; color:#F59E0B;">STEP 05</div>
                      <div style="font-size:17px; font-weight:700; margin-top:4px;">一键合成导出</div>
                      <div style="font-size:14px; color:#D1D5DB; margin-top:6px;">自动拼接镜头与克隆音轨，支持直接加入画布</div>
                    </div>
                  </div>
                </div>
                <div style="font-size:15px; color:#6B7280;">当前正在播放：target_voice_line01.mp3 参考音色样本 & 图像替换实时扫屏对比</div>
              </div>
            </div>
          </div>
          <div class="foot"><span>SIG-DREAM · 替换工作室功能展示</span><span>Step 2–5 / 5 · 实时扫屏对比与音色演示</span></div>
        </div>
      `)
    }
  ];

  for (const p of plates) {
    await page.setContent(p.html, { waitUntil: 'load' });
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(PLATES, p.name), type: 'png' });
    console.log('Rendered plate:', p.name);
  }
  await page.close();
}

function buildReplicationV2() {
  const p1 = path.join(PLATES, 's2v2_step12.png');
  const p2 = path.join(PLATES, 's2v2_step4_libtv.png');
  const seg1 = path.join(PLATES, 'd2v2_seg1.mp4');
  const seg2 = path.join(PLATES, 'd2v2_seg2.mp4');
  const out = path.join(OUT, '02-replication-studio-demo.mp4');

  // Segment 1 (5.0s): 007 reference video (14s-19s high-energy sprint!) at x=88, y=224, w=384, h=682
  ff([
    '-loop', '1', '-t', '5.0', '-i', p1,
    '-ss', '14.0', '-t', '5.0', '-i', SRC_007_VIDEO,
    '-filter_complex',
    '[1:v]scale=384:682:flags=lanczos,fps=30,setpts=PTS-STARTPTS[vid];' +
    '[0:v][vid]overlay=88:224:shortest=1,format=yuv420p[vout];' +
    '[1:a]aresample=48000,aformat=channel_layouts=stereo,volume=0.55,afade=t=in:st=0:d=0.3,afade=t=out:st=4.5:d=0.5[aout]',
    '-map', '[vout]', '-map', '[aout]',
    '-t', '5.0', '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-c:a', 'aac', '-b:a', '192k', seg1
  ]);

  // Segment 2 (10.0s): FULL-WIDTH 16:9 LibTV Seedance 2.5 clip overlaid at x=56, y=76+142=218, w=1312, h=738
  ff([
    '-loop', '1', '-t', '10.0', '-i', p2,
    '-i', LIBTV_CLIP,
    '-filter_complex',
    '[1:v]scale=1312:738:flags=lanczos,fps=30,setpts=PTS-STARTPTS[vid];' +
    '[0:v][vid]overlay=56:218:shortest=1,format=yuv420p[vout];' +
    '[1:a]aresample=48000,aformat=channel_layouts=stereo,volume=1.15,afade=t=in:st=0:d=0.3,afade=t=out:st=9.5:d=0.5[aout]',
    '-map', '[vout]', '-map', '[aout]',
    '-t', '10.0', '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-c:a', 'aac', '-b:a', '192k', seg2
  ]);

  ff([
    '-i', seg1, '-i', seg2,
    '-filter_complex',
    '[0:v]fps=30,settb=AVTB[v0];[1:v]fps=30,settb=AVTB[v1];' +
    '[v0][v1]xfade=transition=fade:duration=0.45:offset=4.55,format=yuv420p[v];' +
    '[0:a][1:a]acrossfade=d=0.45[a]',
    '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out
  ]);
  console.log('Built upgraded Replication Demo:', out);
}

function buildReplacementV2() {
  const p1 = path.join(PLATES, 's3v2_step1.png');
  const p2 = path.join(PLATES, 's3v2_step2_wipe_plate.png');
  const origImg = path.join(RAW, 'replacement_img_1.png');
  const swapImg = path.join(RAW, 'replacement_img_2.png');
  const seg1 = path.join(PLATES, 'd3v2_seg1.mp4');
  const wipeClip = path.join(PLATES, 'd3v2_wipe_only.mp4');
  const seg2 = path.join(PLATES, 'd3v2_seg2.mp4');
  const out = path.join(OUT, '03-replacement-studio-demo.mp4');

  // Segment 1 (5.0s): live 测试视频.mp4 at x=88, y=224, w=384, h=682
  ff([
    '-loop', '1', '-t', '5.0', '-i', p1,
    '-ss', '0', '-t', '5.0', '-i', SRC_TEST_VIDEO,
    '-filter_complex',
    '[1:v]scale=384:682:flags=lanczos,fps=30,setpts=PTS-STARTPTS[vid];' +
    '[0:v][vid]overlay=88:224:shortest=1,format=yuv420p[vout];' +
    '[1:a]aresample=48000,aformat=channel_layouts=stereo,afade=t=in:st=0:d=0.3,afade=t=out:st=4.5:d=0.5[aout]',
    '-map', '[vout]', '-map', '[aout]',
    '-t', '5.0', '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-c:a', 'aac', '-b:a', '192k', seg1
  ]);

  // Build smooth 9.0s 420x746 animated Before->After Wipe-Reveal video (sweeps 0% -> 100% -> 20% -> 100% smoothly!)
  // Left side shows swapped (女主二), right side shows original, with a crisp 4px white divider bar!
  ff([
    '-loop', '1', '-t', '9.0', '-i', origImg,
    '-loop', '1', '-t', '9.0', '-i', swapImg,
    '-filter_complex',
    '[0:v]scale=420:746:force_original_aspect_ratio=increase,crop=420:746,fps=30,format=rgba[orig];' +
    '[1:v]scale=420:746:force_original_aspect_ratio=increase,crop=420:746,fps=30,format=rgba[swap];' +
    // Create a 4px white divider bar
    'color=c=white:s=4x746:r=30:d=9.0,format=rgba[bar];' +
    // Animated alpha mask on swap: x <= split(t) is opaque (255), x > split(t) is transparent (0)
    // split(t): 0..1s hold 15%, 1..3.5s sweep to 100%, 3.5..5.2s sweep back to 15%, 5.2..7.2s sweep to 100%, 7.2..9s hold 100%
    '[swap]geq=r=\'r(X,Y)\':g=\'g(X,Y)\':b=\'b(X,Y)\':a=\'if(lte(X,210+195*sin(1.4*T-1.2)),255,0)\'[swap_masked];' +
    '[orig][swap_masked]overlay=0:0[comp];' +
    '[comp][bar]overlay=x=\'210+195*sin(1.4*t-1.2)-2\':y=0,format=yuv420p[vout]',
    '-map', '[vout]', '-t', '9.0', '-c:v', 'libx264', '-crf', '16', '-preset', 'fast', wipeClip
  ]);

  // Segment 2 (9.0s): overlay wipeClip onto plate at x=120, y=76+142=218 + voice sample
  ff([
    '-loop', '1', '-t', '9.0', '-i', p2,
    '-i', wipeClip,
    '-t', '9.0', '-i', SRC_VOICE_MP3,
    '-filter_complex',
    '[0:v][1:v]overlay=120:218:shortest=1,format=yuv420p[vout];' +
    '[2:a]aresample=48000,aformat=channel_layouts=stereo,apad=whole_dur=9.0,afade=t=in:st=0:d=0.2,afade=t=out:st=8.4:d=0.6[aout]',
    '-map', '[vout]', '-map', '[aout]',
    '-t', '9.0', '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-c:a', 'aac', '-b:a', '192k', seg2
  ]);

  ff([
    '-i', seg1, '-i', seg2,
    '-filter_complex',
    '[0:v]fps=30,settb=AVTB[v0];[1:v]fps=30,settb=AVTB[v1];' +
    '[v0][v1]xfade=transition=fade:duration=0.45:offset=4.55,format=yuv420p[v];' +
    '[0:a][1:a]acrossfade=d=0.45[a]',
    '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out
  ]);
  console.log('Built upgraded Replacement Demo:', out);
}

function syncToDocs(srcMp4, docBaseName, posterTimeSec) {
  const dstMp4 = path.join(DOCS_DEMOS, `${docBaseName}.mp4`);
  const dstGif = path.join(DOCS_DEMOS, `${docBaseName}.gif`);
  const dstPoster = path.join(DOCS_DEMOS, `${docBaseName}-poster.png`);
  const pal = path.join(PLATES, `${docBaseName}_pal.png`);

  fs.copyFileSync(srcMp4, dstMp4);
  ff(['-ss', String(posterTimeSec), '-i', srcMp4, '-vframes', '1', dstPoster]);
  ff(['-i', srcMp4, '-vf', 'fps=8,scale=760:-1:flags=lanczos,palettegen=max_colors=96:stats_mode=diff', pal]);
  ff(['-i', srcMp4, '-i', pal, '-lavfi', 'fps=8,scale=760:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3', dstGif]);
  console.log('Synced docs/demos:', docBaseName);
}

const browser = await chromium.launch({
  headless: true,
  executablePath: '/Users/chenshuo/Library/Caches/ms-playwright/chromium-1255/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
});
try {
  await renderV2Plates(browser);
} finally {
  await browser.close();
}

buildReplicationV2();
buildReplacementV2();

// Sync all 3 upgraded studio demos into docs/demos/ (with GIF + poster!)
syncToDocs(path.join(OUT, '01-script-studio-demo.mp4'), '03-script-studio', 11);
syncToDocs(path.join(OUT, '02-replication-studio-demo.mp4'), '04-replication-studio', 10.5);
syncToDocs(path.join(OUT, '03-replacement-studio-demo.mp4'), '06-replacement-studio', 7.2);

console.log('ALL 3 STUDIO DEMOS V2 + DOCS SYNC COMPLETE.');
