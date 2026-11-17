# SVS 改词翻唱导唱服务（装在 88）

端口 **7866**。与 Seed-VC（7865）、VoiceStudio（3901）同机。

## 做什么

1. 用句上**新歌词** + 原片干声窗调用本机 VoiceStudio 出导唱底  
2. 用 **pyworld** 把原干声的 F0 压到导唱上（跟原曲旋律）  
3. 文件机再调 Seed-VC，换成用户上传的**指定音色**

首版引擎：`voicestudio+pyworld-f0`（可后续换成 DiffSinger acoustic，API 不变）。

## 安装（88）

1. 拷贝整个 `svs-service` 到 `D:\svs-service`  
2. 确认 VoiceStudio `:3901`、Seed-VC `:7865` 已开且 `cuda:true`  
3. 双击 `start.bat`（纯 ASCII）  
4. `http://127.0.0.1:7866/health` 应 `ok: true`

## API

- `GET /health`
- `POST /sing`：`lyrics` + `melody`（干声 WAV）→ `guide.wav`
