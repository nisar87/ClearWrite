$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$target = Join-Path $root 'assets/windows'
$manifest = Get-Content -Raw (Join-Path $target 'manifest.json') | ConvertFrom-Json
$cache = Join-Path $root 'cache/uia3-diagnostic'
New-Item -ItemType Directory -Path $cache -Force | Out-Null
$package = Join-Path $cache 'interop.nupkg'
Invoke-WebRequest -Uri $manifest.source -OutFile $package -UseBasicParsing
if ((Get-FileHash -LiteralPath $package -Algorithm SHA256).Hash.ToLowerInvariant() -ne $manifest.packageSha256) { throw 'Package checksum mismatch.' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($package)
try {
  [IO.Compression.ZipFileExtensions]::ExtractToFile($archive.GetEntry($manifest.file), (Join-Path $target 'Interop.UIAutomationClient.dll'), $true)
  [IO.Compression.ZipFileExtensions]::ExtractToFile($archive.GetEntry('LICENSE.txt'), (Join-Path $target 'UIAUTOMATION-LICENSE.txt'), $true)
} finally { $archive.Dispose() }
if ((Get-FileHash -LiteralPath (Join-Path $target 'Interop.UIAutomationClient.dll') -Algorithm SHA256).Hash.ToLowerInvariant() -ne $manifest.sha256) { throw 'Assembly checksum mismatch.' }
'Verified UI Automation interop assembly and license restored.'
