import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const powershell = process.env.SystemRoot
  ? `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
  : 'powershell.exe';

const helper = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName WindowsBase
# UI Automation is queried from compiled C#, like the focus reader. Called directly from a
# PowerShell expression, managed UIA reported a native edit control in another app as a Pane
# without ValuePattern (verified on a Windows runner), so Apply refused ordinary fields.
$uiaReferences = @(
  ([System.Windows.Automation.AutomationElement].Assembly.Location)
  ([System.Windows.Automation.AutomationIdentifier].Assembly.Location)
  ([System.Windows.Rect].Assembly.Location)
)
Add-Type -ReferencedAssemblies $uiaReferences -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Windows.Automation;
public static class ClearWriteInput {
  public static string FocusedRuntimeId() {
    var focused = AutomationElement.FocusedElement;
    return focused == null ? "" : string.Join(".", focused.GetRuntimeId());
  }
  // Empty string when the focused field is the expected, writable field with exactly the
  // expected text; otherwise the reason nothing may be replaced.
  public static string CheckFocusedField(string runtimeId, string expected) {
    var focused = AutomationElement.FocusedElement;
    if (focused == null) return "The original text field is no longer focused. Nothing was replaced.";
    if (string.Join(".", focused.GetRuntimeId()) != runtimeId) return "The focused text field changed. Nothing was replaced.";
    object pattern;
    if (!focused.TryGetCurrentPattern(ValuePattern.Pattern, out pattern) || ((ValuePattern)pattern).Current.IsReadOnly) return "This text field cannot be safely replaced.";
    if (!string.Equals(((ValuePattern)pattern).Current.Value, expected, StringComparison.Ordinal)) return "The text changed since this suggestion was created. Nothing was replaced.";
    return "";
  }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public UIntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public UIntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Explicit)] public struct INPUTUNION { [FieldOffset(0)] public KEYBDINPUT ki; [FieldOffset(0)] public MOUSEINPUT mi; }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public INPUTUNION U; }
  [DllImport("user32.dll", SetLastError = true)] public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetClipboardSequenceNumber();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr SetActiveWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int command);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, IntPtr processId);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int key);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint from, uint to, bool attach);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT point);
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  // Physical pixels on every monitor, so ClearWrite can convert to Electron DIPs correctly.
  public static void UsePhysicalPixels() { try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch (EntryPointNotFoundException) { } }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  public static void Chord(ushort key) {
    var started = Environment.TickCount;
    while (IsDown(0x10) || IsDown(0x11) || IsDown(0x12) || IsDown(0x5B) || IsDown(0x5C)) {
      if (unchecked(Environment.TickCount - started) > 2000) throw new InvalidOperationException("Release Ctrl, Shift, and Alt, then try again.");
      System.Threading.Thread.Sleep(25);
    }
    var inputs = new INPUT[4];
    inputs[0] = Key(0x11, 0); inputs[1] = Key(key, 0); inputs[2] = Key(key, 2); inputs[3] = Key(0x11, 2);
    var inserted = SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
    if (inserted != (uint)inputs.Length) throw new InvalidOperationException("Windows rejected simulated keyboard input (" + inserted + "/" + inputs.Length + " events; error " + Marshal.GetLastWin32Error() + ").");
  }
  static bool IsDown(int key) { return (GetAsyncKeyState(key) & 0x8000) != 0; }
  public static void KeyPress(ushort key) {
    var inputs = new INPUT[2];
    inputs[0] = Key(key, 0); inputs[1] = Key(key, 2);
    var inserted = SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
    if (inserted != (uint)inputs.Length) throw new InvalidOperationException("Windows rejected simulated keyboard input (" + inserted + "/" + inputs.Length + " events; error " + Marshal.GetLastWin32Error() + ").");
  }
  public static bool Activate(IntPtr target) {
    var foreground = GetForegroundWindow();
    var foregroundThread = GetWindowThreadProcessId(foreground, IntPtr.Zero);
    var targetThread = GetWindowThreadProcessId(target, IntPtr.Zero);
    var currentThread = GetCurrentThreadId();
    var attachedForeground = foregroundThread != currentThread && AttachThreadInput(currentThread, foregroundThread, true);
    var attachedTarget = targetThread != currentThread && AttachThreadInput(currentThread, targetThread, true);
    try {
      if (IsIconic(target)) ShowWindow(target, 9);
      BringWindowToTop(target);
      SetActiveWindow(target);
      return SetForegroundWindow(target);
    } finally {
      if (attachedTarget) AttachThreadInput(currentThread, targetThread, false);
      if (attachedForeground) AttachThreadInput(currentThread, foregroundThread, false);
    }
  }
  // Waits until the clipboard sequence number moves past "before" (a copy completed), up to
  // "timeoutMs". Slow apps (Electron, Office under load) can take several hundred ms.
  public static bool WaitForClipboard(uint before, int timeoutMs) {
    var started = Environment.TickCount;
    while (unchecked(Environment.TickCount - started) < timeoutMs) {
      if (GetClipboardSequenceNumber() != before) { System.Threading.Thread.Sleep(30); return true; }
      System.Threading.Thread.Sleep(20);
    }
    return GetClipboardSequenceNumber() != before;
  }
  static INPUT Key(ushort key, uint flags) { var input = new INPUT(); input.type = 1; input.U.ki.wVk = key; input.U.ki.dwFlags = flags; return input; }
}
"@
switch ($env:CLEARWRITE_ACTION) {
  'validate' {
    $size = [Runtime.InteropServices.Marshal]::SizeOf([type][ClearWriteInput+INPUT])
    $expected = if ([IntPtr]::Size -eq 8) { 40 } else { 28 }
    if ($size -ne $expected) { throw "Unexpected native INPUT size: $size (expected $expected)." }
    'ok'
  }
  'capture' {
    [ClearWriteInput]::UsePhysicalPixels()
    $target = [ClearWriteInput]::GetForegroundWindow().ToInt64()
    $before = [ClearWriteInput]::GetClipboardSequenceNumber()
    $point = New-Object ClearWriteInput+POINT
    [void][ClearWriteInput]::GetCursorPos([ref]$point)
    [ClearWriteInput]::Chord(0x43)
    [void][ClearWriteInput]::WaitForClipboard($before, 900)
    $after = [ClearWriteInput]::GetClipboardSequenceNumber()
    [pscustomobject]@{ target = $target; before = $before; after = $after; x = $point.X; y = $point.Y } | ConvertTo-Json -Compress
  }
  'copy-check' {
    # Re-copies the current selection in the original window so ClearWrite can confirm the
    # text it is about to replace is still selected. Nothing is pasted here.
    $target = [IntPtr]::new([long]$env:CLEARWRITE_TARGET)
    if ([ClearWriteInput]::GetForegroundWindow() -ne $target -and -not [ClearWriteInput]::Activate($target)) { throw 'The original app could not be focused. Nothing was replaced.' }
    Start-Sleep -Milliseconds 120
    if ([ClearWriteInput]::GetForegroundWindow() -ne $target) { throw 'The original app is no longer active. Nothing was replaced.' }
    $runtimeId = ''
    try { $runtimeId = [ClearWriteInput]::FocusedRuntimeId() } catch { }
    $before = [ClearWriteInput]::GetClipboardSequenceNumber()
    [ClearWriteInput]::Chord(0x43)
    $changed = [ClearWriteInput]::WaitForClipboard($before, 900)
    [pscustomobject]@{ changed = $changed; runtimeId = $runtimeId } | ConvertTo-Json -Compress
  }
  'paste-verified' {
    # Pastes only if the same window and (when known) the same focused element are still active.
    $target = [IntPtr]::new([long]$env:CLEARWRITE_TARGET)
    if ([ClearWriteInput]::GetForegroundWindow() -ne $target) { throw 'The original app is no longer active. Nothing was replaced.' }
    if ($env:CLEARWRITE_RUNTIME_ID -and [ClearWriteInput]::FocusedRuntimeId() -cne $env:CLEARWRITE_RUNTIME_ID) { throw 'The focused text field changed. Nothing was replaced.' }
    [ClearWriteInput]::Chord(0x56)
    'ok'
  }
  'replace-field' {
    $target = [IntPtr]::new([long]$env:CLEARWRITE_TARGET)
    if ([ClearWriteInput]::GetForegroundWindow() -ne $target -and -not [ClearWriteInput]::Activate($target)) { throw 'The original app could not be focused.' }
    Start-Sleep -Milliseconds 180
    if ([ClearWriteInput]::GetForegroundWindow() -ne $target) { throw 'The original app is no longer active. Nothing was replaced.' }
    $problem = [ClearWriteInput]::CheckFocusedField($env:CLEARWRITE_RUNTIME_ID, $env:CLEARWRITE_EXPECTED_TEXT)
    if ($problem) { throw $problem }
    [ClearWriteInput]::Chord(0x41)
    Start-Sleep -Milliseconds 80
    [ClearWriteInput]::Chord(0x56)
    'ok'
  }
  default { throw 'Unknown input action.' }
}
`;

