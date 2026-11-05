$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$null = Add-Type -AssemblyName UIAutomationClient
$null = Add-Type -AssemblyName UIAutomationTypes
$native = @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class ClearWriteFocusNative {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  public static long ForegroundHandle() { return GetForegroundWindow().ToInt64(); }
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  public static uint ForegroundProcessId() { uint id; GetWindowThreadProcessId(GetForegroundWindow(), out id); return id; }
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  // Per-monitor DPI awareness v2: UI Automation rectangles are then physical pixels on every
  // monitor, which ClearWrite converts to Electron DIPs with screen.screenToDipRect.
  [DllImport("user32.dll")] static extern IntPtr GetThreadDpiAwarenessContext();
  [DllImport("user32.dll")] static extern int GetAwarenessFromDpiAwarenessContext(IntPtr value);
  public static bool UsePhysicalPixels() {
    try {
      SetProcessDpiAwarenessContext(new IntPtr(-4));
      return GetAwarenessFromDpiAwarenessContext(GetThreadDpiAwarenessContext()) == 2;
    } catch (EntryPointNotFoundException) { return false; }
  }
}
"@
$null = Add-Type -TypeDefinition $native
$physicalPixels = [ClearWriteFocusNative]::UsePhysicalPixels()

# Native z-order probe for the ClearWrite panel window (diagnostics + topmost repair input).
# Separate class: if it ever fails to compile, field monitoring above is unaffected.
# Reports only window-state flags, never window titles or text.
$panelNative = @"
using System;
using System.Runtime.InteropServices;
public static class ClearWritePanelNative {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll", EntryPoint = "GetWindowLongW")] static extern int GetWindowLong(IntPtr hWnd, int index);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr hWnd, uint command);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  static bool Topmost(IntPtr hWnd) { return (GetWindowLong(hWnd, -20) & 0x8) != 0; }
  // "gone", or four flags: visible, topmost, foregroundTopmost, coveredByForeground.
  public static string State(long handle) {
    IntPtr panel = new IntPtr(handle);
    if (handle == 0 || !IsWindow(panel)) return "gone";
    bool visible = IsWindowVisible(panel) && !IsIconic(panel);
    IntPtr foreground = GetForegroundWindow();
    bool covered = false;
    if (visible && foreground != IntPtr.Zero && foreground != panel) {
      int guard = 0;
      for (IntPtr above = GetWindow(panel, 3); above != IntPtr.Zero && guard < 5000; above = GetWindow(above, 3)) {
        guard++;
        if (above != foreground) continue;
        RECT a; RECT b;
        if (GetWindowRect(panel, out a) && GetWindowRect(foreground, out b)) {
          covered = a.Left < b.Right && b.Left < a.Right && a.Top < b.Bottom && b.Top < a.Bottom;
        }
        break;
      }
    }
    bool foregroundTopmost = foreground != IntPtr.Zero && Topmost(foreground);
    return (visible ? "1" : "0") + (Topmost(panel) ? "1" : "0") + (foregroundTopmost ? "1" : "0") + (covered ? "1" : "0");
  }
}
"@
$panelHandle = [long]0
try { $panelHandle = [long]$env:CLEARWRITE_PANEL_HWND } catch { $panelHandle = [long]0 }
$panelProbe = $false
try { $null = Add-Type -TypeDefinition $panelNative -ErrorAction Stop; $panelProbe = ($panelHandle -ne 0) } catch { $panelProbe = $false }
$lastPanelState = ''
$lastPayloadKey = ''
$lastPayloadText = $null
$lastHeartbeat = [DateTime]::MinValue
Add-Type -AssemblyName WindowsBase -ErrorAction Stop
Add-Type -AssemblyName Accessibility -ErrorAction Stop
$readerReferences = @(
  ([System.Windows.Automation.AutomationElement].Assembly.Location)
  ([System.Windows.Automation.AutomationIdentifier].Assembly.Location)
  ([System.Windows.Rect].Assembly.Location)
  ([Accessibility.IAccessible].Assembly.Location)
)
$nativeInterop = Join-Path (Split-Path $PSScriptRoot -Parent) 'assets/windows/Interop.UIAutomationClient.dll'
Add-Type -Path (Join-Path $PSScriptRoot 'editor-reader.cs') -ReferencedAssemblies $readerReferences -ErrorAction Stop
$nativeProcess = $null
if (Test-Path -LiteralPath $nativeInterop) {
  try {
    $interopManifest = Get-Content -Raw (Join-Path (Split-Path $PSScriptRoot -Parent) 'assets/windows/manifest.json') | ConvertFrom-Json
    $hasher = [Security.Cryptography.SHA256]::Create()
    try { $digest = [BitConverter]::ToString($hasher.ComputeHash([IO.File]::ReadAllBytes($nativeInterop))).Replace('-', '').ToLowerInvariant() }
    finally { $hasher.Dispose() }
    if ($digest -ne $interopManifest.sha256) { throw 'Native interop checksum mismatch.' }
    # UIA2's provider registrations affect UIA3 in the same process. Keep the
    # modern client in its own persistent, hidden child with private stdio IPC.
    $start = New-Object Diagnostics.ProcessStartInfo
    $start.FileName = Join-Path $PSHOME 'powershell.exe'
    $start.Arguments = '-NoLogo -NoProfile -NonInteractive -Mta -ExecutionPolicy Bypass -File "' + (Join-Path $PSScriptRoot 'native-focus-monitor.ps1') + '"'
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
    $start.RedirectStandardInput = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $start.StandardOutputEncoding = [Text.UTF8Encoding]::new($false)
    $nativeProcess = New-Object Diagnostics.Process
    $nativeProcess.StartInfo = $start
    $null = $nativeProcess.Start()
    $ready = $nativeProcess.StandardOutput.ReadLine()
    if ($env:CLEARWRITE_READER_VALIDATE -eq '1') {
      if ($ready -ne 'ok') { throw 'Native reader validation failed.' }
    } else {
      if ($ready -ne 'ready') { throw 'Native reader did not become ready.' }
      $callback = {
        param([long]$window, [string]$appName, [string[]]$exclusions)
        try {
          if ($nativeProcess.HasExited) { return $null }
          $nativeProcess.StandardInput.WriteLine((@{ window = $window; appName = $appName; excluded = $exclusions } | ConvertTo-Json -Compress))
          $line = $nativeProcess.StandardOutput.ReadLine()
          if (-not $line -or $line -eq 'null') { return $null }
          $response = $line | ConvertFrom-Json
          $result = New-Object 'System.Collections.Generic.Dictionary[string,object]'
          foreach ($property in $response.PSObject.Properties) { $result[$property.Name] = $property.Value }
          return $result
        } catch { return $null }
      }.GetNewClosure()
      [ClearWriteEditorReader]::NativeFallback = [ClearWriteEditorReader+NativeReader]$callback
    }
  } catch {
    if ($env:CLEARWRITE_READER_VALIDATE -eq '1') { throw }
    if ($nativeProcess -and -not $nativeProcess.HasExited) { $nativeProcess.Kill() }
    $nativeProcess = $null
    [Console]::Error.WriteLine('Native accessibility fallback could not be loaded.')
  }
}
if ($env:CLEARWRITE_READER_VALIDATE -eq '1') { 'ok'; exit }
if ($env:CLEARWRITE_READER_IPC_VALIDATE -eq '1') {
  if ($null -eq [ClearWriteEditorReader]::NativeFallback) { throw 'Native IPC callback unavailable.' }
  $result = [ClearWriteEditorReader]::NativeFallback.Invoke(0, 'fixture', [string[]]@())
  if ($null -ne $result) { throw 'Invalid-window request returned content.' }
  $nativeProcess.StandardInput.Close()
  if (-not $nativeProcess.WaitForExit(3000)) { $nativeProcess.Kill(); throw 'Native worker did not exit on parent pipe closure.' }
  if ($nativeProcess.ExitCode -ne 0) { throw 'Native worker failed during IPC validation.' }
  'ok'
  exit
}
$excludedProcesses = @('cmd', 'powershell', 'pwsh', 'windowsterminal', 'wt', 'regedit')
$excludedProcesses += @('mstsc', 'msrdc', 'vmconnect', 'vmware', 'vmware-remotemks', 'virtualboxvm', 'wfica32', 'cdviewer', 'anydesk', 'teamviewer', 'vncviewer', 'tvnviewer')
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
while ($true) {
  if ($nativeProcess -and $nativeProcess.HasExited) { exit 1 }
  if ($lastHeartbeat -eq [DateTime]::MinValue) { Send-Payload @{ reason = 'readerReady' } }
  if (([DateTime]::UtcNow - $lastHeartbeat).TotalSeconds -ge 1) {
    Send-Payload @{ reason = 'heartbeat' }
    $lastHeartbeat = [DateTime]::UtcNow
  }
  if ($panelProbe) {
    try {
      $panelState = [ClearWritePanelNative]::State($panelHandle)
      if ($panelState -ne $lastPanelState) {
        $lastPanelState = $panelState
        if ($panelState -eq 'gone') { Send-Payload @{ reason = 'panelZ'; gone = $true } }
        else {
          Send-Payload @{ reason = 'panelZ'; visible = ($panelState.Substring(0, 1) -eq '1'); topmost = ($panelState.Substring(1, 1) -eq '1'); foregroundTopmost = ($panelState.Substring(2, 1) -eq '1'); covered = ($panelState.Substring(3, 1) -eq '1') }
        }
      }
    } catch { }
  }
  try {
    $payload = [ClearWriteEditorReader]::Read([ClearWriteFocusNative]::ForegroundHandle(), [int]$env:CLEARWRITE_PID, [string[]]$excludedProcesses, [string[]]$allowedProcesses, $restrictToAllowed)
    if ($payload.reason -eq 'self') { $payload.reason = 'appDetected' }
    $payload.coords = $(if ($physicalPixels) { 'physical' } else { 'logical' })
    $payloadKey = "$($payload.active)|$($payload.key)|$($payload.reason)|$($payload.processName)"
    if ($payloadKey -cne $lastPayloadKey -or $payload.text -cne $lastPayloadText) {
      Send-Payload $payload
      $lastPayloadKey = $payloadKey
      $lastPayloadText = $payload.text
    }
  } catch { Send-Payload @{ active = $false; reason = 'providerError' } }
  Start-Sleep -Milliseconds 150
}
