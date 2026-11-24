---
name: motion-canvas
description: "基于 TypeScript 生成器函数的时间轴图解动画框架，极擅长架构图演进、代码高亮讲解与技术原理可视化。"
---

# Motion Canvas · 图解与技术原理动画

> 官方仓库：https://github.com/motion-canvas/motion-canvas

## 适用场景
- 架构演进图、流程图、算法步骤演示、代码逐行高亮与硬核科普视频。

## 核心实践
1. **生成器编排**：用 `yield* all(...)` 并行驱动多个节点，用 `yield* chain(...)` 或 `yield* waitUntil("beat")` 精准对齐配音节拍。
2. **响应式信号（Signals）**：通过 `createSignal` 绑定节点坐标、透明度与连线路径，实现自动联动。
3. **代码与排版组件**：善用 `<Code>` 差异平滑过渡与 `<Layout>` 自动排版，避免手动硬算像素偏移。
