# Test-owned WinForms window for Windows input integration tests (scripts/test-input-actions.js).
# Protocol: prints one JSON line {"hwnd":...} when ready, then answers one command per stdin line:
#   select <start> <length>   select text in the TextBox and focus the window
#   settext <base64>          replace the TextBox text (UTF-8, base64)
#   setclip <base64>          put text on the clipboard
#   text                      print {"text":"<base64>"} of the TextBox
#   clip                      print {"clip":"<base64>"} of the clipboard text
#   exit
# No other application is touched.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class FixtureWin {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  // stdin is read on a background thread so the form keeps pumping messages (keyboard
  // input sent by the test must be processed while the test waits).
  public static readonly System.Collections.Concurrent.ConcurrentQueue<string> Lines = new System.Collections.Concurrent.ConcurrentQueue<string>();
  public static void StartReading() {
    var thread = new System.Threading.Thread(() => {
      string line;
      while ((line = Console.In.ReadLine()) != null) Lines.Enqueue(line);
      Lines.Enqueue("exit");
    });
    thread.IsBackground = true;
    thread.Start();
  }
}
"@
$form = New-Object System.Windows.Forms.Form
$form.Text = 'ClearWrite input test'
$form.Width = 520; $form.Height = 160; $form.TopMost = $true
$form.StartPosition = 'CenterScreen'
$box = New-Object System.Windows.Forms.TextBox
$box.Left = 10; $box.Top = 10; $box.Width = 480; $box.HideSelection = $false
$box.Text = 'Please send teh report today.'
$form.Controls.Add($box)
$utf8 = New-Object System.Text.UTF8Encoding($false)
function Encode([string]$value) { [Convert]::ToBase64String($utf8.GetBytes([string]$value)) }
function Decode([string]$value) { $utf8.GetString([Convert]::FromBase64String($value)) }
$form.Add_Shown({
  $form.Activate(); $box.Focus() | Out-Null
  [Console]::Out.WriteLine((@{ hwnd = $form.Handle.ToInt64() } | ConvertTo-Json -Compress))
  [Console]::Out.Flush()
  $script:timer = New-Object System.Windows.Forms.Timer
  $script:timer.Interval = 50
  [FixtureWin]::StartReading()
  $script:timer.Add_Tick({
    $line = $null
    if (-not [FixtureWin]::Lines.TryDequeue([ref]$line)) { return }
    if ($line -eq 'exit') { $script:timer.Stop(); $form.Close(); return }
    $parts = $line.Split(' ')
    $reply = 'ok'
    try {
      switch ($parts[0]) {
        'select' {
          [FixtureWin]::SetForegroundWindow($form.Handle) | Out-Null
          $form.Activate(); $box.Focus() | Out-Null
          $box.Select([int]$parts[1], [int]$parts[2])
        }
        'settext' { $box.Text = Decode $parts[1] }
        'setclip' { [System.Windows.Forms.Clipboard]::SetText((Decode $parts[1])) }
        'text' { $reply = (@{ text = (Encode $box.Text) } | ConvertTo-Json -Compress) }
        'clip' { $reply = (@{ clip = (Encode ([System.Windows.Forms.Clipboard]::GetText())) } | ConvertTo-Json -Compress) }
        'foreground' { $reply = (@{ foreground = ([FixtureWin]::GetForegroundWindow() -eq $form.Handle) } | ConvertTo-Json -Compress) }
        default { $reply = 'unknown' }
      }
    } catch { $reply = (@{ error = $_.Exception.Message } | ConvertTo-Json -Compress) }
    [Console]::Out.WriteLine($reply); [Console]::Out.Flush()
  })
  $script:timer.Start()
})
[System.Windows.Forms.Application]::Run($form)
