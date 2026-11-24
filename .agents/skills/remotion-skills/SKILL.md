---
name: remotion-skills
description: "Remotion 官方 AI 视频制作技能：用 React 组件、确定性帧时间轴、spring/interpolate 与音画同步编程生成 1080p/4K 视频。"
---

# Remotion Skills · AI 程序化视频制作

> 官方仓库：https://github.com/remotion-dev/skills

## 适用场景
- 用 React + TypeScript 构建可复现、可参数化的产品宣传片、数据可视化视频、动态字幕与批量模板视频。

## 核心实践
1. **帧确定性原则**：一切视觉变化仅依赖 `useCurrentFrame()` 与 `useVideoConfig()`，禁止使用 `Math.random()`（改用 `random(seed)`）或 CSS transition。
2. **自然物理动效**：优先使用 `spring({ frame, fps, config })` 与 `interpolate(..., { extrapolateLeft: "clamp", extrapolateRight: "clamp" })`。
3. **媒体与字体安全**：使用 `<Img>`、`<OffthreadVideo>`、`<Audio>` 与 `@remotion/google-fonts`，防止渲染丢帧或字体回退。
4. **模块化分镜**：按 `<Sequence from={...} durationInFrames={...}>` 拆分每个镜头，便于独立预览与精准卡点。
