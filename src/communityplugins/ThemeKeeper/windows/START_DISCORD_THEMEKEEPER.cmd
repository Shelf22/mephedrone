@echo off
setlocal
chcp 65001 >nul
title Discord

set "ROOT=%~dp0"
set "SCRIPT=%ROOT%Start-DiscordThemeKeeper.ps1"

if not exist "%SCRIPT%" (
    echo ERROR: Start-DiscordThemeKeeper.ps1 was not found.
    echo Extract the whole archive before running this file.
    pause
    exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" %*
set "EXITCODE=%ERRORLEVEL%"

if not "%EXITCODE%"=="0" (
    pause
)

exit /b %EXITCODE%
