import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const AGENTS_SKILLS_DIR = join(REPO_ROOT, ".agents", "skills");
const CS_SKILLS_SRC = "/Users/chenshuo/coding/cs-skills";
const OUT_TS = join(REPO_ROOT, "src", "data", "builtin-skills.ts");

mkdirSync(AGENTS_SKILLS_DIR, { recursive: true });
mkdirSync(dirname(OUT_TS), { recursive: true });

const CS_CREATIVE_SKILLS = [
    { slug: "cs-auto-videl", title: "电商短视频复刻流", tags: ["电商视频", "分镜", "Seedance"] },
    { slug: "cs-chatcut", title: "ChatCut 短视频策划", tags: ["短视频", "口播", "分镜"] },
    { slug: "cs-chatcut-video-blueprint", title: "视频剧本与制作蓝图", tags: ["剧本", "提示词", "蓝图"] },
    { slug: "cs-code-story-video", title: "16:9 代码叙事视频", tags: ["Remotion", "叙事", "封面"] },
    { slug: "cs-code-video", title: "代码动画科普视频", tags: ["代码动画", "Playwright", "FFmpeg"] },
    { slug: "cs-digital-human-product-video-pipeline", title: "数字人产品视频流水线", tags: ["数字人", "产品片", "批处理"] },
    { slug: "cs-guoshen", title: "多平台过审与风控核查", tags: ["审核", "小红书", "抖音"] },
    { slug: "cs-kai-cover", title: "KAI 观点封面生成", tags: ["封面", "角色一致", "排版"] },
    { slug: "cs-knowledge-film", title: "暗夜星空知识解说片", tags: ["知识片", "双语字幕", "1080p"] },
    { slug: "cs-personal-ip-script", title: "个人 IP 实战口播稿", tags: ["IP口播", "60-90秒", "选题"] },
    { slug: "cs-pixel-explainer", title: "像素风坐标系解说片", tags: ["像素风", "打字机", "配音"] },
    { slug: "cs-web-promo-film", title: "真实网页产品宣传片", tags: ["网页演示", "运镜", "Remotion"] },
    { slug: "cs-writer", title: "实战内容与长短帖写作", tags: ["文案", "X长帖", "复盘"] },
    { slug: "cs-xiaohuang-skill", title: "小黄 IP 角色与文章配图", tags: ["IP角色", "三视图", "配图"] },
];

