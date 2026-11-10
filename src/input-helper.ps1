# Starts ClearWrite's long-running keyboard/clipboard helper (src/input-helper.cs). The C# is
# compiled once per app session instead of once per action. Runs in an MTA, like the focus reader.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName WindowsBase
$references = @(
  ([System.Windows.Automation.AutomationElement].Assembly.Location)
  ([System.Windows.Automation.AutomationIdentifier].Assembly.Location)
  ([System.Windows.Rect].Assembly.Location)
  'System.dll'
)
Add-Type -Path (Join-Path $PSScriptRoot 'input-helper.cs') -ReferencedAssemblies $references
[ClearWriteInputHost]::Run()
