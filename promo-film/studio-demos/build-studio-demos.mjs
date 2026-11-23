import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const ROOT = '/Users/chenshuo/.gemini/antigravity/scratch/sig-dream/promo-film/studio-demos';
const RAW = path.join(ROOT, 'raw');
const PLATES = path.join(ROOT, 'plates');
const OUT = path.join(ROOT, 'out');
fs.mkdirSync(PLATES, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

const SRC_007_VIDEO = '/Users/chenshuo/.t3/userdata/attachments/f0f05c1e-9780-4401-86c1-a80508397232-fceb44da-59b9-4e42-803f-1ab226c2cb0f-mp4.mp4';
const SRC_TEST_VIDEO = '/Users/chenshuo/1.aigc/素材角色/测试视频.mp4';
const SRC_VOICE_MP3 = '/Users/chenshuo/1.aigc/xiamen-geo-film/audio/lines/line_01.mp3';

function toDataUri(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
  const buf = fs.readFileSync(filePath);
  return `data:${mime};base64,${buf.toString('base64')}`;
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
    background: #FFFFFF; color: #0A0A0A;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "PingFang SC", "Hiragino Sans GB", "Helvetica Neue", sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .shell { width: 1920px; height: 1080px; display: flex; flex-direction: column; background: #FFFFFF; }
  .topbar {
    height: 76px; padding: 0 56px; display: flex; align-items: center; justify-content: space-between;
    border-bottom: 1px solid #EAECEF; background: #FFFFFF;
  }
  .brand { display: flex; align-items: center; gap: 14px; font-size: 20px; font-weight: 600; letter-spacing: -0.02em; }
  .brand-dot { width: 10px; height: 10px; border-radius: 50%; background: #0A0A0A; }
  .brand-sub { color: #6B7280; font-weight: 500; }
  .steps { display: flex; align-items: center; gap: 10px; }
  .step {
    padding: 8px 18px; border-radius: 999px; font-size: 16px; font-weight: 500;
    color: #6B7280; background: #F5F6F8; border: 1px solid #E5E7EB;
  }
  .step.active { color: #FFFFFF; background: #0A0A0A; border-color: #0A0A0A; }
  .step.done { color: #0A0A0A; background: #FFFFFF; border-color: #D1D5DB; }
  .badge {
    padding: 7px 14px; border-radius: 999px; font-size: 14px; font-weight: 600;
    color: #0A0A0A; background: #F3F4F6; border: 1px solid #E5E7EB;
  }
  .main { flex: 1; padding: 40px 56px 44px; display: flex; flex-direction: column; gap: 28px; }
  .hero-head { display: flex; align-items: flex-end; justify-content: space-between; }
  .kicker { font-size: 15px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: #6B7280; margin-bottom: 8px; }
  h1 { font-size: 40px; font-weight: 700; letter-spacing: -0.03em; line-height: 1.15; color: #0A0A0A; }
  .meta-pills { display: flex; gap: 10px; }
  .pill {
    padding: 8px 16px; border-radius: 10px; font-size: 15px; font-weight: 500;
    background: #F7F7F8; border: 1px solid #E5E7EB; color: #374151;
  }
  .pill strong { color: #0A0A0A; font-weight: 600; }
  .card {
    background: #FAFAFB; border: 1px solid #E5E7EB; border-radius: 20px; overflow: hidden;
  }
  .slot-box {
    background: #0B0B0D; border-radius: 18px; border: 1px solid #E5E7EB;
    box-shadow: 0 20px 50px rgba(0,0,0,0.08);
  }
  .foot {
    height: 48px; padding: 0 56px; border-top: 1px solid #F0F1F3;
    display: flex; align-items: center; justify-content: space-between;
    font-size: 14px; color: #9CA3AF;
  }
</style>
</head>
<body>${bodyHtml}</body>
</html>`;
}

async function renderPlates(browser) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });

  const imgKaeser = toDataUri(path.join(RAW, 'script_0_%E5%87%AF%E7%91%9F.png'));
  const imgLinna = toDataUri(path.join(RAW, 'script_1_Linna.png'));
  const imgLin = toDataUri(path.join(RAW, 'script_2_Lin.png'));
  const imgChurch = toDataUri(path.join(RAW, 'script_3_%E6%95%99%E5%A0%82.png'));
  const imgCorridor = toDataUri(path.join(RAW, 'script_4_%E9%95%BF%E5%BB%8A.png'));
  const imgFire = toDataUri(path.join(RAW, 'script_5_%E7%81%AB%E7%81%BE%E7%8E%B0%E5%9C%BA.png'));
  const imgWatch = toDataUri(path.join(RAW, 'script_6_%E6%80%80%E8%A1%A8.png'));

  const repChar = toDataUri(path.join(RAW, 'replication_asset_1.png'));
  const repScene = toDataUri(path.join(RAW, 'replication_asset_2.png'));

  const swapRef = toDataUri(path.join(RAW, 'replacement_img_0.png'));
  const swapOrig = toDataUri(path.join(RAW, 'replacement_img_1.png'));
  const swapOut = toDataUri(path.join(RAW, 'replacement_img_2.png'));

  const plates = [
    // ================= STUDIO 1: SCRIPT STUDIO =================
    {
      name: 's1_step1_script.png',
      html: baseHtml(`
        <div class="shell">
          <div class="topbar">
            <div class="brand"><div class="brand-dot"></div>SIG-DREAM <span class="brand-sub">/ 剧本工作室 Script Studio</span></div>
            <div class="steps">
              <div class="step active">1 原始剧本</div>
              <div class="step">2 素材设定</div>
              <div class="step">3 分集视频</div>
            </div>
            <div class="badge">v0.19.0 · 实测录制</div>
          </div>
          <div class="main">
            <div class="hero-head">
              <div>
                <div class="kicker">STEP 01 · SCRIPT IMPORT & STRUCTURE PARSING</div>
                <h1>导入《我记得你来过》原稿，自动拆解角色、场景与道具</h1>
              </div>
              <div class="meta-pills">
                <div class="pill">模型：<strong>DeepSeek V4 Flash</strong></div>
                <div class="pill">结果：<strong>3 角色 · 3 场景 · 1 道具</strong></div>
              </div>
            </div>
            <div style="display:grid; grid-template-columns: 1.25fr 0.75fr; gap: 28px; flex: 1; min-height: 0;">
              <div class="card" style="padding: 34px 38px; display:flex; flex-direction:column; gap:18px;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                  <div style="font-size:20px; font-weight:700;">## 《我记得你来过》｜小说式剧情稿</div>
                  <div class="pill" style="background:#ECFDF5; border-color:#A7F3D0; color:#065F46;">已按原剧本结构导入 · 未扩写</div>
                </div>
                <div style="font-size:20px; line-height:1.85; color:#374151;">
                  <p style="margin-bottom:16px;">男主走进那座教堂，坐在教堂的椅子上进行祷告，手里握着一个怀表，怀表上是女主的照片，正要回头走的时候背景亮出白光，特写男主面部展示惊讶的表情。</p>
                  <p style="margin-bottom:16px;">祭坛前的光亮起来，先是一片冷白，随后慢慢显出一个女人的身影。她有熟悉的银白色长发，穿着浅色长裙，像是从很远的地方穿过雾气，终于回到了他面前。</p>
                  <p style="margin-bottom:16px; color:#0A0A0A; font-weight:600;">“You’re late again, love.”（你又迟到了，亲爱的。）</p>
                  <p style="margin-bottom:16px;">那天，他们在一条长廊里相遇。她在前方走着，听到男主喊她（Linna）从前方回过头，笑容明亮得像整座空间都跟着暖了起来……</p>
                  <p>最初只是远处墙面映出一片红。等他们看清时，火已经沿着拱廊烧了过来。浓烟隔在两人之间，Lin 在一旁劝诫拦住男主想要跑进火里救女主……</p>
                </div>
              </div>
              <div class="card" style="padding: 32px; display:flex; flex-direction:column; gap:18px; background:#FFFFFF;">
                <div style="font-size:18px; font-weight:700;">自动提取资产清单</div>
                <div style="display:flex; flex-direction:column; gap:12px;">
                  <div style="padding:16px 20px; border-radius:14px; background:#F7F7F8; border:1px solid #E5E7EB;">
                    <div style="font-size:13px; color:#6B7280; font-weight:600;">角色 CHARACTERS · 3</div>
                    <div style="font-size:18px; font-weight:600; margin-top:4px;">凯瑟（主角） · Linna（主角） · Lin（配角）</div>
                  </div>
                  <div style="padding:16px 20px; border-radius:14px; background:#F7F7F8; border:1px solid #E5E7EB;">
                    <div style="font-size:13px; color:#6B7280; font-weight:600;">场景 SCENES · 3</div>
                    <div style="font-size:18px; font-weight:600; margin-top:4px;">教堂（完好/崩塌） · 室内长廊 · 火灾现场</div>
                  </div>
                  <div style="padding:16px 20px; border-radius:14px; background:#F7F7F8; border:1px solid #E5E7EB;">
                    <div style="font-size:13px; color:#6B7280; font-weight:600;">关键道具 PROPS · 1</div>
                    <div style="font-size:18px; font-weight:600; margin-top:4px;">复古黄铜怀表（内嵌女主照片）</div>
                  </div>
                  <div style="padding:18px 20px; border-radius:14px; background:#0A0A0A; color:#FFFFFF; margin-top:8px;">
                    <div style="font-size:13px; color:#9CA3AF;">输出规格</div>
                    <div style="font-size:18px; font-weight:600; margin-top:4px;">第 1 集 · 16 段 Seedance 2.5 分镜</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div class="foot"><span>SIG-DREAM · 剧本工作室真实工作流演示</span><span>Step 1 / 3 · 原始剧本导入</span></div>
        </div>
      `)
    },
    {
      name: 's1_step2_assets.png',
      html: baseHtml(`
        <div class="shell">
          <div class="topbar">
            <div class="brand"><div class="brand-dot"></div>SIG-DREAM <span class="brand-sub">/ 剧本工作室 Script Studio</span></div>
            <div class="steps">
              <div class="step done">✓ 原始剧本</div>
              <div class="step active">2 素材设定</div>
              <div class="step">3 分集视频</div>
            </div>
            <div class="badge">全部 8/8 张设定图就绪 · 0 缺图</div>
          </div>
          <div class="main" style="gap:22px;">
            <div class="hero-head">
              <div>
                <div class="kicker">STEP 02 · CHARACTER, SCENE & PROP SHEETS</div>
                <h1>上传已有三视图 + AI 一键补齐缺图，锁定全片视觉一致性</h1>
              </div>
              <div class="meta-pills">
                <div class="pill">角色：<strong>3/3 完成</strong></div>
                <div class="pill">场景：<strong>3/3 完成</strong></div>
                <div class="pill">道具：<strong>1/1 完成</strong></div>
              </div>
            </div>
            <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:20px; height: 370px;">
              <div class="card" style="display:flex; flex-direction:column;">
                <div style="flex:1; background:#FFFFFF; overflow:hidden;"><img src="${imgKaeser}" style="width:100%; height:100%; object-fit:cover;" /></div>
                <div style="padding:12px 18px; display:flex; justify-content:space-between; align-items:center; background:#FFFFFF; border-top:1px solid #EAECEF;">
                  <span style="font-weight:700; font-size:17px;">凯瑟 · 主角</span><span style="font-size:13px; color:#6B7280;">AI 生成 2K 三视图</span>
                </div>
              </div>
              <div class="card" style="display:flex; flex-direction:column;">
                <div style="flex:1; background:#FFFFFF; overflow:hidden;"><img src="${imgLinna}" style="width:100%; height:100%; object-fit:cover;" /></div>
                <div style="padding:12px 18px; display:flex; justify-content:space-between; align-items:center; background:#FFFFFF; border-top:1px solid #EAECEF;">
                  <span style="font-weight:700; font-size:17px;">Linna · 主角</span><span style="font-size:13px; color:#6B7280;">自定义上传三视图</span>
                </div>
              </div>
              <div class="card" style="display:flex; flex-direction:column;">
                <div style="flex:1; background:#FFFFFF; overflow:hidden;"><img src="${imgLin}" style="width:100%; height:100%; object-fit:cover;" /></div>
                <div style="padding:12px 18px; display:flex; justify-content:space-between; align-items:center; background:#FFFFFF; border-top:1px solid #EAECEF;">
                  <span style="font-weight:700; font-size:17px;">Lin · 虚幻配角</span><span style="font-size:13px; color:#6B7280;">自定义白西装焰发</span>
                </div>
              </div>
            </div>
            <div style="display:grid; grid-template-columns: repeat(4, 1fr); gap:20px; height: 295px;">
              <div class="card" style="display:flex; flex-direction:column;">
                <div style="flex:1; overflow:hidden;"><img src="${imgChurch}" style="width:100%; height:100%; object-fit:cover;" /></div>
                <div style="padding:10px 16px; background:#FFFFFF; border-top:1px solid #EAECEF; font-size:15px; font-weight:600;">场景 · 雾灰教堂</div>
              </div>
              <div class="card" style="display:flex; flex-direction:column;">
                <div style="flex:1; overflow:hidden;"><img src="${imgCorridor}" style="width:100%; height:100%; object-fit:cover;" /></div>
                <div style="padding:10px 16px; background:#FFFFFF; border-top:1px solid #EAECEF; font-size:15px; font-weight:600;">场景 · 记忆长廊</div>
              </div>
              <div class="card" style="display:flex; flex-direction:column;">
                <div style="flex:1; overflow:hidden;"><img src="${imgFire}" style="width:100%; height:100%; object-fit:cover;" /></div>
                <div style="padding:10px 16px; background:#FFFFFF; border-top:1px solid #EAECEF; font-size:15px; font-weight:600;">场景 · 火灾现场</div>
              </div>
              <div class="card" style="display:flex; flex-direction:column;">
                <div style="flex:1; overflow:hidden;"><img src="${imgWatch}" style="width:100%; height:100%; object-fit:cover;" /></div>
                <div style="padding:10px 16px; background:#FFFFFF; border-top:1px solid #EAECEF; font-size:15px; font-weight:600;">道具 · 复古怀表</div>
              </div>
            </div>
          </div>
          <div class="foot"><span>SIG-DREAM · 剧本工作室真实工作流演示</span><span>Step 2 / 3 · 全套素材资产定型</span></div>
        </div>
      `)
    },
    {
      // Video slot exact box: x=680, y=224, w=1184, h=666 (16:9!)
      name: 's1_step3_video_plate.png',
      html: baseHtml(`
        <div class="shell">
          <div class="topbar">
            <div class="brand"><div class="brand-dot"></div>SIG-DREAM <span class="brand-sub">/ 剧本工作室 Script Studio</span></div>
            <div class="steps">
              <div class="step done">✓ 原始剧本</div>
              <div class="step done">✓ 素材设定</div>
              <div class="step active">3 分集视频</div>
            </div>
            <div class="badge">OnionCreate · Seedance 2.5 实拍成片</div>
          </div>
          <div class="main" style="position:relative; padding: 32px 56px;">
            <div class="hero-head" style="margin-bottom:0;">
              <div>
                <div class="kicker">STEP 03 · 16-CLIP STORYBOARD & SEEDANCE 2.5 GENERATION</div>
                <h1 style="font-size:36px;">自动绑定 @角色/@道具 参考图，一键生成电影级分镜成片</h1>
              </div>
              <div class="meta-pills">
                <div class="pill"><strong>片段01</strong> · 10.0s · 1280×720</div>
                <div class="pill">全集：<strong>16 段分镜</strong></div>
              </div>
            </div>
            <div style="position:absolute; left:56px; top:148px; width:592px; height:666px; display:flex; flex-direction:column; gap:16px;">
              <div class="card" style="padding:22px 24px; background:#FFFFFF; display:flex; flex-direction:column; gap:12px;">
                <div style="display:flex; gap:8px; flex-wrap:wrap;">
                  <span class="pill" style="padding:5px 12px; font-size:14px;">@凯瑟</span>
                  <span class="pill" style="padding:5px 12px; font-size:14px;">@Linna</span>
                  <span class="pill" style="padding:5px 12px; font-size:14px;">@Lin</span>
                  <span class="pill" style="padding:5px 12px; font-size:14px;">@教堂</span>
                  <span class="pill" style="padding:5px 12px; font-size:14px;">@怀表</span>
                </div>
                <div style="font-size:16px; line-height:1.7; color:#374151;">
                  <div style="font-weight:700; color:#0A0A0A; margin-bottom:6px;">镜头1（0–6s）中景 · 平视 · 固定镜头</div>
                  凯瑟独自坐在教堂长椅上，右手握着打开的黄铜怀表，表盖内嵌 Linna 的银发照片，缓缓抬头望向祭坛。
                  <div style="font-weight:700; color:#0A0A0A; margin:12px 0 6px;">镜头2（6–10s）特写 · 祭坛强光</div>
                  刚转身迈出一步，祭坛方向突然亮起冷白色强光，凯瑟停住脚步，神情惊讶。
                </div>
              </div>
              <div class="card" style="padding:18px 22px; background:#FAFAFB; flex:1; display:flex; flex-direction:column; justify-content:space-between;">
                <div style="font-size:14px; font-weight:700; color:#6B7280;">第 1 集分镜时间轴（共 16 段）</div>
                <div style="display:grid; grid-template-columns: repeat(4, 1fr); gap:8px; margin-top:8px;">
                  <div style="padding:10px; border-radius:10px; background:#0A0A0A; color:#FFF; font-size:13px; font-weight:600;">片段01 · 10s ✓</div>
                  <div style="padding:10px; border-radius:10px; background:#FFF; border:1px solid #E5E7EB; font-size:13px;">片段02 · 10s</div>
                  <div style="padding:10px; border-radius:10px; background:#FFF; border:1px solid #E5E7EB; font-size:13px;">片段03 · 10s</div>
                  <div style="padding:10px; border-radius:10px; background:#FFF; border:1px solid #E5E7EB; font-size:13px;">片段04 · 5s</div>
                  <div style="padding:10px; border-radius:10px; background:#FFF; border:1px solid #E5E7EB; font-size:13px;">片段05 · 12s</div>
                  <div style="padding:10px; border-radius:10px; background:#FFF; border:1px solid #E5E7EB; font-size:13px;">片段06 · 10s</div>
                  <div style="padding:10px; border-radius:10px; background:#FFF; border:1px solid #E5E7EB; font-size:13px;">片段07 · 11s</div>
                  <div style="padding:10px; border-radius:10px; background:#FFF; border:1px solid #E5E7EB; font-size:13px;">片段08–16 …</div>
                </div>
              </div>
            </div>
            <div class="slot-box" style="position:absolute; left:680px; top:148px; width:1184px; height:666px;"></div>
          </div>
          <div class="foot"><span>SIG-DREAM · 剧本工作室真实工作流演示</span><span>Step 3 / 3 · Seedance 2.5 真实生成片段播放中</span></div>
        </div>
      `)
    },

    // ================= STUDIO 2: REPLICATION STUDIO =================
    {
      // Step 1-2 plate with left 9:16 source video slot: x=100, y=224, w=384, h=682
      name: 's2_step12_analysis_plate.png',
      html: baseHtml(`
        <div class="shell">
          <div class="topbar">
            <div class="brand"><div class="brand-dot"></div>SIG-DREAM <span class="brand-sub">/ 复刻工作室 Replication Studio</span></div>
            <div class="steps">
              <div class="step done">1 上传原片</div>
              <div class="step active">2 原片分析</div>
              <div class="step">3 素材设定</div>
              <div class="step">4 分镜与视频</div>
            </div>
            <div class="badge">9:16 竖屏复刻 · GPT-4o 拆解</div>
          </div>
          <div class="main" style="position:relative; padding: 32px 56px;">
            <div class="hero-head">
              <div>
                <div class="kicker">STEP 01–02 · REFERENCE VIDEO INTAKE & AI SHOT BREAKDOWN</div>
                <h1 style="font-size:36px;">上传动作参考原片，自动拆解运镜、人物与分段复刻计划</h1>
              </div>
              <div class="meta-pills">
                <div class="pill">原片：<strong>007_动作参考 · 720×1280</strong></div>
                <div class="pill">分析模型：<strong>APIMart · GPT-4o</strong></div>
              </div>
            </div>
            <div class="slot-box" style="position:absolute; left:88px; top:148px; width:384px; height:682px;"></div>
            <div style="position:absolute; left:520px; top:148px; right:56px; height:682px; display:flex; flex-direction:column; gap:20px;">
              <div class="card" style="padding:28px 32px; background:#FFFFFF;">
                <div style="font-size:14px; font-weight:700; color:#6B7280; margin-bottom:8px;">原片概括 · 类型：剧情动作</div>
                <div style="font-size:26px; font-weight:700; color:#0A0A0A;">一名穿西装的男子从建筑物内走出，走下台阶。</div>
                <div style="font-size:17px; color:#4B5563; margin-top:12px; line-height:1.7;">
                  机位：中景固定侧拍，50mm 标准焦段浅景深，焦点锁定人物面部与步伐节奏，画面含完整环境音轨。
                </div>
              </div>
              <div style="display:grid; grid-template-columns: 1fr 1fr; gap:20px;">
                <div class="card" style="padding:24px 28px;">
                  <div style="font-size:14px; font-weight:700; color:#6B7280;">提取人物 · 1</div>
                  <div style="font-size:20px; font-weight:700; margin-top:8px;">c1 · 原片主角（西装男子）</div>
                  <div style="font-size:15px; color:#4B5563; margin-top:6px;">可在下一步替换为任意自定义新角色</div>
                </div>
                <div class="card" style="padding:24px 28px;">
                  <div style="font-size:14px; font-weight:700; color:#6B7280;">提取场景 · 1</div>
                  <div style="font-size:20px; font-weight:700; margin-top:8px;">建筑物入口外的台阶区域</div>
                  <div style="font-size:15px; color:#4B5563; margin-top:6px;">自动保留原片光影色调与空间构图</div>
                </div>
              </div>
              <div class="card" style="padding:24px 28px; flex:1; background:#FAFAFB;">
                <div style="font-size:14px; font-weight:700; color:#6B7280; margin-bottom:14px;">自动分段复刻计划（4 段 · 全部审核通过）</div>
                <div style="display:grid; grid-template-columns: repeat(4, 1fr); gap:12px;">
                  <div style="padding:16px; border-radius:14px; background:#0A0A0A; color:#FFF;">
                    <div style="font-size:16px; font-weight:700;">clip-1</div>
                    <div style="font-size:13px; color:#D1D5DB; margin-top:4px;">0:00–0:15 · 15s</div>
                    <div style="font-size:12px; color:#34D399; margin-top:8px;">✓ 审核通过 · 已出片</div>
                  </div>
                  <div style="padding:16px; border-radius:14px; background:#FFF; border:1px solid #E5E7EB;">
                    <div style="font-size:16px; font-weight:700;">clip-2</div>
                    <div style="font-size:13px; color:#6B7280; margin-top:4px;">0:15–0:30 · 15s</div>
                    <div style="font-size:12px; color:#059669; margin-top:8px;">✓ 审核通过</div>
                  </div>
                  <div style="padding:16px; border-radius:14px; background:#FFF; border:1px solid #E5E7EB;">
                    <div style="font-size:16px; font-weight:700;">clip-3</div>
                    <div style="font-size:13px; color:#6B7280; margin-top:4px;">0:30–0:45 · 15s</div>
                    <div style="font-size:12px; color:#059669; margin-top:8px;">✓ 审核通过</div>
                  </div>
                  <div style="padding:16px; border-radius:14px; background:#FFF; border:1px solid #E5E7EB;">
                    <div style="font-size:16px; font-weight:700;">clip-4</div>
                    <div style="font-size:13px; color:#6B7280; margin-top:4px;">0:45–0:47.9 · 2.9s</div>
                    <div style="font-size:12px; color:#059669; margin-top:8px;">✓ 审核通过</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div class="foot"><span>SIG-DREAM · 复刻工作室真实工作流演示</span><span>Step 1–2 / 4 · 原片拆解完成</span></div>
        </div>
      `)
    },
    {
      name: 's2_step3_assets.png',
      html: baseHtml(`
        <div class="shell">
          <div class="topbar">
            <div class="brand"><div class="brand-dot"></div>SIG-DREAM <span class="brand-sub">/ 复刻工作室 Replication Studio</span></div>
            <div class="steps">
              <div class="step done">✓ 上传原片</div>
              <div class="step done">✓ 原片分析</div>
              <div class="step active">3 素材设定</div>
              <div class="step">4 分镜与视频</div>
            </div>
            <div class="badge">主角替换 · 焰发白西装男主</div>
          </div>
          <div class="main">
            <div class="hero-head">
              <div>
                <div class="kicker">STEP 03 · CHARACTER SWAP & ENVIRONMENT LOCK</div>
                <h1>改写主角外貌为「焰发白西装男主」，一键生成定妆与场景参考</h1>
              </div>
              <div class="meta-pills">
                <div class="pill">角色替换：<strong>西装男子 → 焰发白西装男主</strong></div>
                <div class="pill">画幅：<strong>9:16 竖屏</strong></div>
              </div>
            </div>
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:36px; flex:1; min-height:0;">
              <div class="card" style="display:flex; background:#FFFFFF;">
                <div style="width:410px; height:100%; overflow:hidden; background:#F3F4F6;"><img src="${repChar}" style="width:100%; height:100%; object-fit:cover;" /></div>
                <div style="flex:1; padding:32px; display:flex; flex-direction:column; justify-content:center; gap:14px;">
                  <div class="pill" style="align-self:flex-start;">角色 · 替换原片 c1</div>
                  <div style="font-size:28px; font-weight:700;">焰发白西装男主</div>
                  <div style="font-size:17px; color:#4B5563; line-height:1.75;">
                    修身纯白西装与白色皮鞋，面部被纯黑虚幻轮廓笼罩，蓬松金色卷发外缘缭绕电光蓝色火焰与能量光晕。
                  </div>
                </div>
              </div>
              <div class="card" style="display:flex; background:#FFFFFF;">
                <div style="width:410px; height:100%; overflow:hidden; background:#F3F4F6;"><img src="${repScene}" style="width:100%; height:100%; object-fit:cover;" /></div>
                <div style="flex:1; padding:32px; display:flex; flex-direction:column; justify-content:center; gap:14px;">
                  <div class="pill" style="align-self:flex-start;">场景 · 保留原片光影</div>
                  <div style="font-size:28px; font-weight:700;">建筑物外台阶</div>
                  <div style="font-size:17px; color:#4B5563; line-height:1.75;">
                    还原原片古典建筑入口外的石阶结构与暖阳斜射光影，确保角色下台阶动作自然衔接。
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div class="foot"><span>SIG-DREAM · 复刻工作室真实工作流演示</span><span>Step 3 / 4 · 替换角色与场景设定图就绪</span></div>
        </div>
      `)
    },
    {
      // Step 4 side-by-side LIVE videos:
      // Left (Original 007): x=228, y=224, w=384, h=682
      // Right (Seedance 2.5 Replicated): x=788, y=224, w=384, h=682
      // Info column: x=1230..1864
      name: 's2_step4_compare_plate.png',
      html: baseHtml(`
        <div class="shell">
          <div class="topbar">
            <div class="brand"><div class="brand-dot"></div>SIG-DREAM <span class="brand-sub">/ 复刻工作室 Replication Studio</span></div>
            <div class="steps">
              <div class="step done">✓ 上传原片</div>
              <div class="step done">✓ 原片分析</div>
              <div class="step done">✓ 素材设定</div>
              <div class="step active">4 分镜与视频</div>
            </div>
            <div class="badge">Seedance 2.5 · 原片 vs 复刻实拍对比</div>
          </div>
          <div class="main" style="position:relative; padding: 30px 56px;">
            <div class="hero-head">
              <div>
                <div class="kicker">STEP 04 · SIDE-BY-SIDE LIVE REPLICATION OUTPUT</div>
                <h1 style="font-size:36px;">动作与机位精准复刻，角色彻底替换为「焰发白西装男主」</h1>
              </div>
              <div class="meta-pills">
                <div class="pill"><strong>clip-1</strong> · 720×1280 · 15.0s</div>
                <div class="pill">状态：<strong>4/4 审核通过</strong></div>
              </div>
            </div>
            <div style="position:absolute; left:140px; top:142px; width:384px; text-align:center; font-size:16px; font-weight:700; color:#6B7280;">原片参考 · 007_动作参考</div>
            <div class="slot-box" style="position:absolute; left:140px; top:176px; width:384px; height:682px;"></div>

            <div style="position:absolute; left:556px; top:480px; width:64px; height:64px; border-radius:50%; background:#0A0A0A; color:#FFF; display:flex; align-items:center; justify-content:center; font-size:28px; font-weight:700;">→</div>

            <div style="position:absolute; left:652px; top:142px; width:384px; text-align:center; font-size:16px; font-weight:700; color:#0A0A0A;">Seedance 2.5 复刻成片 · clip-1</div>
            <div class="slot-box" style="position:absolute; left:652px; top:176px; width:384px; height:682px;"></div>

            <div style="position:absolute; left:1092px; top:176px; right:56px; height:682px; display:flex; flex-direction:column; gap:18px;">
              <div class="card" style="padding:26px 28px; background:#FFFFFF;">
                <div style="font-size:13px; font-weight:700; color:#059669; margin-bottom:8px;">✓ 自动审核通过 · CLIP-1</div>
                <div style="font-size:20px; font-weight:700; margin-bottom:10px;">导演意图与分镜提示词</div>
                <div style="font-size:16px; color:#4B5563; line-height:1.75;">
                  中景固定侧拍，50mm 标准焦段浅景深。焰发白西装男主从建筑物内走出，走下阳光洒落的石阶，身侧蓝色烈焰微光随步伐律动。
                </div>
              </div>
              <div class="card" style="padding:24px 28px; flex:1; display:flex; flex-direction:column; justify-content:space-between;">
                <div>
                  <div style="font-size:14px; font-weight:700; color:#6B7280; margin-bottom:12px;">复刻维度核验</div>
                  <div style="display:flex; flex-direction:column; gap:12px; font-size:16px; color:#111827;">
                    <div>• <strong>动作轨迹</strong>：出入口下台阶步伐节奏同步</div>
                    <div>• <strong>新角色一致</strong>：白西装 + 黑轮廓面 + 蓝金烈焰发</div>
                    <div>• <strong>环境光影</strong>：秋叶石阶与斜射暖光自然融合</div>
                    <div>• <strong>一键同步画布</strong>：支持继续多节点精修与导出</div>
                  </div>
                </div>
                <div style="padding:14px 18px; border-radius:12px; background:#0A0A0A; color:#FFF; font-size:15px; font-weight:600; text-align:center;">
                  OnionCreate · 超稳满血 Seedance 2.5 实拍输出
                </div>
              </div>
            </div>
          </div>
          <div class="foot"><span>SIG-DREAM · 复刻工作室真实工作流演示</span><span>Step 4 / 4 · 原片与复刻成片同步播放</span></div>
        </div>
      `)
    },

    // ================= STUDIO 3: REPLACEMENT STUDIO =================
    {
      // Step 1 plate with source video slot: x=88, y=224, w=384, h=682
      name: 's3_step1_assets_plate.png',
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
          <div class="main" style="position:relative; padding: 32px 56px;">
            <div class="hero-head">
              <div>
                <div class="kicker">STEP 01 · PERSON DETECTION, TARGET CHARACTER & VOICE BINDING</div>
                <h1 style="font-size:36px;">自动识别原片人物，上传「女主二」三视图与参考音色</h1>
              </div>
              <div class="meta-pills">
                <div class="pill">原片：<strong>测试视频.mp4 · 15.1s</strong></div>
                <div class="pill">识别结果：<strong>原视频人物 1</strong></div>
              </div>
            </div>
            <div class="slot-box" style="position:absolute; left:88px; top:148px; width:384px; height:682px;"></div>
            <div style="position:absolute; left:520px; top:148px; right:56px; height:682px; display:flex; flex-direction:column; gap:20px;">
              <div class="card" style="padding:24px; background:#FFFFFF; display:flex; gap:24px; align-items:center; height: 420px;">
                <div style="width:540px; height:100%; border-radius:14px; overflow:hidden; border:1px solid #E5E7EB;"><img src="${swapRef}" style="width:100%; height:100%; object-fit:cover;" /></div>
                <div style="flex:1; display:flex; flex-direction:column; gap:12px;">
                  <div class="pill" style="align-self:flex-start;">目标替换人物</div>
                  <div style="font-size:28px; font-weight:700;">女主二 · 三视图</div>
                  <div style="font-size:17px; color:#4B5563; line-height:1.7;">
                    黑短发橙挑染 + 橙色发卡 + 黑色橙边无袖背心。直接拖入人物定位框即可保持姿态、手部与持杯遮挡关系不变。
                  </div>
                </div>
              </div>
              <div class="card" style="padding:26px 30px; flex:1; display:flex; align-items:center; justify-content:space-between;">
                <div>
                  <div style="font-size:14px; font-weight:700; color:#6B7280;">目标声音参考 · IndexTTS</div>
                  <div style="font-size:22px; font-weight:700; margin-top:6px;">target_voice_line01.mp3（9.4s 干声参考）</div>
                  <div style="font-size:16px; color:#4B5563; margin-top:6px;">支持 Demucs 人声分离、逐句声音克隆与原背景音轨保留</div>
                </div>
                <div class="pill" style="background:#0A0A0A; color:#FFF; border-color:#0A0A0A; padding:12px 22px; font-size:16px;">已绑定就绪 ✓</div>
              </div>
            </div>
          </div>
          <div class="foot"><span>SIG-DREAM · 替换工作室真实工作流演示</span><span>Step 1 / 5 · 人物识别与目标资产装载</span></div>
        </div>
      `)
    },
    {
      name: 's3_step2_swap_compare.png',
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
            <div class="badge">OpenLux · gpt-image-2 实测成片</div>
          </div>
          <div class="main" style="position:relative; padding: 30px 56px;">
            <div class="hero-head">
              <div>
                <div class="kicker">STEP 02 · DRAG-TO-BOX CHARACTER KEYFRAME REPLACEMENT</div>
                <h1 style="font-size:36px;">拖拽人物卡到定位框，一键生成像素级自然替换关键帧</h1>
              </div>
              <div class="meta-pills">
                <div class="pill">关键帧：<strong>1/1 已完成</strong></div>
                <div class="pill">模式：<strong>完整人物 · 去字幕/LOGO</strong></div>
              </div>
            </div>
            <div style="display:grid; grid-template-columns: 384px 64px 384px 1fr; gap:24px; align-items:center; flex:1; margin-top:4px;">
              <div style="display:flex; flex-direction:column; gap:10px; height:710px;">
                <div style="text-align:center; font-size:16px; font-weight:700; color:#6B7280;">原片首帧（定位框 A）</div>
                <div style="flex:1; border-radius:18px; overflow:hidden; border:3px solid #EF4444; position:relative; box-shadow:0 16px 40px rgba(0,0,0,0.08);">
                  <img src="${swapOrig}" style="width:100%; height:100%; object-fit:cover;" />
                  <div style="position:absolute; left:12px; bottom:12px; padding:6px 12px; border-radius:8px; background:rgba(10,10,10,0.8); color:#FFF; font-size:13px; font-weight:600;">人物 A · 完整人物</div>
                </div>
              </div>
              <div style="width:64px; height:64px; border-radius:50%; background:#0A0A0A; color:#FFF; display:flex; align-items:center; justify-content:center; font-size:28px; font-weight:700;">→</div>
              <div style="display:flex; flex-direction:column; gap:10px; height:710px;">
                <div style="text-align:center; font-size:16px; font-weight:700; color:#0A0A0A;">替换关键帧成片（女主二）</div>
                <div style="flex:1; border-radius:18px; overflow:hidden; border:2px solid #0A0A0A; position:relative; box-shadow:0 20px 50px rgba(0,0,0,0.12);">
                  <img src="${swapOut}" style="width:100%; height:100%; object-fit:cover;" />
                  <div style="position:absolute; left:12px; bottom:12px; padding:6px 12px; border-radius:8px; background:#059669; color:#FFF; font-size:13px; font-weight:600;">✓ OpenLux gpt-image-2 生成</div>
                </div>
              </div>
              <div style="display:flex; flex-direction:column; gap:18px; height:676px; justify-content:center;">
                <div class="card" style="padding:26px 28px; background:#FFFFFF;">
                  <div style="font-size:14px; font-weight:700; color:#059669; margin-bottom:8px;">✓ 替换质量亮点</div>
                  <div style="display:flex; flex-direction:column; gap:12px; font-size:17px; color:#111827; line-height:1.6;">
                    <div>• <strong>身份与穿搭还原</strong>：黑短发橙挑染、橙色发卡、黑底橙线背心精准对齐</div>
                    <div>• <strong>遮挡与手部自然</strong>：持杯手指、杯身反光与唇部遮挡关系完整保留</div>
                    <div>• <strong>环境光一致</strong>：室内光影与背景家具零畸变</div>
                  </div>
                </div>
                <div class="card" style="padding:24px 28px; background:#FAFAFB;">
                  <div style="font-size:14px; font-weight:700; color:#6B7280; margin-bottom:10px;">后续流水线（Step 3 → Step 5）</div>
                  <div style="font-size:16px; color:#374151; line-height:1.7;">
                    <strong>Step 3 视频替换</strong>（Scail V1：首帧参考 + 原动作驱动）→ <strong>Step 4 声音克隆</strong>（Demucs 分离 + IndexTTS 音色克隆）→ <strong>Step 5 一键合成导出 / 加入画布</strong>。
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div class="foot"><span>SIG-DREAM · 替换工作室真实工作流演示</span><span>Step 2–5 / 5 · 替换关键帧实拍成果展示</span></div>
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

function ff(args) {
  execFileSync('ffmpeg', ['-y', '-v', 'error', ...args], { stdio: 'inherit' });
}

function buildDemo1() {
  const p1 = path.join(PLATES, 's1_step1_script.png');
  const p2 = path.join(PLATES, 's1_step2_assets.png');
  const p3 = path.join(PLATES, 's1_step3_video_plate.png');
  const clip = path.join(RAW, 'script_clip01.mp4');
  const seg1 = path.join(PLATES, 'd1_seg1.mp4');
  const seg2 = path.join(PLATES, 'd1_seg2.mp4');
  const seg3 = path.join(PLATES, 'd1_seg3.mp4');
  const out = path.join(OUT, '01-script-studio-demo.mp4');

  // Segment 1: 3.5s static + subtle silent audio
  ff(['-loop', '1', '-t', '3.5', '-i', p1, '-f', 'lavfi', '-t', '3.5', '-i', 'anullsrc=r=48000:cl=stereo',
    '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-c:a', 'aac', '-b:a', '192k', seg1]);

  // Segment 2: 4.5s assets showcase
  ff(['-loop', '1', '-t', '4.5', '-i', p2, '-f', 'lavfi', '-t', '4.5', '-i', 'anullsrc=r=48000:cl=stereo',
    '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-c:a', 'aac', '-b:a', '192k', seg2]);

  // Segment 3: 10.0s live Seedance 2.5 clip overlaid at (680, 224) w=1184 h=666 (note topbar=76 + main top=148 = 224!)
  ff([
    '-loop', '1', '-t', '10.0', '-i', p3,
    '-i', clip,
    '-filter_complex',
    '[1:v]scale=1184:666:flags=lanczos,fps=30,setpts=PTS-STARTPTS[vid];[0:v][vid]overlay=680:224:shortest=1,format=yuv420p[vout];[1:a]aresample=48000,aformat=channel_layouts=stereo,afade=t=in:st=0:d=0.3,afade=t=out:st=9.5:d=0.5[aout]',
    '-map', '[vout]', '-map', '[aout]',
    '-t', '10.0', '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-c:a', 'aac', '-b:a', '192k', seg3
  ]);

  // Concat with smooth 0.45s crossfades
  ff([
    '-i', seg1, '-i', seg2, '-i', seg3,
    '-filter_complex',
    '[0:v]fps=30,settb=AVTB[v0];[1:v]fps=30,settb=AVTB[v1];[2:v]fps=30,settb=AVTB[v2];' +
    '[v0][v1]xfade=transition=fade:duration=0.45:offset=3.05[v01];[v01][v2]xfade=transition=fade:duration=0.45:offset=7.10,format=yuv420p[v];' +
    '[0:a][1:a]acrossfade=d=0.45[a01];[a01][2:a]acrossfade=d=0.45[a]',
    '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out
  ]);
  console.log('Built:', out);
}

function buildDemo2() {
  const p1 = path.join(PLATES, 's2_step12_analysis_plate.png');
  const p2 = path.join(PLATES, 's2_step3_assets.png');
  const p3 = path.join(PLATES, 's2_step4_compare_plate.png');
  const repClip = path.join(RAW, 'replication_clip1.mp4');
  const seg1 = path.join(PLATES, 'd2_seg1.mp4');
  const seg2 = path.join(PLATES, 'd2_seg2.mp4');
  const seg3 = path.join(PLATES, 'd2_seg3.mp4');
  const out = path.join(OUT, '02-replication-studio-demo.mp4');

  // Segment 1 (4.5s): live 007 source video at x=88, y=76+148=224, w=384, h=682
  ff([
    '-loop', '1', '-t', '4.5', '-i', p1,
    '-ss', '0', '-t', '4.5', '-i', SRC_007_VIDEO,
    '-filter_complex',
    '[1:v]scale=384:682:flags=lanczos,fps=30,setpts=PTS-STARTPTS[vid];[0:v][vid]overlay=88:224:shortest=1,format=yuv420p[vout];' +
    '[1:a]aresample=48000,aformat=channel_layouts=stereo,volume=0.6,afade=t=in:st=0:d=0.3,afade=t=out:st=4.0:d=0.5[aout]',
    '-map', '[vout]', '-map', '[aout]',
    '-t', '4.5', '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-c:a', 'aac', '-b:a', '192k', seg1
  ]);

  // Segment 2 (3.8s): assets sheet
  ff(['-loop', '1', '-t', '3.8', '-i', p2, '-f', 'lavfi', '-t', '3.8', '-i', 'anullsrc=r=48000:cl=stereo',
    '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-c:a', 'aac', '-b:a', '192k', seg2]);

  // Segment 3 (10.5s): side-by-side live 007 (x=140, y=76+176=252) + live Seedance 2.5 repClip (x=652, y=252)
  ff([
    '-loop', '1', '-t', '10.5', '-i', p3,
    '-ss', '0', '-t', '10.5', '-i', SRC_007_VIDEO,
    '-ss', '0', '-t', '10.5', '-i', repClip,
    '-filter_complex',
    '[1:v]scale=384:682:flags=lanczos,fps=30,setpts=PTS-STARTPTS[vorig];' +
    '[2:v]scale=384:682:flags=lanczos,fps=30,setpts=PTS-STARTPTS[vrep];' +
    '[0:v][vorig]overlay=140:252:shortest=1[tmp];[tmp][vrep]overlay=652:252:shortest=1,format=yuv420p[vout];' +
    '[2:a]aresample=48000,aformat=channel_layouts=stereo,afade=t=in:st=0:d=0.3,afade=t=out:st=10.0:d=0.5[aout]',
    '-map', '[vout]', '-map', '[aout]',
    '-t', '10.5', '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-c:a', 'aac', '-b:a', '192k', seg3
  ]);

  ff([
    '-i', seg1, '-i', seg2, '-i', seg3,
    '-filter_complex',
    '[0:v]fps=30,settb=AVTB[v0];[1:v]fps=30,settb=AVTB[v1];[2:v]fps=30,settb=AVTB[v2];' +
    '[v0][v1]xfade=transition=fade:duration=0.45:offset=4.05[v01];[v01][v2]xfade=transition=fade:duration=0.45:offset=7.40,format=yuv420p[v];' +
    '[0:a][1:a]acrossfade=d=0.45[a01];[a01][2:a]acrossfade=d=0.45[a]',
    '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out
  ]);
  console.log('Built:', out);
}

function buildDemo3() {
  const p1 = path.join(PLATES, 's3_step1_assets_plate.png');
  const p2 = path.join(PLATES, 's3_step2_swap_compare.png');
  const seg1 = path.join(PLATES, 'd3_seg1.mp4');
  const seg2 = path.join(PLATES, 'd3_seg2.mp4');
  const out = path.join(OUT, '03-replacement-studio-demo.mp4');

  // Segment 1 (5.5s): live 测试视频.mp4 at x=88, y=76+148=224, w=384, h=682
  ff([
    '-loop', '1', '-t', '5.5', '-i', p1,
    '-ss', '0', '-t', '5.5', '-i', SRC_TEST_VIDEO,
    '-filter_complex',
    '[1:v]scale=384:682:flags=lanczos,fps=30,setpts=PTS-STARTPTS[vid];[0:v][vid]overlay=88:224:shortest=1,format=yuv420p[vout];' +
    '[1:a]aresample=48000,aformat=channel_layouts=stereo,afade=t=in:st=0:d=0.3,afade=t=out:st=5.0:d=0.5[aout]',
    '-map', '[vout]', '-map', '[aout]',
    '-t', '5.5', '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-c:a', 'aac', '-b:a', '192k', seg1
  ]);

  // Segment 2 (8.5s): swap comparison + reference voice sample preview
  ff([
    '-loop', '1', '-t', '8.5', '-i', p2,
    '-t', '8.5', '-i', SRC_VOICE_MP3,
    '-filter_complex',
    '[0:v]fps=30,format=yuv420p[vout];[1:a]aresample=48000,aformat=channel_layouts=stereo,apad=whole_dur=8.5,afade=t=in:st=0:d=0.2,afade=t=out:st=8.0:d=0.5[aout]',
    '-map', '[vout]', '-map', '[aout]',
    '-t', '8.5', '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-c:a', 'aac', '-b:a', '192k', seg2
  ]);

  ff([
    '-i', seg1, '-i', seg2,
    '-filter_complex',
    '[0:v]fps=30,settb=AVTB[v0];[1:v]fps=30,settb=AVTB[v1];' +
    '[v0][v1]xfade=transition=fade:duration=0.45:offset=5.05,format=yuv420p[v];[0:a][1:a]acrossfade=d=0.45[a]',
    '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out
  ]);
  console.log('Built:', out);
}

const browser = await chromium.launch({
  headless: true,
  executablePath: '/Users/chenshuo/Library/Caches/ms-playwright/chromium-1255/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
});
try {
  await renderPlates(browser);
} finally {
  await browser.close();
}
buildDemo1();
buildDemo2();
buildDemo3();
console.log('ALL 3 STUDIO DEMOS COMPLETE.');
