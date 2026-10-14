@echo off
setlocal
chcp 65001 >nul
title GarageFlows - Configuration complete
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22.12 ou plus recent dans la branche 22.x est requis. Installez-le puis relancez config.cmd.
  if "%~1"=="" pause
  exit /b 1
)
node "%~dp0config" %*
set "GF_CONFIG_EXIT=%ERRORLEVEL%"
if "%~1"=="" pause
exit /b %GF_CONFIG_EXIT%