async function run(action, target, expectedText, runtimeId) {
  const { stdout } = await execFileAsync(powershell, [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-Mta', '-ExecutionPolicy', 'Bypass', '-Command', helper,
  ], {
    windowsHide: true,
    timeout: 8000,
    maxBuffer: 16_000,
    env: { ...process.env, CLEARWRITE_ACTION: action, CLEARWRITE_TARGET: String(target ?? ''), CLEARWRITE_EXPECTED_TEXT: expectedText ?? '', CLEARWRITE_RUNTIME_ID: runtimeId ?? '' },
  });
  return stdout.trim();
}

export async function captureSelection() {
  const raw = await run('capture');
  const result = JSON.parse(raw);
  if (!Number.isSafeInteger(result.target) || !Number.isSafeInteger(result.before) || !Number.isSafeInteger(result.after)) {
    throw new Error('Windows returned an invalid selection status.');
  }
  return result;
}

export async function validateWindowsInput() {
  return (await run('validate')) === 'ok';
}

// Re-copies the selection in `target`. Returns { changed, runtimeId }: changed is false
// when the app copied nothing (usually because nothing is selected any more).
export async function copySelectionInWindow(target) {
  if (!Number.isSafeInteger(target) || target <= 0) throw new Error('The original text window is no longer available.');
  const result = JSON.parse(await run('copy-check', target));
  return { changed: result.changed === true, runtimeId: typeof result.runtimeId === 'string' ? result.runtimeId : '' };
}

export async function pasteVerifiedToWindow(target, runtimeId = '') {
  if (!Number.isSafeInteger(target) || target <= 0) throw new Error('The original text window is no longer available.');
  await run('paste-verified', target, '', runtimeId);
}

export async function replaceFieldInWindow(target, expectedText, runtimeId) {
  if (!Number.isSafeInteger(target) || target <= 0) throw new Error('The original text field is no longer available.');
  if (typeof expectedText !== 'string' || typeof runtimeId !== 'string' || !runtimeId) throw new Error('The original text field could not be verified.');
  await run('replace-field', target, expectedText, runtimeId);
}

