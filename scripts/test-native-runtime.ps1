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
if (-not [ClearWriteNativeEditorReader]::ValidateRuntime()) { throw 'Native UI Automation client or search condition creation failed.' }
if ($null -eq [ClearWriteEditorReader]::NativeFallback) { throw 'The native backend was not registered with the production reader.' }
'ok'
