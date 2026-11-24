---
name: threejs
description: "Web 端最主流的 3D 渲染引擎，覆盖 PBR 材质、后处理泛光（Bloom）、自定义 GLSL 着色器与电影级运镜。"
---

# Three.js · WebGL 3D 场景与电影级渲染

> 官方仓库：https://github.com/mrdoob/three.js

## 适用场景
- 品牌 3D 视觉大片、产品模型展示、流体/光影 Shader 背景与空间数据可视化。

## 核心实践
1. **三点布光 + 环境贴图**：配置主光、轮廓光（Rim Light）与 HDRI 环境反射，避免 3D 物体塑料感。
2. **色调映射与抗锯齿**：开启 `ACESFilmicToneMapping` 与 `SRGBColorSpace`，确保高光不过曝、暗部有层次。
3. **时间轴驱动**：将动画与相机轨道写成 `render(t)` 纯函数，兼容离线逐帧高清渲染。
