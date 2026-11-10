# Runs the production editor reader (src/editor-reader.cs) once against a window handle and
# prints the snapshot metadata as JSON (no field text). Used by scripts/test-input-actions.js.
param([long]$Window)
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
$focused = [System.Windows.Automation.AutomationElement]::FocusedElement
[pscustomobject]@{
  active = $result['active']; reason = $result['reason']; reader = $result['reader']; replaceSupported = $result['replaceSupported']
  hasText = $result.ContainsKey('text'); focusedType = $focused.Current.ControlType.ProgrammaticName
} | ConvertTo-Json -Compress
