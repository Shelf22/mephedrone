@echo off
setlocal
chcp 65001 >nul
title Restore Vencord with ThemeKeeper

set "ROOT=%~dp0"
set "INSTALLER=%ROOT%dist\Installer\VencordInstallerCli.exe"
set "LAUNCHER=%ROOT%START_DISCORD_THEMEKEEPER.cmd"

if not exist "%INSTALLER%" (
    echo ERROR: VencordInstallerCli.exe was not found.
    echo Extract the whole archive before running this file.
    pause
    exit /b 1
)

if not exist "%LOCALAPPDATA%\Discord" (
    echo ERROR: Discord Stable is not installed for this Windows account.
    echo Install and launch Discord once, close it, then run this file again.
    pause
    exit /b 1
)

echo Closing Discord...
taskkill /IM Discord.exe /F >nul 2>&1

set "VENCORD_USER_DATA_DIR=%ROOT%"
set "VENCORD_DEV_INSTALL=1"

echo Installing the archived Vencord build with ThemeKeeper...
"%INSTALLER%" -install -branch stable
if errorlevel 1 (
    echo.
    echo Installation failed. Try running this file as administrator.
    pause
    exit /b 1
)

echo.
echo Installation completed successfully.
echo Keep this folder in its current location while Vencord is installed.

if exist "%LAUNCHER%" (
    call "%LAUNCHER%" -FromRestore
) else if exist "%LOCALAPPDATA%\Discord\Update.exe" (
    start "" "%LOCALAPPDATA%\Discord\Update.exe" --processStart Discord.exe
)

pause
