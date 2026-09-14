@echo off
cd /d "%~dp0"
title GTA RP Duty Bot - Setup
if not exist .env copy .env.example .env
npm install
echo.
echo Setup complete. Open the .env file and add your Discord details, then run start.bat.
pause
