---
name: konva
description: "高性能 HTML5 2D 交互画布框架，支持分层渲染、节点拖拽缩放、局部遮罩绘制与触控手势。"
---

# Konva · 可触摸交互的 2D 节点画布

> 官方仓库：https://github.com/konvajs/konva

## 适用场景
- 图片标注、局部重绘遮罩编辑、拼图排版器、交互式分镜板与触控画布工具。

## 核心实践
1. **动静分层**：静态底图与高频交互控制点分置不同 `Konva.Layer`，避免全局重绘。
2. **变换与导出**：结合 `Konva.Transformer` 实现拖拽旋转缩放，通过 `stage.toDataURL({ pixelRatio: 2 })` 高清导出。
