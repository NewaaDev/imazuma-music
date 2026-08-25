$ErrorActionPreference = 'Stop'
$Host.UI.RawUI.WindowTitle = 'Inazuma Music - Local'
Set-Location -LiteralPath $PSScriptRoot

# Une ancienne passerelle de transition peut encore tourner après une mise à jour.
Get-CimInstance Win32_Process |
    Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*start-remote-relay.cjs*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Write-Host '=== Inazuma Music - test local ===' -ForegroundColor Cyan
Write-Host 'Colle le token du bot puis appuie sur Entree.' -ForegroundColor Yellow
$secureToken = Read-Host 'Token Discord' -AsSecureString
$tokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)

try {
    $env:DISCORD_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPointer)
    $env:DISCORD_GUILD_ID = '1468548264487031012'
    $env:YTDLP_PATH = Join-Path $PSScriptRoot 'yt-dlp.exe'
    $env:IDLE_DISCONNECT_MS = '0'
    $env:DEFAULT_VOLUME = '50'
    $env:AUTOPLAY = 'true'
    $env:DEFAULT_TEXT_CHANNEL_ID = '1468549227121610960'
    $env:NEWAA_RELAY_URL = 'wss://newaa-music-relay.augchast.workers.dev/ws'
    $env:NEWAA_RELAY_TOKEN = (Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot '.newaa-relay-token')).Trim()

    Write-Host 'Demarrage du bot...' -ForegroundColor Green
    node src/index.js
}
finally {
    $env:DISCORD_TOKEN = $null
    $env:NEWAA_RELAY_TOKEN = $null
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPointer)
}

Write-Host ''
Write-Host 'Le bot est arrete. Appuie sur Entree pour fermer.' -ForegroundColor Yellow
Read-Host
