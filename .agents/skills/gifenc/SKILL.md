---
name: gifenc
description: "极速纯 JS GIF 编码器，支持量化调色板与逐帧像素写入，轻松把画布与动效直接导出为高质量循环 GIF。"
---

# gifenc · 高性能 GIF 编码与导出

> 官方仓库：https://github.com/mattdesl/gifenc

## 适用场景
- 将无限画布成果、产品微动效、README 演示片段快速导出为轻量高画质循环 GIF。

## 核心实践
1. **调色板量化**：使用 `quantize(rgba, 256)` + `applyPalette` 保留品牌色彩准确度并显著压低体积。
2. **帧率与循环控制**：演示类动图推荐 12–20 fps，关键定格帧拉长 `delay` 提升可读性。
