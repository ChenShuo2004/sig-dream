[![中文](https://img.shields.io/badge/%E4%B8%AD%E6%96%87-8d4d2e?style=for-the-badge)](README.md)
[![English](https://img.shields.io/badge/English-1f6feb?style=for-the-badge&logo=readme&logoColor=white)](README.en.md)
[![日本語](https://img.shields.io/badge/%E6%97%A5%E6%9C%AC%E8%AA%9E-f3dfc7?style=for-the-badge&labelColor=f3dfc7&color=bc7650)](README.ja.md)
[![한국어](https://img.shields.io/badge/%ED%95%9C%EA%B5%AD%EC%96%B4-f3dfc7?style=for-the-badge&labelColor=f3dfc7&color=bc7650)](README.ko.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-f3dfc7?style=for-the-badge&labelColor=f3dfc7&color=bc7650)](LICENSE)

# sig-dream · sig 캔버스

**데이터베이스 없이 바로 실행하는 로컬 우선 오픈소스 AI 무한 캔버스 & 영상 제작 스튜디오.**

AI 이미지 생성, 다중 참조 편집, 영상 생성, 프롬프트 라이브러리, Canvas Agent를 하나의 무한 캔버스에 연결하고 **대본 / 복제 / 교체** 스튜디오를 내장했습니다. 모든 프로젝트와 API 키는 브라우저 로컬(IndexedDB / LocalStorage)에 저장되어 PostgreSQL이나 로그인 설정 없이 30초 만에 시작할 수 있습니다.

<img src="docs/screenshots/canvas-board.png" alt="sig 캔버스" width="1000">

## 빠른 시작

### Node.js (Node 20+)

```bash
git clone https://github.com/ChenShuo2004/sig-dream.git
cd sig-dream
npm install --legacy-peer-deps
npm run dev
```

[http://localhost:3000](http://localhost:3000) 을 열고 우측 상단 설정에서 모델 채널(Base URL + API Key)을 입력하면 바로 사용할 수 있습니다.

### Docker

```bash
docker build -t sig-dream .
docker run -d --name sig-dream -p 3000:3000 sig-dream
```

## 라이선스

[basketikun/infinite-canvas](https://github.com/basketikun/infinite-canvas)(MIT License)를 기반으로 확장 개발했습니다. 원본 라이선스는 [LICENSE.upstream-infinite-canvas](LICENSE.upstream-infinite-canvas)에 보존되며, 본 프로젝트는 [MIT License](LICENSE)를 따릅니다.
