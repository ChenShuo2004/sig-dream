@echo off
REM Copy this file to local-env.bat in this folder. Do not commit local-env.bat.
REM Use ASCII only in local-env.bat (no Chinese punctuation like full-width colon) so cmd.exe on GBK Windows parses lines correctly.
REM run-desktop.ps1 calls local-env.bat before npm if the file exists; values override the same keys in local.settings.json.

REM Same as Web: Next.js site root (where you run "npm run dev" in frontend/). Desktop will call {origin}/api-proxy/* like the browser.
REM When LCP_WEB_ORIGIN is set, it wins over LCP_API_BASE_URL. You must have Next running; frontend middleware adds CORS for /api-proxy.
set "LCP_WEB_ORIGIN=http://127.0.0.1:3000"

REM Direct FastAPI root when LCP_WEB_ORIGIN is empty (same target as next.config rewrites). NOT NAS file machine :9001.
REM Root repo local-env.bat SERVER_HOST is for SSH; desktop API is FastAPI URL (often http://YOUR_ECS_IP:8000 if SG allows).
REM set "LCP_API_BASE_URL=http://127.0.0.1:8000"
REM Optional override for default cache path shown in the app (renderer still uses localStorage for saved cache root when set).
REM set "LCP_CACHE_ROOT=D:\LCP-Material-Cache"

REM GitHub Releases publish. Token must be PAT (starts with ghp_ or github_pat_), NOT SSH fingerprint.
REM Classic PAT: scope repo. Fine-grained: Contents Read and write on this repo.
REM Test first: run 验证GitHub令牌.bat
REM set "GH_TOKEN=ghp_your_full_token_here"

exit /b 0
