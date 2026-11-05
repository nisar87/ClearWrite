$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName WindowsBase
Add-Type -AssemblyName Accessibility
Add-Type -AssemblyName System.Windows.Forms
$references = @(
  ([System.Windows.Automation.AutomationElement].Assembly.Location)
  ([System.Windows.Automation.AutomationIdentifier].Assembly.Location)
  ([System.Windows.Rect].Assembly.Location)
  ([Accessibility.IAccessible].Assembly.Location)
  ([System.Windows.Forms.Form].Assembly.Location)
  'System.dll'
)
$root = Split-Path $PSScriptRoot -Parent
# Compile separate files together so the fixture sees the exact production reader type.
Add-Type -Path @((Join-Path $root 'src/editor-reader.cs'), (Join-Path $root 'src/editor-reader-fixture.cs')) -ReferencedAssemblies $references
$passed = [ClearWriteEditorFixture]::Run()
Write-Output "PASS: $passed editor fixture assertions"
