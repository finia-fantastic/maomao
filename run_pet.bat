@echo off
title AIRI Pet Launcher
cd /d "C:\Users\Administrator\airi-app"
set ELECTRON_RUN_AS_NODE=
echo Starting voice backend (GPT-SoVITS API + bridge) in a separate window...
start "" "I:\GPT-SoVITS\run_voice.bat"
echo Syncing dances from the drop folder...
node sync-dances.mjs
echo Starting AIRI desktop pet (first compile takes 1-2 minutes, then a window appears)...
pnpm dev:tamagotchi
pause
