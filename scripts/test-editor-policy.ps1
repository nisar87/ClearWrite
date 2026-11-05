$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
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
$edit = [System.Windows.Automation.ControlType]::Edit
$document = [System.Windows.Automation.ControlType]::Document
$label = [System.Windows.Automation.ControlType]::Text
$cases = @(
  ,@($edit, $true, $false, $true)
  ,@($document, $true, $false, $true)
  ,@($document, $true, $true, $false)
  ,@($document, $false, $false, $false)
  ,@($label, $true, $false, $false)
  ,@($edit, $true, [System.Windows.Automation.AutomationElement]::NotSupported, $false)
  ,@($edit, $true, [System.Windows.Automation.TextPattern]::MixedAttributeValue, $false)
  ,@($edit, $true, $null, $false)
)
foreach ($case in $cases) {
  $actual = [ClearWriteEditorReader]::CanReadTextRange($case[0], $case[1], $case[2])
  if ($actual -ne $case[3]) { throw 'Editor safety policy failed.' }
}
foreach ($role in @(
  [System.Windows.Automation.ControlType]::Slider,
  [System.Windows.Automation.ControlType]::ProgressBar,
  [System.Windows.Automation.ControlType]::ScrollBar,
  [System.Windows.Automation.ControlType]::Spinner,
  [System.Windows.Automation.ControlType]::Button,
  [System.Windows.Automation.ControlType]::CheckBox,
  [System.Windows.Automation.ControlType]::Hyperlink
)) {
  if ([ClearWriteEditorReader]::CanReadValueRole($role)) { throw 'Non-text widget accepted as a value editor.' }
  if (-not [ClearWriteEditorReader]::IsNonTextInteraction($role)) { throw 'Non-text widget could fall through to its parent document.' }
}
foreach ($role in @($edit, $document, [System.Windows.Automation.ControlType]::ComboBox)) {
  if (-not [ClearWriteEditorReader]::CanReadValueRole($role)) { throw 'A genuine editor role was rejected.' }
  if ([ClearWriteEditorReader]::IsNonTextInteraction($role)) { throw 'A genuine editor was marked non-text.' }
}
# Hidden, test-owned HWNDs: no focus changes or other applications are involved.
Add-Type -AssemblyName System.Windows.Forms
$first = New-Object System.Windows.Forms.Form
$second = New-Object System.Windows.Forms.Form
$child = New-Object System.Windows.Forms.TextBox
$first.Controls.Add($child)
try {
  $parentHandle = $first.Handle.ToInt64()
  $childHandle = $child.Handle.ToInt64()
  $otherHandle = $second.Handle.ToInt64()
  if (-not [ClearWriteEditorReader]::NativeBelongsToWindow($parentHandle, $childHandle)) { throw 'A native editor child was rejected.' }
  if (-not [ClearWriteEditorReader]::NativeBelongsToWindow($parentHandle, $parentHandle)) { throw 'The foreground root was rejected.' }
  if ([ClearWriteEditorReader]::NativeBelongsToWindow($parentHandle, $otherHandle)) { throw 'A different window in the same process was accepted.' }
  if ([ClearWriteEditorReader]::NativeBelongsToWindow($parentHandle, 0)) { throw 'An unknown native handle was accepted.' }
} finally { $first.Dispose(); $second.Dispose() }
'ok'
