import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

test('Windows editor reader compiles against the installed accessibility assemblies', { skip: process.platform !== 'win32' }, async () => {
  const { stdout } = await promisify(execFile)(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Mta', '-File', fileURLToPath(new URL('./focus-monitor.ps1', import.meta.url))],
    { windowsHide: true, timeout: 15000, env: { ...process.env, CLEARWRITE_READER_VALIDATE: '1' } });
  assert.equal(stdout.trim(), 'ok');
});

test('reader uses bounded traversal and scalar Scintilla access, never clipboard or remote memory', async () => {
  const source = await readFile(new URL('./editor-reader.cs', import.meta.url), 'utf8');
  assert.match(source, /depth < 6/);
  assert.match(source, /GetText\(Limit \+ 1\)/);
  assert.match(source, /codepage == 65001/);
  assert.doesNotMatch(source, /ReadProcessMemory|WriteProcessMemory|VirtualAllocEx|SendInput|Clipboard\./);
  assert.match(source, /GetAttributeValue\(TextPattern.IsReadOnlyAttribute\)/);
});

test('Windows editor policy validates real native child ownership and rejects unsafe rich-text ranges', { skip: process.platform !== 'win32' }, async () => {
  const { stdout } = await promisify(execFile)(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Mta', '-File', fileURLToPath(new URL('../scripts/test-editor-policy.ps1', import.meta.url))],
    { windowsHide: true, timeout: 15000 });
  assert.equal(stdout.trim(), 'ok');
});

test('hosted editor ownership is separate from local field revalidation', async () => {
  const source = await readFile(new URL('./editor-reader.cs', import.meta.url), 'utf8');
  assert.match(source, /if \(!BelongsToForeground\(focus, root, foreground\)\)/);
  assert.match(source, /if \(!Related\(AutomationElement.FocusedElement, element\)\)/);
  assert.match(source, /depth < 64/);
});

test('bundled native interop assembly matches its pinned checksum', async () => {
  const root = new URL('../assets/windows/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
  assert.equal(createHash('sha256').update(await readFile(new URL('Interop.UIAutomationClient.dll', root))).digest('hex'), manifest.sha256);
});

test('native UI Automation client and focused-editor condition work on Windows', { skip: process.platform !== 'win32' }, async () => {
  const { stdout } = await promisify(execFile)(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Mta', '-File', fileURLToPath(new URL('../scripts/test-native-runtime.ps1', import.meta.url))],
    { windowsHide: true, timeout: 15000 });
  assert.equal(stdout.trim(), 'ok');
});

test('native fallback is scoped, focus/password checked and copy-only', async () => {
  const source = await readFile(new URL('./native-editor-reader.cs', import.meta.url), 'utf8');
  assert.match(source, /root.FindFirst\(Native.TreeScope.TreeScope_Descendants/);
  assert.match(source, /candidate.CurrentHasKeyboardFocus/);
  assert.match(source, /candidate.CurrentIsPassword/);
  assert.match(source, /value.CurrentIsReadOnly/);
  assert.match(source, /Array.IndexOf\(excluded, process\)/);
  assert.doesNotMatch(source, /SendInput|Clipboard|\.SetValue\(/);
});

test('native worker IPC is isolated, refuses invalid targets and exits when its parent closes the pipe', { skip: process.platform !== 'win32' }, async () => {
  const { stdout } = await promisify(execFile)(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Mta', '-File', fileURLToPath(new URL('./focus-monitor.ps1', import.meta.url))],
    { windowsHide: true, timeout: 15000, env: { ...process.env, CLEARWRITE_READER_VALIDATE: '', CLEARWRITE_READER_IPC_VALIDATE: '1' } });
  assert.equal(stdout.trim(), 'ok');
});