const CURATED_CRAFT_AND_ENGINE_SKILLS = [
    {
        slug: "anatomy",
        title: "视觉解剖与人体结构参考",
        category: "craft",
        repo: "https://github.com/wheresryan22/anatomy",
        summary: "提供高精度人体解剖结构、骨骼肌肉比例、透视动态与角色三视图校准指导，确保生图与角色动画结构准确不崩坏。",
        tags: ["人体结构", "姿态比例", "角色一致"],
        body: `# Anatomy · 视觉解剖与人体结构参考

> 来源参考：https://github.com/wheresryan22/anatomy

## 适用场景
- 角色三视图设定、全身动态姿态生图、手部/面部特写修复与 3D 角色绑定前的解剖比例校准。

## 核心工作流
1. **体块与比例先行**：先确定头身比（写实 7.5–8 头身 / 动漫 6–7 头身 / Q版 2.5–3.5 头身）、肩宽与骨盆倾斜角（Contrapposto 动态线）。
2. **关键受力与关节检查**：重点核查锁骨与胸锁乳突肌走向、肘腕扭转关系、手指五指长度与掌骨弧度、膝踝承重重心线。
3. **镜头透视压缩**：广角俯仰拍时明确近大远小（Foreshortening）比例，防止四肢拉长或关节错位。
4. **画布联动**：在 sig-dream 无限画布中将结构参考图作为图 1，配合局部遮罩（Inpaint）定向修正手部、颈肩与透视细节。`,
    },
    {
        slug: "video-shotcraft",
        title: "电影级分镜与运镜工艺",
        category: "craft",
        repo: "",
        summary: "系统化电影分镜设计技能：覆盖景别切换（EWS→CU）、轴线法则、推拉摇移运镜、匹配剪辑与节奏节拍控制。",
        tags: ["分镜语法", "电影运镜", "镜头衔接"],
        body: `# Video Shotcraft · 电影级分镜与运镜工艺

## 适用场景
- 剧本工作室分镜拆解、复刻工作室运镜分析、宣传片与叙事短片的镜头语言升级。

## 核心规则
1. **每镜单一叙事任务**：每个镜头只传递一个核心信息或情绪变化，避免信息过载。
2. **景别阶梯变化**：遵循建立镜头（Establishing）→ 中景互动（MS）→ 特写情绪/动作（CU/ECU）的视觉递进，避免同景别硬切跳帧。
3. **180° 轴线与视线匹配**：对话与追逐场景严格保持人物朝向与运动方向一致；越轴必须通过过肩、移动机位或中性镜头过渡。
4. **带原因的运镜与转场**：推镜（Push-in）强化聚焦，拉镜（Pull-back）揭示全局环境，甩镜/动作匹配剪辑（Match Cut）衔接高能节拍。
5. **提示词结构模板**：\`[景别 + 机位角度] + [主体与动作] + [环境与光影色温] + [镜头运动轨迹] + [焦段/景深质感]\`。`,
    },
    {
        slug: "remotion-skills",
        title: "Remotion AI 视频制作技能",
        category: "motion",
        repo: "https://github.com/remotion-dev/skills",
        summary: "Remotion 官方 AI 视频制作技能：用 React 组件、确定性帧时间轴、spring/interpolate 与音画同步编程生成 1080p/4K 视频。",
        tags: ["Remotion", "React视频", "程序化渲染"],
        body: `# Remotion Skills · AI 程序化视频制作

> 官方仓库：https://github.com/remotion-dev/skills

## 适用场景
- 用 React + TypeScript 构建可复现、可参数化的产品宣传片、数据可视化视频、动态字幕与批量模板视频。

## 核心实践
1. **帧确定性原则**：一切视觉变化仅依赖 \`useCurrentFrame()\` 与 \`useVideoConfig()\`，禁止使用 \`Math.random()\`（改用 \`random(seed)\`）或 CSS transition。
2. **自然物理动效**：优先使用 \`spring({ frame, fps, config })\` 与 \`interpolate(..., { extrapolateLeft: "clamp", extrapolateRight: "clamp" })\`。
3. **媒体与字体安全**：使用 \`<Img>\`、\`<OffthreadVideo>\`、\`<Audio>\` 与 \`@remotion/google-fonts\`，防止渲染丢帧或字体回退。
4. **模块化分镜**：按 \`<Sequence from={...} durationInFrames={...}>\` 拆分每个镜头，便于独立预览与精准卡点。`,
    },
    {
        slug: "motion-canvas",
        title: "Motion Canvas 图解动画",
        category: "motion",
        repo: "https://github.com/motion-canvas/motion-canvas",
        summary: "基于 TypeScript 生成器函数的时间轴图解动画框架，极擅长架构图演进、代码高亮讲解与技术原理可视化。",
        tags: ["图解动画", "TypeScript", "科普演示"],
        body: `# Motion Canvas · 图解与技术原理动画

> 官方仓库：https://github.com/motion-canvas/motion-canvas

## 适用场景
- 架构演进图、流程图、算法步骤演示、代码逐行高亮与硬核科普视频。

## 核心实践
1. **生成器编排**：用 \`yield* all(...)\` 并行驱动多个节点，用 \`yield* chain(...)\` 或 \`yield* waitUntil("beat")\` 精准对齐配音节拍。
2. **响应式信号（Signals）**：通过 \`createSignal\` 绑定节点坐标、透明度与连线路径，实现自动联动。
3. **代码与排版组件**：善用 \`<Code>\` 差异平滑过渡与 \`<Layout>\` 自动排版，避免手动硬算像素偏移。`,
    },
    {
        slug: "motion",
        title: "Motion 画面切换与微交互动效",
        category: "motion",
        repo: "https://github.com/motiondivision/motion",
        summary: "高性能 Web 动画库（原 Framer Motion），专注丝滑画面切换、布局共享过渡（LayoutId）与物理弹簧微交互。",
        tags: ["画面切换", "弹簧物理", "UI动效"],
        body: `# Motion · 画面切换与微交互动效

> 官方仓库：https://github.com/motiondivision/motion

## 适用场景
- 产品 UI 演示中的页面切换、卡片展开、悬浮窗弹出、焦点高亮与流畅微交互。

## 核心实践
1. **GPU 加速属性**：优先驱动 \`transform\`（x/y/scale/rotate）与 \`opacity\`，保持 60fps 零掉帧。
2. **弹簧物理预设**：界面弹出采用高阻尼微回弹（\`stiffness: 320, damping: 28\`），避免生硬线性移动。
3. **共享布局过渡**：利用 \`layout\` / \`layoutId\` 让按钮、卡片与弹窗自然变形衔接，减少突兀硬切。`,
    },
    {
        slug: "ola",
        title: "Ola 数值平滑插值动画",
        category: "motion",
        repo: "https://github.com/franciscop/ola",
        summary: "轻量平滑数值插值库，让计数器、进度条、坐标追踪与实时指标在任意变化下保持丝滑惯性过渡。",
        tags: ["数值平滑", "插值", "数据动效"],
        body: `# Ola · 数值平滑变动与惯性插值

> 官方仓库：https://github.com/franciscop/ola

## 适用场景
- 数据大屏数字滚动、指标卡片平滑跳动、相机跟随与鼠标平滑阻尼追踪。

## 核心实践
1. **声明式平滑状态**：\`const pos = Ola({ x: 0, y: 0 }, 300)\`，更新目标值时自动按缓动曲线连续逼近，无需手动取消旧动画。
2. **与帧循环结合**：在每帧读取当前插值渲染到 Canvas / SVG / DOM，保证指标数值跳变自然不闪烁。`,
    },
    {
        slug: "animejs",
        title: "Anime.js 时间线与错峰动效",
        category: "motion",
        repo: "https://github.com/juliangarnier/anime",
        summary: "强大的 JavaScript 时间线动画引擎，擅长 Stagger 错峰入场、SVG 路径描边、变形与复杂多元素同步编排。",
        tags: ["时间线", "错峰动效", "SVG动画"],
        body: `# Anime.js · 时间线与错峰编排动效

> 官方仓库：https://github.com/juliangarnier/anime

## 适用场景
- 文字逐字/逐词错峰入场、卡片矩阵波浪展开、SVG 线条绘制与节点连线流光。

## 核心实践
1. **单一主时间线**：将所有子动画挂载到同一个 paused timeline，支持任意时间点 \`tl.seek(ms)\` 精确寻帧。
2. **Stagger 错峰节奏**：用 \`stagger(60, { from: "center" })\` 打造层次分明的卡片群组动效。
3. **SVG 描边与路径跟随**：结合 \`strokeDashoffset\` 与路径采样实现画布连线点亮效果。`,
    },
    {
        slug: "manim",
        title: "Manim 公式与几何图形动画",
        category: "motion",
        repo: "https://github.com/ManimCommunity/manim",
        summary: "3Blue1Brown 同款数学与科学动画引擎，擅长 LaTeX 公式推导变形、坐标系变换、向量场与几何证明可视化。",
        tags: ["公式动画", "几何图形", "科学可视化"],
        body: `# Manim · 数学公式与几何图形动画

> 官方仓库：https://github.com/ManimCommunity/manim

## 适用场景
- 知识科普视频中的公式推导、神经网络矩阵变换、函数曲线绘制与几何空间演示。

## 核心实践
1. **平滑公式变形**：使用 \`TransformMatchingTex\` 保持相同符号连续移动，观众一眼看懂推导逻辑。
2. **视觉层级克制**：深色画布配高对比主题色高亮当前关注项，其余元素降透明度退居背景。
3. **镜头与坐标联动**：结合 \`MovingCameraScene\` 局部推近公式或函数拐点，同步输出透明通道或 1080p60 素材。`,
    },
    {
        slug: "shifty",
        title: "Shifty 缓动与补间引擎",
        category: "motion",
        repo: "https://github.com/jeremyckahn/shifty",
        summary: "零依赖高性能 JavaScript 补间动画核心，支持自定义三次贝塞尔曲线、颜色插值与精确可控的帧级更新。",
        tags: ["缓动曲线", "补间引擎", "底层驱动"],
        body: `# Shifty · 高精度缓动与补间引擎

> 官方仓库：https://github.com/jeremyckahn/shifty

## 适用场景
- 自定义 Canvas / WebGL 渲染器、帧级离线导出脚本以及需要精确贝塞尔缓动曲线的底层动画驱动。

## 核心实践
1. **自定义曲线**：通过 \`setBezierFunction\` 注册品牌专属缓动曲线（如 Apple/Linear 风格快速启动+长尾减速）。
2. **确定性步进**：在离线渲染场景下通过手动 \`seek(t)\` 采样补间状态，确保逐帧导出 100% 稳定。`,
    },
    {
        slug: "twojs",
        title: "Two.js 2D 矢量图形动画",
        category: "motion",
        repo: "https://github.com/jonobr1/two.js",
        summary: "面向创意编码的 2D 矢量绘图库，同一套 API 无缝切换 SVG、Canvas 与 WebGL 渲染器，适合几何图形与抽象动态视觉。",
        tags: ["2D矢量", "创意编码", "抽象图形"],
        body: `# Two.js · 2D 矢量图形与创意动效

> 官方仓库：https://github.com/jonobr1/two.js

## 适用场景
- 品牌片头几何演进、动态背景纹理、音频驱动波形与可无损缩放的 2D 矢量图形动画。

## 核心实践
1. **分组层级管理**：用 \`two.makeGroup()\` 组织复合图形，统一驱动位移、旋转与缩放。
2. **路径锚点变形**：直接操作 \`path.vertices\` 实现有机液态波动、线条呼吸与形状渐变。`,
    },
    {
        slug: "lottie-web",
        title: "Lottie Web 轻量矢量动画",
        category: "motion",
        repo: "https://github.com/airbnb/lottie-web",
        summary: "直接解析与播放 After Effects 导出的 JSON 矢量动画，支持帧级精准控制（goToAndStop）与极低体积集成。",
        tags: ["Lottie", "AE导出", "矢量微动效"],
        body: `# Lottie Web · 轻量级矢量动画播放与控制

> 官方仓库：https://github.com/airbnb/lottie-web

## 适用场景
- 图标微动效、加载动画、贴纸角标、动态转场遮罩与 AE 设计师资产的程序化复用。

## 核心实践
1. **时间轴同步**：在视频渲染环境中设置 \`autoplay: false\`，由主时间轴调用 \`anim.goToAndStop(frame, true)\` 精确锁帧。
2. **渲染器选择**：矢量锐度优先选 \`svg\`，海量图层优先选 \`canvas\`。`,
    },
    {
        slug: "tweenjs",
        title: "TweenJS 顺序链式补间动画",
        category: "motion",
        repo: "https://github.com/CreateJS/TweenJS",
        summary: "经典链式补间库，通过 `.to().wait().call()` 直观编排按顺序依次触发的多阶段动作序列。",
        tags: ["顺序动画", "链式编排", "补间"],
        body: `# TweenJS · 按顺序动起来的链式补间

> 官方仓库：https://github.com/CreateJS/TweenJS

## 适用场景
- 清晰的步骤引导、按序触发的 UI 交互演示、角色状态切换与多拍串联动画。

## 核心实践
1. **链式可读编排**：\`Tween.get(target).to({ x: 400 }, 500, Ease.cubicOut).wait(300).to({ alpha: 0 }, 300)\`。
2. **事件与回调分离**：在时间点插入状态切换，保持每段动作起止清晰、易维护。`,
    },
    {
        slug: "gifenc",
        title: "gifenc 高性能 GIF 导出",
        category: "motion",
        repo: "https://github.com/mattdesl/gifenc",
        summary: "极速纯 JS GIF 编码器，支持量化调色板与逐帧像素写入，轻松把画布与动效直接导出为高质量循环 GIF。",
        tags: ["GIF导出", "量化压缩", "动图生成"],
        body: `# gifenc · 高性能 GIF 编码与导出

> 官方仓库：https://github.com/mattdesl/gifenc

## 适用场景
- 将无限画布成果、产品微动效、README 演示片段快速导出为轻量高画质循环 GIF。

## 核心实践
1. **调色板量化**：使用 \`quantize(rgba, 256)\` + \`applyPalette\` 保留品牌色彩准确度并显著压低体积。
2. **帧率与循环控制**：演示类动图推荐 12–20 fps，关键定格帧拉长 \`delay\` 提升可读性。`,
    },
    {
        slug: "konva",
        title: "Konva 可触摸交互 2D 画布",
        category: "motion",
        repo: "https://github.com/konvajs/konva",
        summary: "高性能 HTML5 2D 交互画布框架，支持分层渲染、节点拖拽缩放、局部遮罩绘制与触控手势。",
        tags: ["交互画布", "图层节点", "遮罩绘制"],
        body: `# Konva · 可触摸交互的 2D 节点画布

> 官方仓库：https://github.com/konvajs/konva

## 适用场景
- 图片标注、局部重绘遮罩编辑、拼图排版器、交互式分镜板与触控画布工具。

## 核心实践
1. **动静分层**：静态底图与高频交互控制点分置不同 \`Konva.Layer\`，避免全局重绘。
2. **变换与导出**：结合 \`Konva.Transformer\` 实现拖拽旋转缩放，通过 \`stage.toDataURL({ pixelRatio: 2 })\` 高清导出。`,
    },
    {
        slug: "lume",
        title: "LUME HTML 声明式 3D 场景",
        category: "3d",
        repo: "https://github.com/lume/lume",
        summary: "用类 HTML 标签声明式构建 3D 场景、灯光与混合 DOM 卡片，轻松打造 3D 悬浮产品界面与空间展厅。",
        tags: ["HTML 3D", "空间界面", "WebGL"],
        body: `# LUME · 用 HTML 声明式构建 3D 场景

> 官方仓库：https://github.com/lume/lume

## 适用场景
- 3D 悬浮产品 UI 展示、带真实光影反射的网页卡片与零门槛空间交互场景。

## 核心实践
1. **HTML 与 WebGL 融合**：使用 \`<lume-scene>\`、\`<lume-element3d>\` 与 \`<lume-point-light>\` 让真实 HTML 界面获得 3D 纵深与受光质感。
2. **相机运镜**：驱动 \`<lume-perspective-camera>\` 的 position 与 rotation 实现平滑推拉环绕。`,
    },
    {
        slug: "threejs",
        title: "Three.js 3D 场景与着色器",
        category: "3d",
        repo: "https://github.com/mrdoob/three.js",
        summary: "Web 端最主流的 3D 渲染引擎，覆盖 PBR 材质、后处理泛光（Bloom）、自定义 GLSL 着色器与电影级运镜。",
        tags: ["Three.js", "WebGL", "着色器"],
        body: `# Three.js · WebGL 3D 场景与电影级渲染

> 官方仓库：https://github.com/mrdoob/three.js

## 适用场景
- 品牌 3D 视觉大片、产品模型展示、流体/光影 Shader 背景与空间数据可视化。

## 核心实践
1. **三点布光 + 环境贴图**：配置主光、轮廓光（Rim Light）与 HDRI 环境反射，避免 3D 物体塑料感。
2. **色调映射与抗锯齿**：开启 \`ACESFilmicToneMapping\` 与 \`SRGBColorSpace\`，确保高光不过曝、暗部有层次。
3. **时间轴驱动**：将动画与相机轨道写成 \`render(t)\` 纯函数，兼容离线逐帧高清渲染。`,
    },
    {
        slug: "babylonjs",
        title: "Babylon.js 3D 渲染与物理动画",
        category: "3d",
        repo: "https://github.com/BabylonJS/Babylon.js",
        summary: "企业级 Web 3D 引擎，内置完善 PBR 渲染管线、物理碰撞、骨骼动画与节点材质编辑器。",
        tags: ["Babylon.js", "PBR渲染", "物理动画"],
        body: `# Babylon.js · 工业级 3D 渲染与物理动画

> 官方仓库：https://github.com/BabylonJS/Babylon.js

## 适用场景
- 高写实产品 3D 拆解、工业硬件展示、交互式数字展厅与物理仿真动画。

## 核心实践
1. **默认后处理管线**：启用 \`DefaultRenderingPipeline\` 快速获得景深（DOF）、泛光与色差电影感。
2. **动画组同步**：使用 \`AnimationGroup\` 精准控制多模型协同运动与关键帧混合。`,
    },
    {
        slug: "blender",
        title: "Blender 绑定与角色动画",
        category: "3d",
        repo: "https://github.com/blender/blender",
        summary: "开源全能 3D 创作套件技能：覆盖 Python (bpy) 自动化建模、Rigify 骨骼绑定、动作关键帧与 Cycles/EEVEE 渲染。",
        tags: ["Blender", "角色绑定", "bpy脚本"],
        body: `# Blender · 骨骼绑定、角色动画与 bpy 自动化

> 官方仓库：https://github.com/blender/blender

## 适用场景
- 角色骨骼绑定与姿态生成、3D 镜头预演（Previs）、产品渲染图批量出图与透明通道素材制作。

## 核心实践
1. **Rigify 绑定与姿态库**：快速生成 IK/FK 角色控制器，导出多角度标准三视图供无限画布锁定角色一致性。
2. **bpy 批量渲染**：通过无头模式 \`blender -b scene.blend -P render.py\` 自动切换机位、材质与灯光输出高清帧序列。`,
    },
    {
        slug: "godot",
        title: "Godot 游戏级动画与交互",
        category: "3d",
        repo: "https://github.com/godotengine/godot",
        summary: "开源轻量级游戏引擎技能：擅长 AnimationTree 状态机、2D 骨骼/像素动画、Shader 特效与实时过场动画。",
        tags: ["Godot", "游戏动画", "状态机"],
        body: `# Godot · 游戏级 2D/3D 动画与过场演出

> 官方仓库：https://github.com/godotengine/godot

## 适用场景
- 像素/2D 骨骼角色动作、实时渲染过场（Cutscene）、交互式演示原型与游戏化宣传短片。

## 核心实践
1. **AnimationPlayer + AnimationTree**：用混合树平滑衔接待机、奔跑、攻击与镜头震动轨道。
2. **Movie Maker 模式**：使用 Godot 内置 Movie Maker 确定性逐帧录制无掉帧高码率视频。`,
    },
    {
        slug: "proton",
        title: "Proton 粒子特效引擎",
        category: "3d",
        repo: "https://github.com/drawcall/Proton",
        summary: "轻量级多渲染器粒子引擎（支持 Canvas/WebGL/DOM/Three.js），快速制作星尘、火焰、光束与能量爆发粒子效果。",
        tags: ["粒子特效", "光效氛围", "爆发转场"],
        body: `# Proton · 高性能 2D/3D 粒子特效引擎

> 官方仓库：https://github.com/drawcall/Proton

## 适用场景
- 宣传片高能转场粒子、Logo 聚散星尘、氛围微尘漂浮与能量冲击波效果。

## 核心实践
1. **行为组合（Behaviours）**：自由组合 \`Alpha\`、\`Scale\`、\`Color\`、\`Gravity\` 与 \`Attraction\` 构建丰富粒子物理。
2. **克制高级感**：控制粒子尺寸与透明度（0.15–0.55），搭配微弱辉光作为氛围衬托，不遮挡主体文字与产品界面。`,
    },
];

