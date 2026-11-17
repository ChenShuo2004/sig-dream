@echo off
REM ASCII-only helper: run starter in silent mode (called detached/hidden).
setlocal ENABLEEXTENSIONS DISABLEDELAYEDEXPANSION
cd /d "%~dp0"
set "NAS_SILENT=1"
call "%~dp0start-nas-direct-services.bat" silent
exit /b %errorlevel%