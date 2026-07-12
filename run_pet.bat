@echo off
title AIRI Pet Launcher
cd /d "C:\Users\Administrator\airi-app"
set ELECTRON_RUN_AS_NODE=
echo Starting AIRI desktop pet (first compile takes 1-2 minutes, then a window appears)...
pnpm dev:tamagotchi
pause
