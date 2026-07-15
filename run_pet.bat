@echo off
title AIRI Pet Launcher
cd /d "C:\Users\Administrator\airi-app"
set ELECTRON_RUN_AS_NODE=

echo Killing old AIRI instances...
taskkill /F /IM electron.exe >nul 2>&1
timeout /t 2 /nobreak >nul

echo Starting voice backend (GPT-SoVITS API + bridge) in a separate window...
start "" "I:\GPT-SoVITS\run_voice.bat"

echo Starting AIRI desktop pet (port 5173, first compile takes 1-2 minutes)...
pnpm dev:tamagotchi
pause
