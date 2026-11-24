---
name: lottie-web
description: "直接解析与播放 After Effects 导出的 JSON 矢量动画，支持帧级精准控制（goToAndStop）与极低体积集成。"
---

# Lottie Web · 轻量级矢量动画播放与控制

> 官方仓库：https://github.com/airbnb/lottie-web

## 适用场景
- 图标微动效、加载动画、贴纸角标、动态转场遮罩与 AE 设计师资产的程序化复用。

## 核心实践
1. **时间轴同步**：在视频渲染环境中设置 `autoplay: false`，由主时间轴调用 `anim.goToAndStop(frame, true)` 精确锁帧。
2. **渲染器选择**：矢量锐度优先选 `svg`，海量图层优先选 `canvas`。
