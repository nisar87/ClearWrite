# Test-owned WinForms window for Windows input integration tests (scripts/test-input-actions.js).
# Hosts one native EDIT control. Protocol: prints one JSON line {"hwnd":...} when ready, then answers one command per stdin line:
#   select <start> <length>   select text in the edit control and focus the window
#   settext <base64>          replace the edit control's text (UTF-8, base64)
#   selectrich / setrich / richtext   the same for the native RichEdit document control
#   setclip <base64>          put text on the clipboard
#   text                      print {"text":"<base64>"} of the edit control
#   clip                      print {"clip":"<base64>"} of the clipboard text
#   setfiles <base64>         put a file drop list (one path) on the clipboard
#   files / formats           print the clipboard file list / format names (base64, '|'-joined)
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
  // A plain Win32 EDIT control: UI Automation exposes it through the system Edit proxy
  // (ControlType.Edit + ValuePattern), like ordinary edit fields in other apps. A WinForms
  // TextBox is not used because powershell.exe's WinForms reports it as a Pane.
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr CreateWindowEx(int exStyle, string className, string text, int style, int x, int y, int width, int height, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr param);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool SetWindowText(IntPtr hWnd, string text);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int max);
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern IntPtr SetFocus(IntPtr hWnd);
  public static IntPtr Edit;
  public static IntPtr Rich;
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr LoadLibrary(string name);
  // A native RichEdit document control (multi-line rich text, exposes UIA TextPattern).
  public static void CreateRich(IntPtr parent) {
    LoadLibrary("msftedit.dll");
    Rich = CreateWindowEx(0x200, "RICHEDIT50W", "", 0x50A00044, 10, 44, 480, 70, parent, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
  }
  public static void SetRich(string text) { SetWindowText(Rich, text); }
  public static string GetRich() { var builder = new System.Text.StringBuilder(GetWindowTextLength(Rich) + 1); GetWindowText(Rich, builder, builder.Capacity); return builder.ToString(); }
  public static void SelectRich(int start, int length) { SetFocus(Rich); SendMessage(Rich, 0xB1, new IntPtr(start), new IntPtr(start + length)); }
  public static void CreateEdit(IntPtr parent, string text) { Edit = CreateWindowEx(0x200, "EDIT", text, 0x50010080, 10, 10, 480, 24, parent, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero); }
  public static void SetText(string text) { SetWindowText(Edit, text); }
  public static string GetText() { var builder = new System.Text.StringBuilder(GetWindowTextLength(Edit) + 1); GetWindowText(Edit, builder, builder.Capacity); return builder.ToString(); }
  public static void Select(int start, int length) { SetFocus(Edit); SendMessage(Edit, 0xB1, new IntPtr(start), new IntPtr(start + length)); }
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
$form.Width = 520; $form.Height = 180; $form.TopMost = $true
$form.StartPosition = 'CenterScreen'
$utf8 = New-Object System.Text.UTF8Encoding($false)
function Encode([string]$value) { [Convert]::ToBase64String($utf8.GetBytes([string]$value)) }
function Decode([string]$value) { $utf8.GetString([Convert]::FromBase64String($value)) }
$form.Add_Shown({
  [FixtureWin]::CreateEdit($form.Handle, 'Please send teh report today.')
  [FixtureWin]::CreateRich($form.Handle)
  $form.Activate(); [FixtureWin]::Select(0, 0)
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
          $form.Activate()
          [FixtureWin]::Select([int]$parts[1], [int]$parts[2])
        }
        'selectrich' {
          [FixtureWin]::SetForegroundWindow($form.Handle) | Out-Null
          $form.Activate()
          [FixtureWin]::SelectRich([int]$parts[1], [int]$parts[2])
        }
        'setrich' { [FixtureWin]::SetRich((Decode $parts[1])) }
        'richtext' { $reply = (@{ text = (Encode ([FixtureWin]::GetRich())) } | ConvertTo-Json -Compress) }
        'settext' { [FixtureWin]::SetText((Decode $parts[1])) }
        'setclip' { [System.Windows.Forms.Clipboard]::SetText((Decode $parts[1])) }
        'text' { $reply = (@{ text = (Encode ([FixtureWin]::GetText())) } | ConvertTo-Json -Compress) }
        'clip' { $reply = (@{ clip = (Encode ([System.Windows.Forms.Clipboard]::GetText())) } | ConvertTo-Json -Compress) }
        'setfiles' { $list = New-Object System.Collections.Specialized.StringCollection; [void]$list.Add((Decode $parts[1])); [System.Windows.Forms.Clipboard]::SetFileDropList($list) }
        'files' { $reply = (@{ files = (Encode ((@([System.Windows.Forms.Clipboard]::GetFileDropList()) -join '|'))) } | ConvertTo-Json -Compress) }
        'formats' { $reply = (@{ formats = (Encode (([System.Windows.Forms.Clipboard]::GetDataObject().GetFormats()) -join '|')) } | ConvertTo-Json -Compress) }
        'rect' { $b = $form.Bounds; $reply = (@{ x = $b.X; y = $b.Y; width = $b.Width; height = $b.Height } | ConvertTo-Json -Compress) }
        'foreground' { $reply = (@{ foreground = ([FixtureWin]::GetForegroundWindow() -eq $form.Handle) } | ConvertTo-Json -Compress) }
        default { $reply = 'unknown' }
      }
    } catch { $reply = (@{ error = $_.Exception.Message } | ConvertTo-Json -Compress) }
    [Console]::Out.WriteLine($reply); [Console]::Out.Flush()
  })
  $script:timer.Start()
})
[System.Windows.Forms.Application]::Run($form)
