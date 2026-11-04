$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$null = Add-Type -AssemblyName UIAutomationClient
$null = Add-Type -AssemblyName UIAutomationTypes
$native = @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class ClearWriteFocusNative {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  public static string ForegroundTitle() {
    var text = new StringBuilder(512);
    GetWindowText(GetForegroundWindow(), text, text.Capacity);
    return text.ToString();
  }
  public static long ForegroundHandle() { return GetForegroundWindow().ToInt64(); }
}
"@
$null = Add-Type -TypeDefinition $native
$lastKey = ''
$lastText = $null
$lastActive = $false
$readFailures = 0
$lastReportedApp = ''
$lastBlockedApp = ''
$lastSuppressedApp = ''
$excludedProcesses = @('cmd', 'powershell', 'pwsh', 'windowsterminal', 'wt', 'regedit')
try {
  $configuredExclusions = ConvertFrom-Json -InputObject $env:CLEARWRITE_EXCLUDED_PROCESSES
  if ($configuredExclusions -is [System.Array]) { $excludedProcesses += @($configuredExclusions | ForEach-Object { ([string]$_).ToLowerInvariant() }) }
} catch { }
$excludedProcesses = @($excludedProcesses | Select-Object -Unique)
$allowedProcesses = @()
$restrictToAllowed = $env:CLEARWRITE_RESTRICT_TO_ALLOWED -eq 'true'
try {
  $configuredAllowed = ConvertFrom-Json -InputObject $env:CLEARWRITE_ALLOWED_PROCESSES
  if ($configuredAllowed -is [System.Array]) { $allowedProcesses = @($configuredAllowed | ForEach-Object { ([string]$_).ToLowerInvariant() }) }
} catch { }

function Send-Payload($payload) {
  [Console]::Out.WriteLine(($payload | ConvertTo-Json -Compress -Depth 4))
  [Console]::Out.Flush()
}
$script:lastHeartbeat = [Environment]::TickCount64
function Send-HeartbeatIfDue {
  $now = [Environment]::TickCount64
  if ($now - $script:lastHeartbeat -ge 1000) {
    Send-Payload @{ reason = 'heartbeat' }
    $script:lastHeartbeat = $now
  }
}

while ($true) {
  try {
    $element = [System.Windows.Automation.AutomationElement]::FocusedElement
    if ($null -eq $element) { throw 'No focused element.' }
    $current = $element.Current
    if ($current.ProcessId -eq [int]$env:CLEARWRITE_PID -or [ClearWriteFocusNative]::ForegroundTitle() -like '*ClearWrite*') {
      if ($lastReportedApp -ne 'clearwrite') {
        Send-Payload @{ active = $false; reason = 'appDetected'; processName = 'clearwrite' }
        $lastReportedApp = 'clearwrite'
        $lastKey = ''
        $lastText = $null
        $lastActive = $false
      }
      $readFailures = 0
      Send-HeartbeatIfDue
      Start-Sleep -Milliseconds 150
      continue
    }
    $processName = [System.Diagnostics.Process]::GetProcessById($current.ProcessId).ProcessName.ToLowerInvariant()
    if ($processName -ne $lastReportedApp) {
      Send-Payload @{ active = $false; reason = 'appDetected'; processName = $processName }
      $lastReportedApp = $processName
      $lastKey = ''
      $lastText = $null
      $lastActive = $false
    }
    if ($current.IsPassword) {
      if ($lastActive) { Send-Payload @{ active = $false; reason = 'password' } }
      $lastKey = ''
      $lastText = $null
      $lastActive = $false
      $readFailures = 0
      Send-HeartbeatIfDue
      Start-Sleep -Milliseconds 150
      continue
    }
    if ($processName -in $excludedProcesses) {
      if ($lastSuppressedApp -ne $processName) { Send-Payload @{ active = $false; reason = 'excludedApp'; processName = $processName } }
      $lastSuppressedApp = $processName
      $lastKey = ''
      $lastText = $null
      $lastActive = $false
      $readFailures = 0
      Send-HeartbeatIfDue
      Start-Sleep -Milliseconds 150
      continue
    }
    $lastSuppressedApp = ''
    if ($restrictToAllowed -and $processName -notin $allowedProcesses) {
      if ($lastBlockedApp -ne $processName) { Send-Payload @{ active = $false; reason = 'notAllowed'; processName = $processName } }
      $lastBlockedApp = $processName
      $lastKey = ''
      $lastText = $null
      $lastActive = $false
      $readFailures = 0
      Send-HeartbeatIfDue
      Start-Sleep -Milliseconds 150
      continue
    }
    $lastBlockedApp = ''
    $type = $current.ControlType.ProgrammaticName
    if ($type -notin @('ControlType.Edit', 'ControlType.Document', 'ControlType.ComboBox')) { throw 'Not a supported text field.' }

    $pattern = $null
    $value = ''
    $isReadOnly = $true
    if ($element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) {
      $value = $pattern.Current.Value
      $isReadOnly = $pattern.Current.IsReadOnly
    } else { throw 'No editable value pattern.' }

    if ($isReadOnly) {
      if ($lastActive) { Send-Payload @{ active = $false; reason = 'readonly' } }
      $lastKey = ''
      $lastText = $null
      $lastActive = $false
      $readFailures = 0
      Send-HeartbeatIfDue
      Start-Sleep -Milliseconds 150
      continue
    }

    if ($null -eq $value) { $value = '' }
    $readFailures = 0
    $runtimeId = [string]::Join('.', $element.GetRuntimeId())
    $key = "$($current.ProcessId)|$runtimeId"
    $textChanged = $lastActive -and $key -eq $lastKey -and $value -cne $lastText
    if (-not $lastActive -or $key -ne $lastKey -or $value -cne $lastText) {
      $rectangle = $current.BoundingRectangle
      $payload = @{
        active = $true
        key = $key
        processId = $current.ProcessId
        processName = $processName
        runtimeId = $runtimeId
        controlName = $current.Name
        automationId = $current.AutomationId
        controlType = $type
        editable = $true
        readOnly = $false
        changed = $textChanged
        target = [ClearWriteFocusNative]::ForegroundHandle()
        text = $value
        x = [int]$rectangle.X
        y = [int]$rectangle.Y
        width = [int]$rectangle.Width
        height = [int]$rectangle.Height
        replaceSupported = ($type -eq 'ControlType.Edit' -or $type -eq 'ControlType.ComboBox')
        tooLong = ($value.Length -gt 6000)
      }
      if (-not $payload.tooLong) { Send-Payload $payload }
      elseif ($lastActive) { Send-Payload @{ active = $false; reason = 'tooLong' } }
      $lastKey = $key
      $lastText = $value
      $lastActive = (-not $payload.tooLong)
    }
  } catch {
    if ($lastActive) {
      $readFailures += 1
      if ($readFailures -lt 3) { Send-HeartbeatIfDue; Start-Sleep -Milliseconds 150; continue }
      Send-Payload @{ active = $false; reason = 'unsupported' }
    }
    $lastKey = ''
    $lastText = $null
    $lastActive = $false
    $readFailures = 0
  }
  Send-HeartbeatIfDue
  Start-Sleep -Milliseconds 150
}
