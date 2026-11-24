---
name: shifty
description: "零依赖高性能 JavaScript 补间动画核心，支持自定义三次贝塞尔曲线、颜色插值与精确可控的帧级更新。"
---

# Shifty · 高精度缓动与补间引擎

> 官方仓库：https://github.com/jeremyckahn/shifty

## 适用场景
- 自定义 Canvas / WebGL 渲染器、帧级离线导出脚本以及需要精确贝塞尔缓动曲线的底层动画驱动。

## 核心实践
1. **自定义曲线**：通过 `setBezierFunction` 注册品牌专属缓动曲线（如 Apple/Linear 风格快速启动+长尾减速）。
2. **确定性步进**：在离线渲染场景下通过手动 `seek(t)` 采样补间状态，确保逐帧导出 100% 稳定。
