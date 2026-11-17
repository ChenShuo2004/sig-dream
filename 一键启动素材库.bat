@echo off
cd /d "%~dp0"
call "%~dp0start-material-library.bat" %*
exit /b %errorlevel%