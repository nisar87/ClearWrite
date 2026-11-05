param([string]$ProcessName = 'whatsapp.root', [int]$WaitSeconds = 30)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$root = Split-Path $PSScriptRoot -Parent
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName WindowsBase
Add-Type -AssemblyName Accessibility
$interop = Join-Path $root 'assets/windows/Interop.UIAutomationClient.dll'
Add-Type -Path $interop
$references = @(
  ([System.Windows.Automation.AutomationElement].Assembly.Location)
  ([System.Windows.Automation.AutomationIdentifier].Assembly.Location)
  ([System.Windows.Rect].Assembly.Location)
  ([Accessibility.IAccessible].Assembly.Location)
  $interop
)
Add-Type -Path @((Join-Path $root 'src/editor-reader.cs'), (Join-Path $root 'src/native-editor-reader.cs')) -ReferencedAssemblies $references
[ClearWriteNativeEditorReader]::Initialize()
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ProbeForeground {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
}
'@
$deadline = [DateTime]::UtcNow.AddSeconds($WaitSeconds)
do {
  $window = [ProbeForeground]::GetForegroundWindow()
  $ownerPid = [uint32]0
  $null = [ProbeForeground]::GetWindowThreadProcessId($window, [ref]$ownerPid)
  $owner = [Diagnostics.Process]::GetProcessById($ownerPid).ProcessName.ToLowerInvariant()
  if ($owner -eq $ProcessName) {
    $clock = [Diagnostics.Stopwatch]::StartNew()
    do {
      $result = [ClearWriteNativeEditorReader]::Read($window.ToInt64(), $ProcessName, [string[]]@('mstsc','msrdc','vmconnect','anydesk','teamviewer'))
      if ($result.active) { break }
      Start-Sleep -Milliseconds 150
    } while ($clock.ElapsedMilliseconds -lt 6000 -and [ProbeForeground]::GetForegroundWindow() -eq $window)
    # Only metadata is printed. No field text, labels, selection, titles or prompts.
    @{ active = $result.active; reader = $result.reader; reason = $result.reason; nativeStatus = [ClearWriteNativeEditorReader]::LastStatus; replaceSupported = $result.replaceSupported; elapsedMs = $clock.ElapsedMilliseconds } | ConvertTo-Json -Compress
    exit
  }
  Start-Sleep -Milliseconds 150
} while ([DateTime]::UtcNow -lt $deadline)
'Target focus was not observed'
