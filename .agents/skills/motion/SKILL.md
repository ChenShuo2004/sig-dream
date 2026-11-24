---
name: motion
description: "高性能 Web 动画库（原 Framer Motion），专注丝滑画面切换、布局共享过渡（LayoutId）与物理弹簧微交互。"
---

# Motion · 画面切换与微交互动效

> 官方仓库：https://github.com/motiondivision/motion

## 适用场景
- 产品 UI 演示中的页面切换、卡片展开、悬浮窗弹出、焦点高亮与流畅微交互。

## 核心实践
1. **GPU 加速属性**：优先驱动 `transform`（x/y/scale/rotate）与 `opacity`，保持 60fps 零掉帧。
2. **弹簧物理预设**：界面弹出采用高阻尼微回弹（`stiffness: 320, damping: 28`），避免生硬线性移动。
3. **共享布局过渡**：利用 `layout` / `layoutId` 让按钮、卡片与弹窗自然变形衔接，减少突兀硬切。
