param(
    [switch]$Quiet,
    [switch]$NoLaunch,
    [switch]$CreateShortcutOnly,
    [switch]$ForceShortcut,
    [switch]$RestoreOriginalShortcutOnly,
    [switch]$FromRestore,
    [switch]$CheckOnly,
    [switch]$Guardian,
    [switch]$InstallGuardian,
    [switch]$RemoveGuardian
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$Root = if ($PSScriptRoot) {
    $PSScriptRoot
} else {
    Split-Path -Parent $MyInvocation.MyCommand.Path
}

$Root = [System.IO.Path]::GetFullPath($Root)
$Installer = Join-Path $Root "dist\Installer\VencordInstallerCli.exe"
$LauncherScript = Join-Path $Root "Start-DiscordThemeKeeper.ps1"
$LauncherVbs = Join-Path $Root "Start-DiscordThemeKeeper.vbs"
$SettingsDir = Join-Path $Root "settings"
$LogPath = Join-Path $SettingsDir "themeKeeper-launcher.log"
$GuardianStopPath = Join-Path $SettingsDir "themeKeeper-guardian.stop"
$GuardianPidPath = Join-Path $SettingsDir "themeKeeper-guardian.pid"
$GuardianShortcutName = "Discord ThemeKeeper Guardian.lnk"

function Write-LauncherLog {
    param([string]$Message)

    try {
        if (-not (Test-Path -LiteralPath $SettingsDir)) {
            New-Item -ItemType Directory -Path $SettingsDir -Force | Out-Null
        }

        $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
        Add-Content -LiteralPath $LogPath -Encoding UTF8 -Value "[$timestamp] $Message"
    } catch {
        # Logging should never break Discord startup.
    }
}

function Write-Info {
    param([string]$Message)

    if (-not $Quiet) {
        Write-Host $Message
    }

    Write-LauncherLog $Message
}

function Write-Warn {
    param([string]$Message)

    if (-not $Quiet) {
        Write-Host $Message -ForegroundColor Yellow
    }

    Write-LauncherLog "WARN: $Message"
}

function Get-DiscordStableApp {
    $discordBase = Join-Path $env:LOCALAPPDATA "Discord"

    if (-not (Test-Path -LiteralPath $discordBase)) {
        throw "Discord Stable was not found in $discordBase. Install Discord and launch it once first."
    }

    $apps = Get-ChildItem -LiteralPath $discordBase -Directory -Filter "app-*" -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending

    foreach ($app in $apps) {
        $exe = Join-Path $app.FullName "Discord.exe"
        $asar = Join-Path $app.FullName "resources\app.asar"

        if (Test-Path -LiteralPath $exe) {
            return [pscustomobject]@{
                Directory = $app.FullName
                Exe       = $exe
                AppAsar   = $asar
            }
        }
    }

    throw "Discord.exe was not found inside $discordBase\app-*."
}

function Test-ThemeKeeperVencordInstalled {
    param($DiscordApp)

    if (-not (Test-Path -LiteralPath $DiscordApp.AppAsar)) {
        return $false
    }

    $expectedPatcher = Join-Path $Root "dist\patcher.js"
    $expectedCandidates = @(
        $expectedPatcher,
        $expectedPatcher.Replace("\", "\\"),
        $expectedPatcher.Replace("\", "/")
    )

    $bytes = [System.IO.File]::ReadAllBytes($DiscordApp.AppAsar)
    $text = [System.Text.Encoding]::UTF8.GetString($bytes)

    foreach ($candidate in $expectedCandidates) {
        if ($text.IndexOf($candidate, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
            return $true
        }
    }

    return $false
}

function Stop-Discord {
    $processes = Get-Process -Name "Discord" -ErrorAction SilentlyContinue

    if ($processes) {
        Write-Info "Closing Discord before repairing Vencord..."
        $processes | Stop-Process -Force
        Start-Sleep -Milliseconds 900
    }
}

function Install-ThemeKeeperVencord {
    if (-not (Test-Path -LiteralPath $Installer)) {
        throw "VencordInstallerCli.exe was not found at $Installer. Extract the whole archive first."
    }

    Stop-Discord

    $oldUserDataDir = [Environment]::GetEnvironmentVariable("VENCORD_USER_DATA_DIR", "Process")
    $oldDevInstall = [Environment]::GetEnvironmentVariable("VENCORD_DEV_INSTALL", "Process")

    try {
        $env:VENCORD_USER_DATA_DIR = $Root
        $env:VENCORD_DEV_INSTALL = "1"

        Write-Info "Installing the bundled Vencord build with ThemeKeeper..."
        & $Installer -install -branch stable

        if ($LASTEXITCODE -ne 0) {
            throw "Vencord installer failed with exit code $LASTEXITCODE."
        }
    } finally {
        if ($null -eq $oldUserDataDir) {
            Remove-Item Env:\VENCORD_USER_DATA_DIR -ErrorAction SilentlyContinue
        } else {
            $env:VENCORD_USER_DATA_DIR = $oldUserDataDir
        }

        if ($null -eq $oldDevInstall) {
            Remove-Item Env:\VENCORD_DEV_INSTALL -ErrorAction SilentlyContinue
        } else {
            $env:VENCORD_DEV_INSTALL = $oldDevInstall
        }
    }
}

function Get-DesktopShortcutPath {
    $desktop = [Environment]::GetFolderPath("DesktopDirectory")

    if ([string]::IsNullOrWhiteSpace($desktop)) {
        throw "Could not resolve the current user's Desktop folder."
    }

    return Join-Path $desktop "Discord.lnk"
}

function Get-StartupShortcutPath {
    $startup = [Environment]::GetFolderPath("Startup")

    if ([string]::IsNullOrWhiteSpace($startup)) {
        throw "Could not resolve the current user's Startup folder."
    }

    return Join-Path $startup $GuardianShortcutName
}

function Test-ShortcutUsesLauncher {
    param([string]$ShortcutPath)

    if (-not (Test-Path -LiteralPath $ShortcutPath)) {
        return $false
    }

    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($ShortcutPath)
    $args = [string]$shortcut.Arguments

    return $args.IndexOf($LauncherVbs, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
}

function New-DiscordLauncherShortcut {
    param($DiscordApp)

    $shortcutPath = Get-DesktopShortcutPath
    $wscript = Join-Path $env:SystemRoot "System32\wscript.exe"

    if (-not (Test-Path -LiteralPath $wscript)) {
        throw "wscript.exe was not found at $wscript."
    }

    if (-not (Test-Path -LiteralPath $LauncherVbs)) {
        throw "Start-DiscordThemeKeeper.vbs was not found at $LauncherVbs."
    }

    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)

    $shortcut.TargetPath = $wscript
    $shortcut.Arguments = "`"$LauncherVbs`""
    $shortcut.WorkingDirectory = $Root
    $shortcut.IconLocation = "$($DiscordApp.Exe),0"
    $shortcut.Description = "Discord"
    $shortcut.Save()

    Write-Info "Desktop shortcut was created: $shortcutPath"
}

function New-GuardianStartupShortcut {
    $shortcutPath = Get-StartupShortcutPath
    $wscript = Join-Path $env:SystemRoot "System32\wscript.exe"

    if (-not (Test-Path -LiteralPath $wscript)) {
        throw "wscript.exe was not found at $wscript."
    }

    if (-not (Test-Path -LiteralPath $LauncherVbs)) {
        throw "Start-DiscordThemeKeeper.vbs was not found at $LauncherVbs."
    }

    if (-not (Test-Path -LiteralPath $SettingsDir)) {
        New-Item -ItemType Directory -Path $SettingsDir -Force | Out-Null
    }

    Remove-Item -LiteralPath $GuardianStopPath -Force -ErrorAction SilentlyContinue

    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $wscript
    $shortcut.Arguments = "`"$LauncherVbs`" -Guardian"
    $shortcut.WorkingDirectory = $Root
    $shortcut.IconLocation = "$wscript,0"
    $shortcut.Description = "Keeps Vencord with ThemeKeeper installed after Discord updates"
    $shortcut.Save()

    Write-Info "ThemeKeeper Guardian was added to Windows Startup: $shortcutPath"
}

function Start-GuardianProcess {
    $wscript = Join-Path $env:SystemRoot "System32\wscript.exe"
    $arguments = "`"$LauncherVbs`" -Guardian"
    Start-Process -FilePath $wscript -ArgumentList $arguments -WindowStyle Hidden
    Write-Info "ThemeKeeper Guardian was started in the background."
}

function Remove-GuardianStartup {
    $shortcutPath = Get-StartupShortcutPath

    if (-not (Test-Path -LiteralPath $SettingsDir)) {
        New-Item -ItemType Directory -Path $SettingsDir -Force | Out-Null
    }

    [System.IO.File]::WriteAllText($GuardianStopPath, [string](Get-Date).Ticks, [System.Text.Encoding]::UTF8)
    Remove-Item -LiteralPath $shortcutPath -Force -ErrorAction SilentlyContinue

    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        if (-not (Test-Path -LiteralPath $GuardianPidPath)) {
            break
        }

        Start-Sleep -Milliseconds 250
    }

    Write-Info "ThemeKeeper Guardian was removed from Windows Startup."
}

function New-OriginalDiscordShortcut {
    param($DiscordApp)

    $shortcutPath = Get-DesktopShortcutPath
    $updateExe = Join-Path $env:LOCALAPPDATA "Discord\Update.exe"

    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)

    if (Test-Path -LiteralPath $updateExe) {
        $shortcut.TargetPath = $updateExe
        $shortcut.Arguments = "--processStart Discord.exe"
        $shortcut.WorkingDirectory = Split-Path -Parent $updateExe
    } else {
        $shortcut.TargetPath = $DiscordApp.Exe
        $shortcut.Arguments = ""
        $shortcut.WorkingDirectory = $DiscordApp.Directory
    }

    $shortcut.IconLocation = "$($DiscordApp.Exe),0"
    $shortcut.Description = "Discord"
    $shortcut.Save()

    Write-Info "Desktop shortcut was restored to the original Discord launcher: $shortcutPath"
}

function Read-YesNo {
    param([string]$Question)

    if ($Quiet) {
        return $false
    }

    Write-Host ""
    $answer = Read-Host "$Question [Y/N]"
    $normalized = $answer.Trim().ToLowerInvariant()

    return @("y", "yes", "d", "da", "д", "да").Contains($normalized)
}

function Ensure-DesktopShortcut {
    param($DiscordApp)

    $shortcutPath = Get-DesktopShortcutPath

    if (Test-ShortcutUsesLauncher -ShortcutPath $shortcutPath) {
        Write-Info "Desktop shortcut already starts Discord through ThemeKeeper launcher."
        return
    }

    if ($ForceShortcut) {
        New-DiscordLauncherShortcut -DiscordApp $DiscordApp
        return
    }

    $exists = Test-Path -LiteralPath $shortcutPath
    $question = if ($exists) {
        "Replace the desktop Discord shortcut with an identical-looking ThemeKeeper launcher?"
    } else {
        "Create a desktop Discord shortcut that starts through ThemeKeeper launcher?"
    }

    if (Read-YesNo -Question $question) {
        New-DiscordLauncherShortcut -DiscordApp $DiscordApp
    } else {
        Write-Info "Desktop shortcut was left unchanged."
    }
}

function Start-DiscordStable {
    param($DiscordApp)

    if ($NoLaunch) {
        Write-Info "Launch skipped by request."
        return
    }

    $updateExe = Join-Path $env:LOCALAPPDATA "Discord\Update.exe"

    if (Test-Path -LiteralPath $updateExe) {
        Write-Info "Starting Discord Stable..."
        Start-Process -FilePath $updateExe -ArgumentList "--processStart", "Discord.exe"
        return
    }

    Write-Info "Starting Discord Stable directly..."
    Start-Process -FilePath $DiscordApp.Exe
}

function Invoke-GuardianCycle {
    $discordApp = Get-DiscordStableApp

    $shortcutPath = Get-DesktopShortcutPath
    if (-not (Test-ShortcutUsesLauncher -ShortcutPath $shortcutPath)) {
        Write-Warn "Discord replaced the protected desktop shortcut. Restoring it."
        New-DiscordLauncherShortcut -DiscordApp $discordApp
    }

    if (Test-ThemeKeeperVencordInstalled -DiscordApp $discordApp) {
        return
    }

    $discordProcesses = Get-Process -Name "Discord" -ErrorAction SilentlyContinue
    if (-not $discordProcesses) {
        return
    }

    Write-Warn "Discord started without the ThemeKeeper Vencord patch. Repairing it."
    Start-Sleep -Milliseconds 1500
    Install-ThemeKeeperVencord

    $discordApp = Get-DiscordStableApp
    if (-not (Test-ThemeKeeperVencordInstalled -DiscordApp $discordApp)) {
        throw "Guardian repair finished, but the Discord patch was not detected."
    }

    New-DiscordLauncherShortcut -DiscordApp $discordApp
    Write-Info "Guardian repaired Vencord after a Discord update."
    Start-DiscordStable -DiscordApp $discordApp
}

function Start-ThemeKeeperGuardian {
    $createdNew = $false
    $mutex = New-Object System.Threading.Mutex($true, "Local\FakeNitroKeeper.ThemeKeeperGuardian", [ref]$createdNew)

    if (-not $createdNew) {
        $mutex.Dispose()
        return
    }

    if (-not (Test-Path -LiteralPath $SettingsDir)) {
        New-Item -ItemType Directory -Path $SettingsDir -Force | Out-Null
    }

    Remove-Item -LiteralPath $GuardianStopPath -Force -ErrorAction SilentlyContinue
    [System.IO.File]::WriteAllText($GuardianPidPath, [string]$PID, [System.Text.Encoding]::ASCII)
    Write-LauncherLog "ThemeKeeper Guardian started (PID $PID)."

    try {
        while (-not (Test-Path -LiteralPath $GuardianStopPath)) {
            try {
                Invoke-GuardianCycle
            } catch {
                Write-LauncherLog "WARN: Guardian cycle failed: $($_.Exception.Message)"
            }

            for ($part = 0; $part -lt 20; $part++) {
                if (Test-Path -LiteralPath $GuardianStopPath) {
                    break
                }

                Start-Sleep -Milliseconds 500
            }
        }
    } finally {
        Remove-Item -LiteralPath $GuardianPidPath -Force -ErrorAction SilentlyContinue
        Write-LauncherLog "ThemeKeeper Guardian stopped."
        $mutex.ReleaseMutex()
        $mutex.Dispose()
    }
}

try {
    if ($Guardian) {
        Start-ThemeKeeperGuardian
        exit 0
    }

    if ($RemoveGuardian) {
        Remove-GuardianStartup
        exit 0
    }

    if ($FromRestore) {
        Write-Info "Restore completed. Preparing launcher checks..."
    }

    $discordApp = Get-DiscordStableApp

    if ($InstallGuardian) {
        New-GuardianStartupShortcut
        New-DiscordLauncherShortcut -DiscordApp $discordApp
        Start-GuardianProcess
        exit 0
    }

    if ($RestoreOriginalShortcutOnly) {
        New-OriginalDiscordShortcut -DiscordApp $discordApp
        exit 0
    }

    if ($CreateShortcutOnly) {
        Ensure-DesktopShortcut -DiscordApp $discordApp
        exit 0
    }

    $installed = Test-ThemeKeeperVencordInstalled -DiscordApp $discordApp

    if ($CheckOnly) {
        if ($installed) {
            Write-Info "ThemeKeeper Vencord is installed for $($discordApp.Directory)."
            exit 0
        }

        Write-Warn "ThemeKeeper Vencord is not installed for $($discordApp.Directory)."
        exit 2
    }

    if ($FromRestore) {
        New-GuardianStartupShortcut
        New-DiscordLauncherShortcut -DiscordApp $discordApp
    } elseif (-not $Quiet) {
        Ensure-DesktopShortcut -DiscordApp $discordApp
    }

    if (-not $installed) {
        Write-Warn "Vencord is missing or points to another build. Repairing it now."
        Install-ThemeKeeperVencord

        $discordApp = Get-DiscordStableApp
        if (-not (Test-ThemeKeeperVencordInstalled -DiscordApp $discordApp)) {
            throw "Vencord repair finished, but the Discord patch was not detected."
        }

        Write-Info "Vencord was repaired successfully."
    } else {
        Write-Info "ThemeKeeper Vencord is already installed."
    }

    if ($FromRestore) {
        Start-GuardianProcess
    }

    Start-DiscordStable -DiscordApp $discordApp
    exit 0
} catch {
    Write-Warn $_.Exception.Message

    if (-not $Quiet) {
        Write-Host ""
        Write-Host "Press Enter to close this window."
        [void][Console]::ReadLine()
    }

    exit 1
}