function parseFrontmatter(raw) {
    const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (!m) return { name: "", description: "", body: raw.trim() };
    const fm = m[1];
    const body = m[2].trim();
    const nameMatch = fm.match(/^name:\s*(.+)$/m);
    const descMatch = fm.match(/^description:\s*(.+)$/m);
    const clean = (v) => (v ? v.trim().replace(/^["']|["']$/g, "") : "");
    return {
        name: clean(nameMatch?.[1]),
        description: clean(descMatch?.[1]),
        body,
    };
}

const records = [];

// 1. Sync 14 CS creative skills
for (const item of CS_CREATIVE_SKILLS) {
    const srcSkillFile = join(CS_SKILLS_SRC, item.slug, "SKILL.md");
    const dstDir = join(AGENTS_SKILLS_DIR, item.slug);
    mkdirSync(dstDir, { recursive: true });
    const dstSkillFile = join(dstDir, "SKILL.md");

    let raw = "";
    if (existsSync(srcSkillFile)) {
        copyFileSync(srcSkillFile, dstSkillFile);
        raw = readFileSync(dstSkillFile, "utf8");
    } else if (existsSync(dstSkillFile)) {
        raw = readFileSync(dstSkillFile, "utf8");
    } else {
        throw new Error(`Missing source skill: ${srcSkillFile}`);
    }

    const parsed = parseFrontmatter(raw);
    records.push({
        slug: item.slug,
        title: item.title,
        category: "cs-workflow",
        summary: parsed.description || item.title,
        tags: item.tags,
        repo: "https://github.com/ChenShuo2004/cs-skills",
        trigger: `$${item.slug}`,
        instructions: parsed.body,
    });
}

// 2. Write & collect 20 curated craft + video/motion/3D engine skills
for (const item of CURATED_CRAFT_AND_ENGINE_SKILLS) {
    const dstDir = join(AGENTS_SKILLS_DIR, item.slug);
    mkdirSync(dstDir, { recursive: true });
    const md = `---\nname: ${item.slug}\ndescription: "${item.summary.replace(/"/g, '\\"')}"\n---\n\n${item.body}\n`;
    writeFileSync(join(dstDir, "SKILL.md"), md, "utf8");

    records.push({
        slug: item.slug,
        title: item.title,
        category: item.category,
        summary: item.summary,
        tags: item.tags,
        repo: item.repo,
        trigger: `$${item.slug}`,
        instructions: item.body,
    });
}

const tsContent = `// Auto-generated by scripts/sync-builtin-skills.mjs — do not edit manually.
export type BuiltinSkillCategory = "cs-workflow" | "craft" | "motion" | "3d";

export interface BuiltinSkillItem {
    slug: string;
    title: string;
    category: BuiltinSkillCategory;
    summary: string;
    tags: string[];
    repo: string;
    trigger: string;
    instructions: string;
}

export const BUILTIN_SKILLS: BuiltinSkillItem[] = ${JSON.stringify(records, null, 4)};
`;

writeFileSync(OUT_TS, tsContent, "utf8");
console.log(`Synced ${records.length} built-in skills to .agents/skills/ and ${OUT_TS}`);
