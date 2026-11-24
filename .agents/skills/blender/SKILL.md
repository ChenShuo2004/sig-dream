---
name: blender
description: "开源全能 3D 创作套件技能：覆盖 Python (bpy) 自动化建模、Rigify 骨骼绑定、动作关键帧与 Cycles/EEVEE 渲染。"
---

# Blender · 骨骼绑定、角色动画与 bpy 自动化

> 官方仓库：https://github.com/blender/blender

## 适用场景
- 角色骨骼绑定与姿态生成、3D 镜头预演（Previs）、产品渲染图批量出图与透明通道素材制作。

## 核心实践
1. **Rigify 绑定与姿态库**：快速生成 IK/FK 角色控制器，导出多角度标准三视图供无限画布锁定角色一致性。
2. **bpy 批量渲染**：通过无头模式 `blender -b scene.blend -P render.py` 自动切换机位、材质与灯光输出高清帧序列。
