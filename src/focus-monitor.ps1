$ErrorActionPreference = 'SilentlyContinue'
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

function Send-Payload($payload) {
  [Console]::Out.WriteLine(($payload | ConvertTo-Json -Compress -Depth 4))
  [Console]::Out.Flush()
}

while ($true) {
  try {
    $element = [System.Windows.Automation.AutomationElement]::FocusedElement
    if ($null -eq $element) { throw 'No focused element.' }
    $current = $element.Current
    if ($current.ProcessId -eq [int]$env:CLEARWRITE_PID -or [ClearWriteFocusNative]::ForegroundTitle() -like '*ClearWrite*') {
      $readFailures = 0
      Start-Sleep -Milliseconds 300
      continue
    }
    if ($current.IsPassword) {
      if ($lastActive) { Send-Payload @{ active = $false; reason = 'password' } }
      $lastKey = ''
      $lastText = $null
      $lastActive = $false
      $readFailures = 0
      Start-Sleep -Milliseconds 300
      continue
    }
    $type = $current.ControlType.ProgrammaticName
    if ($type -notin @('ControlType.Edit', 'ControlType.Document', 'ControlType.ComboBox')) { throw 'Not a supported text field.' }

    $pattern = $null
    $value = ''
    $isReadOnly = $false
    if ($element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) {
      $value = $pattern.Current.Value
      $isReadOnly = $pattern.Current.IsReadOnly
    } else {
      $pattern = $null
      if ($element.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$pattern)) {
        $value = $pattern.DocumentRange.GetText(6001)
      } else { throw 'No readable text pattern.' }
    }

    if ($isReadOnly) {
      if ($lastActive) { Send-Payload @{ active = $false; reason = 'readonly' } }
      $lastKey = ''
      $lastText = $null
      $lastActive = $false
      $readFailures = 0
      Start-Sleep -Milliseconds 300
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
      if ($readFailures -lt 3) { Start-Sleep -Milliseconds 300; continue }
      Send-Payload @{ active = $false; reason = 'unsupported' }
    }
    $lastKey = ''
    $lastText = $null
    $lastActive = $false
    $readFailures = 0
  }
  Start-Sleep -Milliseconds 300
}
