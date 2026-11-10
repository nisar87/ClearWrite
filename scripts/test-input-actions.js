// Windows integration test for the keyboard/clipboard actions in src/windows-input.js.
// Uses only a test-owned WinForms window (scripts/input-fixture.ps1). Requires an unlocked
// interactive desktop. Run with: npm run test:input
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { captureSelection, copySelectionInWindow, pasteVerifiedToWindow, replaceFieldInWindow } from '../src/windows-input.js';

const fixturePath = fileURLToPath(new URL('./input-fixture.ps1', import.meta.url));
const ORIGINAL = 'Please send teh report today.';
let fixture;
let hwnd;
const replies = [];
const waiting = [];
const b64 = (value) => Buffer.from(value, 'utf8').toString('base64');
const unb64 = (value) => Buffer.from(value, 'base64').toString('utf8');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function nextLine() {
  if (replies.length) return Promise.resolve(replies.shift());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Fixture did not answer.')), 10_000);
    waiting.push((line) => { clearTimeout(timer); resolve(line); });
  });
}

async function command(line) {
  fixture.stdin.write(`${line}\n`);
  const reply = await nextLine();
  if (reply.startsWith('{"error"')) throw new Error(JSON.parse(reply).error);
  return reply.startsWith('{') ? JSON.parse(reply) : reply;
}

const fieldText = async () => unb64((await command('text')).text);
const clipText = async () => unb64((await command('clip')).clip);

before(async () => {
  fixture = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-Sta', '-ExecutionPolicy', 'Bypass', '-File', fixturePath], { stdio: ['pipe', 'pipe', 'inherit'] });
  createInterface({ input: fixture.stdout }).on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const resolve = waiting.shift();
    if (resolve) resolve(trimmed); else replies.push(trimmed);
  });
  hwnd = JSON.parse(await nextLine()).hwnd;
  assert.ok(Number.isSafeInteger(hwnd) && hwnd > 0);
});

after(async () => {
  try { fixture.stdin.write('exit\n'); } catch { /* already closed */ }
  await sleep(300);
  fixture.kill();
});

async function reset(selectStart, selectLength) {
  await command(`settext ${b64(ORIGINAL)}`);
  await command(`select ${selectStart} ${selectLength}`);
  await sleep(150);
  const { foreground } = await command('foreground');
  assert.equal(foreground, true, 'The fixture window could not take focus (is the desktop locked or non-interactive?).');
}

test('capture copies the current selection (waits for the copy instead of a fixed delay)', async () => {
  await reset(0, 6);
  await command(`setclip ${b64('user clipboard')}`);
  const result = await captureSelection();
  assert.equal(result.target, hwnd);
  assert.notEqual(result.after, result.before, 'the copy was detected');
  assert.equal(await clipText(), 'Please');
});

test('verified replace pastes over the selection only when it is still selected', async () => {
  await reset(12, 3);
  const check = await copySelectionInWindow(hwnd);
  assert.equal(check.changed, true);
  assert.equal(await clipText(), 'teh');
  await command(`setclip ${b64('the')}`);
  await pasteVerifiedToWindow(hwnd, check.runtimeId);
  await sleep(300);
  assert.equal(await fieldText(), 'Please send the report today.');
});

test('a lost selection is detected so nothing is pasted at the caret', async () => {
  await reset(5, 0);
  await command(`setclip ${b64('marker')}`);
  const check = await copySelectionInWindow(hwnd);
  assert.equal(check.changed, false, 'copying an empty selection changes nothing');
  assert.equal(await clipText(), 'marker');
  assert.equal(await fieldText(), ORIGINAL);
});

test('verified paste refuses when the focused element changed', async () => {
  await reset(12, 3);
  await command(`setclip ${b64('XYZ')}`);
  await assert.rejects(pasteVerifiedToWindow(hwnd, '42.0.0.1'), /focused text field changed/);
  await sleep(200);
  assert.equal(await fieldText(), ORIGINAL);
});

test('the production reader accepts a native edit in another app as replaceable', async () => {
  await reset(0, 0);
  const { execFileSync } = await import('node:child_process');
  const script = fileURLToPath(new URL('./read-focused-editor.ps1', import.meta.url));
  const result = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Mta', '-ExecutionPolicy', 'Bypass', '-File', script, '-Window', String(hwnd)], { encoding: 'utf8' }));
  assert.equal(result.active, true);
  assert.equal(result.reader, 'value');
  assert.equal(result.replaceSupported, true);
});

test('diagnostic variants', async () => {
  await reset(0, 0);
  const { execFileSync } = await import('node:child_process');
  const { writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const body = (extra) => `$ErrorActionPreference='Stop'; Add-Type -AssemblyName UIAutomationClient; Add-Type -AssemblyName UIAutomationTypes; ${extra} $f=[System.Windows.Automation.AutomationElement]::FocusedElement; $f.Current.ControlType.ProgrammaticName + ' ' + $f.Current.ClassName`;
  const file = `${tmpdir()}\\cw-diag.ps1`;
  const variants = {
    commandPlain: ['-NoProfile', '-Mta', '-Command', body('')],
    commandNonInteractive: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Mta', '-ExecutionPolicy', 'Bypass', '-Command', body('')],
    commandSta: ['-NoProfile', '-Command', body('')],
    commandWindowsBase: ['-NoProfile', '-Mta', '-Command', body('Add-Type -AssemblyName WindowsBase; Add-Type -AssemblyName Accessibility;')],
    commandFromHandle: ['-NoProfile', '-Mta', '-Command', body(`$null=[System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]${hwnd});`)],
    commandRootFirst: ['-NoProfile', '-Mta', '-Command', body('$null=[System.Windows.Automation.AutomationElement]::RootElement.Current.Name;')],
  };
  for (const [name, args] of Object.entries(variants)) {
    try { console.log('DIAG', name, execFileSync('powershell.exe', args, { encoding: 'utf8' }).trim()); }
    catch (error) { console.log('DIAG', name, 'error', String(error.stderr || error.message).slice(0, 200)); }
  }
  writeFileSync(file, body(''));
  console.log('DIAG fileMta', execFileSync('powershell.exe', ['-NoProfile', '-Mta', '-ExecutionPolicy', 'Bypass', '-File', file], { encoding: 'utf8' }).trim());
  console.log('DIAG fileSta', execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file], { encoding: 'utf8' }).trim());
});

test('field replacement checks the exact text before replacing everything', async () => {
  await reset(0, 0);
  const check = await copySelectionInWindow(hwnd).catch(() => ({ runtimeId: '' }));
  assert.ok(check.runtimeId, 'the focused edit control has a UI Automation runtime id');
  await command(`setclip ${b64('Please send the report today.')}`);
  await assert.rejects(replaceFieldInWindow(hwnd, 'Different text', check.runtimeId), /text changed/);
  assert.equal(await fieldText(), ORIGINAL);
  await replaceFieldInWindow(hwnd, ORIGINAL, check.runtimeId);
  await sleep(300);
  assert.equal(await fieldText(), 'Please send the report today.');
});
