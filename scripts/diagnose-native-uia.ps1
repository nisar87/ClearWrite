param([int]$WaitSeconds = 30, [switch]$BackgroundMetadata)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$root = Split-Path $PSScriptRoot -Parent
Add-Type -Path (Join-Path $root 'assets/windows/Interop.UIAutomationClient.dll')
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class NativeFocusMetadata {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
}
'@
$deadline = [DateTime]::UtcNow.AddSeconds($WaitSeconds)
if ($BackgroundMetadata) {
  $target = @(Get-Process -Name 'WhatsApp.Root' | Where-Object { $_.MainWindowHandle -ne 0 })
  if ($target.Count -ne 1) { throw 'Expected one WhatsApp window.' }
  $window = $target[0].MainWindowHandle
  $process = 'whatsapp.root'
} else {
do {
  $window = [NativeFocusMetadata]::GetForegroundWindow()
  $hostPid = [uint32]0
  $null = [NativeFocusMetadata]::GetWindowThreadProcessId($window, [ref]$hostPid)
  $process = [Diagnostics.Process]::GetProcessById($hostPid).ProcessName.ToLowerInvariant()
  if ($process -eq 'whatsapp.root') { break }
  Start-Sleep -Milliseconds 150
} while ([DateTime]::UtcNow -lt $deadline)
if ($process -ne 'whatsapp.root') { 'Target focus was not observed'; exit }
}
Add-Type -Path (Join-Path $PSScriptRoot 'native-uia-metadata.cs') -ReferencedAssemblies (Join-Path $root 'assets/windows/Interop.UIAutomationClient.dll')
$nodes = [NativeUiaMetadata]::Inspect($(if ($BackgroundMetadata) { $window.ToInt64() } else { 0 }))
@{ process = $process; nodes = $nodes } | ConvertTo-Json -Depth 4 -Compress
