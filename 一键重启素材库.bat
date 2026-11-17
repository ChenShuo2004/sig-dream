@echo off
cd /d "%~dp0"
call "%~dp0restart-material-library.bat" %*
exit /b %errorlevel%