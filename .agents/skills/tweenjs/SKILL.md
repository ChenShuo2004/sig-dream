---
name: tweenjs
description: "经典链式补间库，通过 `.to().wait().call()` 直观编排按顺序依次触发的多阶段动作序列。"
---

# TweenJS · 按顺序动起来的链式补间

> 官方仓库：https://github.com/CreateJS/TweenJS

## 适用场景
- 清晰的步骤引导、按序触发的 UI 交互演示、角色状态切换与多拍串联动画。

## 核心实践
1. **链式可读编排**：`Tween.get(target).to({ x: 400 }, 500, Ease.cubicOut).wait(300).to({ alpha: 0 }, 300)`。
2. **事件与回调分离**：在时间点插入状态切换，保持每段动作起止清晰、易维护。
