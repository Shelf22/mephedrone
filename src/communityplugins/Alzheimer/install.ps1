param(
    [string]$EquicordPath = (Join-Path $env:USERPROFILE 'Equicord')
)

$ErrorActionPreference = 'Stop'
$checkout = (Resolve-Path -LiteralPath $EquicordPath).Path
if (-not (Test-Path -LiteralPath (Join-Path $checkout 'src\plugins\pinDms\index.tsx'))) {
    throw 'Choose an Equicord or Vencord source checkout with PinDMs installed.'
}
$destination = Join-Path $checkout 'src\userplugins\alzheimer'
New-Item -ItemType Directory -Path $destination -Force | Out-Null
foreach ($name in @('index.tsx', 'activity.ts', 'core.ts', 'reminders.ts', 'style.css')) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination (Join-Path $destination $name)
}
Push-Location -LiteralPath $checkout
try {
    & pnpm.cmd --config.verifyDepsBeforeRun=false build
    if ($LASTEXITCODE -ne 0) { throw 'Equicord/Vencord build failed.' }
} finally {
    Pop-Location
}
Write-Output 'Alzheimer installed and built. Restart Discord and enable Alzheimer in plugin settings.'
