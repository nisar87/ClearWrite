param([string]$WaitForProcess = '', [int]$WaitSeconds = 30, [switch]$IncludeChildren)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class FocusMetadata {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsChild(IntPtr parent, IntPtr child);
  public delegate bool EnumProc(IntPtr window, IntPtr data);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumProc callback, IntPtr data);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr window, System.Text.StringBuilder name, int size);
  public static IntPtr[] Children(IntPtr root) {
    var result = new System.Collections.Generic.List<IntPtr>();
    EnumChildWindows(root, (window, data) => { result.Add(window); return result.Count < 64; }, IntPtr.Zero);
    return result.ToArray();
  }
}
'@
# Deliberately omit Name, Value, document text, selection text and window titles.
$deadline = [DateTime]::UtcNow.AddSeconds($WaitSeconds)
do {
  $foreground = [FocusMetadata]::GetForegroundWindow()
  $hostPid = [uint32]0
  $null = [FocusMetadata]::GetWindowThreadProcessId($foreground, [ref]$hostPid)
  $process = [Diagnostics.Process]::GetProcessById($hostPid).ProcessName.ToLowerInvariant()
  if (-not $WaitForProcess -or $process -eq $WaitForProcess) { break }
  Start-Sleep -Milliseconds 150
} while ([DateTime]::UtcNow -lt $deadline)
if ($WaitForProcess -and $process -ne $WaitForProcess) { 'Target focus was not observed'; exit }
if ($process -in @('mstsc','msrdc','vmconnect','anydesk','teamviewer')) { 'Remote viewer skipped'; exit }
$root = [System.Windows.Automation.AutomationElement]::FromHandle($foreground)
$element = [System.Windows.Automation.AutomationElement]::FocusedElement
$nodes = @()
$focused = $element
for ($depth = 0; $null -ne $element -and $depth -lt 64; $depth++) {
  $current = $element.Current
  $handle = [IntPtr]::new($current.NativeWindowHandle)
  $valueReadOnly = $null
  $pattern = $null
  if ($element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) { $valueReadOnly = $pattern.Current.IsReadOnly }
  $nodes += [pscustomobject]@{
    depth = $depth; processId = $current.ProcessId; type = $current.ControlType.ProgrammaticName
    class = $current.ClassName; framework = $current.FrameworkId; keyboardFocus = $current.HasKeyboardFocus
    nativeHandle = $handle.ToInt64(); foregroundMember = ($handle -eq $foreground -or [FocusMetadata]::IsChild($foreground, $handle))
    equalsRoot = [System.Windows.Automation.Automation]::Compare($element, $root)
    valueReadOnly = $valueReadOnly
    patterns = @($element.GetSupportedPatterns() | ForEach-Object { $_.ProgrammaticName })
  }
  if ($current.IsPassword -or $nodes[-1].equalsRoot) { break }
  $element = [System.Windows.Automation.TreeWalker]::RawViewWalker.GetParent($element)
}
$children = @()
if ($IncludeChildren) {
  $queue = New-Object System.Collections.Queue
  $queue.Enqueue(@{ element = $focused; depth = 0 })
  while ($queue.Count -gt 0 -and $children.Count -lt 250) {
    $entry = $queue.Dequeue()
    $node = $entry.element
    $current = $node.Current
    $pattern = $null
    $valueReadOnly = $null
    if ($node.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) { $valueReadOnly = $pattern.Current.IsReadOnly }
    $children += [pscustomobject]@{ depth = $entry.depth; type = $current.ControlType.ProgrammaticName; class = $current.ClassName; framework = $current.FrameworkId; keyboardFocus = $current.HasKeyboardFocus; focusable = $current.IsKeyboardFocusable; password = $current.IsPassword; nativeHandle = $current.NativeWindowHandle; valueReadOnly = $valueReadOnly; patterns = @($node.GetSupportedPatterns() | ForEach-Object { $_.ProgrammaticName }) }
    if ($current.IsPassword -or $entry.depth -ge 14) { continue }
    $child = [System.Windows.Automation.TreeWalker]::RawViewWalker.GetFirstChild($node)
    $siblings = 0
    while ($null -ne $child -and $siblings -lt 60 -and $queue.Count -lt 250) {
      $queue.Enqueue(@{ element = $child; depth = $entry.depth + 1 })
      $child = [System.Windows.Automation.TreeWalker]::RawViewWalker.GetNextSibling($child)
      $siblings++
    }
  }
}
$native = @()
if ($IncludeChildren) {
  foreach ($window in [FocusMetadata]::Children($foreground)) {
    $class = New-Object Text.StringBuilder 128
    $null = [FocusMetadata]::GetClassName($window, $class, 128)
    $node = [System.Windows.Automation.AutomationElement]::FromHandle($window)
    $native += [pscustomobject]@{ handle = $window.ToInt64(); class = $class.ToString(); type = $node.Current.ControlType.ProgrammaticName; keyboardFocus = $node.Current.HasKeyboardFocus; patterns = @($node.GetSupportedPatterns() | ForEach-Object { $_.ProgrammaticName }) }
  }
}
@{ process = $process; foreground = $foreground.ToInt64(); nodes = $nodes; children = $children; native = $native } | ConvertTo-Json -Depth 5 -Compress
