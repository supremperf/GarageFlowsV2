@echo off
setlocal EnableExtensions
chcp 65001 >nul
echo [INFO] Lanceur renomme. Redirection vers RESET-GARAGEFLOW.cmd ...
call "%~dp0RESET-GARAGEFLOW.cmd" %*
exit /b %ERRORLEVEL%
