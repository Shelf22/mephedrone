@echo off
setlocal
chcp 65001 >nul
title Install Discord ThemeKeeper Shortcut

set "ROOT=%~dp0"
set "SCRIPT=%ROOT%Start-DiscordThemeKeeper.ps1"

if not exist "%SCRIPT%" (
    echo ERROR: Start-DiscordThemeKeeper.ps1 was not found.
    echo Extract the whole archive before running this file.
    pause
    exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" -InstallGuardian
set "EXITCODE=%ERRORLEVEL%"

if "%EXITCODE%"=="0" (
    echo.
    echo Done. The protected Discord shortcut and silent update Guardian are installed.
)

pause
exit /b %EXITCODE%
