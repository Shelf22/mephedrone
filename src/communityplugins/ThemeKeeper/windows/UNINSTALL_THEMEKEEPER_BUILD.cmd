@echo off
setlocal
chcp 65001 >nul
title Uninstall archived Vencord build

set "ROOT=%~dp0"
set "INSTALLER=%ROOT%dist\Installer\VencordInstallerCli.exe"
set "LAUNCHER=%ROOT%Start-DiscordThemeKeeper.ps1"

if not exist "%INSTALLER%" (
    echo ERROR: VencordInstallerCli.exe was not found.
    pause
    exit /b 1
)

if exist "%LAUNCHER%" (
    echo Stopping the ThemeKeeper update Guardian...
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%LAUNCHER%" -RemoveGuardian
)

taskkill /IM Discord.exe /F >nul 2>&1

set "VENCORD_USER_DATA_DIR=%ROOT%"
set "VENCORD_DEV_INSTALL=1"

echo Uninstalling the archived Vencord build...
"%INSTALLER%" -uninstall -branch stable
if errorlevel 1 (
    echo.
    echo Uninstall failed.
    pause
    exit /b 1
)

if exist "%LAUNCHER%" (
    echo Restoring the original Discord desktop shortcut...
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%LAUNCHER%" -RestoreOriginalShortcutOnly
    if errorlevel 1 (
        echo.
        echo WARNING: Vencord was uninstalled, but the desktop shortcut could not be restored automatically.
        echo You can recreate the Discord shortcut manually from the Start menu.
    )
)

echo.
echo Done. Guardian and Vencord were removed, and the original Discord shortcut was restored.
pause