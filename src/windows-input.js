import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const powershell = process.env.SystemRoot
  ? `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
  : 'powershell.exe';

const helper = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class ClearWriteInput {
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
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint from, uint to, bool attach);
  [DllImport("user32.dll", SetLastError = true)] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT point);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  public static void Chord(ushort key) {
    var inputs = new INPUT[4];
    inputs[0] = Key(0x11, 0); inputs[1] = Key(key, 0); inputs[2] = Key(key, 2); inputs[3] = Key(0x11, 2);
    var inserted = SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
    if (inserted != (uint)inputs.Length) throw new InvalidOperationException("Windows rejected simulated keyboard input (" + inserted + "/" + inputs.Length + " events; error " + Marshal.GetLastWin32Error() + ").");
  }
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
    $target = [ClearWriteInput]::GetForegroundWindow().ToInt64()
    $before = [ClearWriteInput]::GetClipboardSequenceNumber()
    $point = New-Object ClearWriteInput+POINT
    [void][ClearWriteInput]::GetCursorPos([ref]$point)
    [ClearWriteInput]::Chord(0x43)
    Start-Sleep -Milliseconds 180
    $after = [ClearWriteInput]::GetClipboardSequenceNumber()
    [pscustomobject]@{ target = $target; before = $before; after = $after; x = $point.X; y = $point.Y } | ConvertTo-Json -Compress
  }
  'paste' {
    $target = [IntPtr]::new([long]$env:CLEARWRITE_TARGET)
    if ([ClearWriteInput]::GetForegroundWindow() -ne $target -and -not [ClearWriteInput]::Activate($target)) { throw 'The original app could not be focused.' }
    Start-Sleep -Milliseconds 180
    [ClearWriteInput]::Chord(0x56)
    'ok'
  }
  'replace-field' {
    $target = [IntPtr]::new([long]$env:CLEARWRITE_TARGET)
    if ([ClearWriteInput]::GetForegroundWindow() -ne $target -and -not [ClearWriteInput]::Activate($target)) { throw 'The original app could not be focused.' }
    Start-Sleep -Milliseconds 180
    [ClearWriteInput]::Chord(0x41)
    Start-Sleep -Milliseconds 80
    [ClearWriteInput]::Chord(0x56)
    'ok'
  }
  'raise-window' {
    $target = [IntPtr]::new([long]$env:CLEARWRITE_TARGET)
    if (-not [ClearWriteInput]::SetWindowPos($target, [IntPtr](-1), 0, 0, 0, 0, 0x53)) { throw 'Windows could not raise the suggestion window.' }
    'ok'
  }
  default { throw 'Unknown input action.' }
}
`;

async function run(action, target) {
  const { stdout } = await execFileAsync(powershell, [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', helper,
  ], {
    windowsHide: true,
    timeout: 8000,
    maxBuffer: 16_000,
    env: { ...process.env, CLEARWRITE_ACTION: action, CLEARWRITE_TARGET: String(target ?? '') },
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

export async function pasteToWindow(target) {
  if (!Number.isSafeInteger(target) || target <= 0) throw new Error('The original text window is no longer available.');
  await run('paste', target);
}

export async function replaceFieldInWindow(target) {
  if (!Number.isSafeInteger(target) || target <= 0) throw new Error('The original text field is no longer available.');
  await run('replace-field', target);
}

export async function raiseWindowWithoutFocus(target) {
  if (!Number.isSafeInteger(target) || target <= 0) throw new Error('The suggestion window is unavailable.');
  await run('raise-window', target);
}
