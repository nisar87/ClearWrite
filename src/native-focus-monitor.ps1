$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
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
Add-Type -Path @((Join-Path $PSScriptRoot 'editor-reader.cs'), (Join-Path $PSScriptRoot 'native-editor-reader.cs')) -ReferencedAssemblies $references
if ($env:CLEARWRITE_READER_VALIDATE -eq '1') {
  if (-not [ClearWriteNativeEditorReader]::ValidateRuntime()) { throw 'Native UI Automation runtime unavailable.' }
  'ok'
  exit
}
# Do not call managed AutomationElement APIs in this process. Loading their type
# definitions is safe; invoking UIA2 would register the incompatible proxy stack.
[Console]::Out.WriteLine('ready')
[Console]::Out.Flush()
while ($null -ne ($line = [Console]::In.ReadLine())) {
  try {
    $request = $line | ConvertFrom-Json
    $result = [ClearWriteNativeEditorReader]::Read([long]$request.window, [string]$request.appName, [string[]]$request.excluded)
    $output = if ($null -eq $result) { 'null' } else { $result | ConvertTo-Json -Compress -Depth 4 }
  } catch { $output = 'null' }
  [Console]::Out.WriteLine($output)
  [Console]::Out.Flush()
}
