# Runs the production editor reader (src/editor-reader.cs) once against a window handle and
# prints the snapshot metadata as JSON (field text only with -IncludeText, for tests). Used by scripts/test-input-actions.js.
param([long]$Window, [switch]$IncludeText)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName WindowsBase
Add-Type -AssemblyName Accessibility
$references = @(
  ([System.Windows.Automation.AutomationElement].Assembly.Location)
  ([System.Windows.Automation.AutomationIdentifier].Assembly.Location)
  ([System.Windows.Rect].Assembly.Location)
  ([Accessibility.IAccessible].Assembly.Location)
)
Add-Type -Path (Join-Path (Split-Path $PSScriptRoot -Parent) 'src/editor-reader.cs') -ReferencedAssemblies $references
$result = [ClearWriteEditorReader]::Read($Window, 0, [string[]]@(), [string[]]@(), $false)
[pscustomobject]@{
  active = $result['active']; reason = $result['reason']; reader = $result['reader']; replaceSupported = $result['replaceSupported']
  hasText = $result.ContainsKey('text'); runtimeId = $result['runtimeId']
  parentRuntimeId = $(try { $f = [System.Windows.Automation.AutomationElement]::FocusedElement; $p = [System.Windows.Automation.TreeWalker]::RawViewWalker.GetParent($f); [string]::Join('.', $p.GetRuntimeId()) } catch { '' })
  text = $(if ($IncludeText -and $result.ContainsKey('text')) { [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$result['text'])) } else { '' })
} | ConvertTo-Json -Compress
