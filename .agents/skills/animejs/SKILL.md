---
name: animejs
description: "强大的 JavaScript 时间线动画引擎，擅长 Stagger 错峰入场、SVG 路径描边、变形与复杂多元素同步编排。"
---

# Anime.js · 时间线与错峰编排动效

> 官方仓库：https://github.com/juliangarnier/anime

## 适用场景
- 文字逐字/逐词错峰入场、卡片矩阵波浪展开、SVG 线条绘制与节点连线流光。

## 核心实践
1. **单一主时间线**：将所有子动画挂载到同一个 paused timeline，支持任意时间点 `tl.seek(ms)` 精确寻帧。
2. **Stagger 错峰节奏**：用 `stagger(60, { from: "center" })` 打造层次分明的卡片群组动效。
3. **SVG 描边与路径跟随**：结合 `strokeDashoffset` 与路径采样实现画布连线点亮效果。
