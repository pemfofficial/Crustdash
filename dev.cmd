@echo off
rem Development: runs the dashboard with live reload at http://localhost:3000
cd /d "%~dp0dashboard"
if not exist node_modules call npm install || exit /b 1
start "" http://localhost:3000
call npm run dev -- --port 3000
