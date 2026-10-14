@echo off
setlocal
chcp 65001 >nul
title GarageFlows - Configuration complete
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 est requis. Installez-le puis relancez config.cmd.
  pause
  exit /b 1
)
node "%~dp0config" %*
set "GF_CONFIG_EXIT=%ERRORLEVEL%"
pause
exit /b %GF_CONFIG_EXIT%
