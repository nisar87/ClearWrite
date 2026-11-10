// Windows integration test for the input helper (src/windows-input.js, input-helper.cs).
// Uses only a test-owned window (scripts/input-fixture.ps1) with a native edit control.
// Requires an unlocked interactive desktop. Run with: npm run test:input
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { captureSelection, replaceFieldInWindow, replaceSelectionInWindow, stopWindowsInput, warmWindowsInput } from '../src/windows-input.js';

const fixturePath = fileURLToPath(new URL('./input-fixture.ps1', import.meta.url));
const ORIGINAL = 'Please send teh report today.';
const FIXED = 'Please send the report today.';
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
const clipFiles = async () => unb64((await command('files')).files);
const clipFormats = async () => unb64((await command('formats')).formats).split('|');

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
  await warmWindowsInput();
});

after(async () => {
  stopWindowsInput();
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

function fieldRuntimeId() {
  const script = fileURLToPath(new URL('./read-focused-editor.ps1', import.meta.url));
  return JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Mta', '-ExecutionPolicy', 'Bypass', '-File', script, '-Window', String(hwnd)], { encoding: 'utf8' }));
}

test('capture returns the selection and restores the previous clipboard', async () => {
  await reset(0, 6);
  await command(`setclip ${b64('user clipboard')}`);
  const result = await captureSelection();
  assert.equal(result.target, hwnd);
  assert.equal(result.copied, true);
  assert.equal(result.text, 'Please');
  assert.equal(await clipText(), 'user clipboard');
});

test('capture with nothing selected reports it and leaves the clipboard alone', async () => {
  await reset(4, 0);
  await command(`setclip ${b64('user clipboard')}`);
  const result = await captureSelection();
  assert.equal(result.copied, false);
  assert.equal(await clipText(), 'user clipboard');
});

test('non-text clipboard content (copied files) survives capture and replace', async () => {
  const file = `${process.env.SystemRoot || 'C:\\Windows'}\\win.ini`;
  await reset(0, 6);
  await command(`setfiles ${b64(file)}`);
  await captureSelection();
  assert.equal((await clipFiles()).toLowerCase(), file.toLowerCase(), 'files are still on the clipboard after capture');
  await reset(12, 3);
  await command(`setfiles ${b64(file)}`);
  await replaceSelectionInWindow({ target: hwnd, expected: 'teh', replacement: 'the' });
  await sleep(1800);
  assert.equal(await fieldText(), FIXED);
  assert.equal((await clipFiles()).toLowerCase(), file.toLowerCase(), 'files are restored after the paste');
});

test('selection replace pastes only while the original text is still selected', async () => {
  await reset(12, 3);
  await command(`setclip ${b64('user clipboard')}`);
  await replaceSelectionInWindow({ target: hwnd, expected: 'teh', replacement: 'the' });
  const formats = await clipFormats();
  assert.ok(formats.includes('ExcludeClipboardContentFromMonitorProcessing'), 'temporary content is hidden from clipboard history');
  await sleep(300);
  assert.equal(await fieldText(), FIXED);
  await sleep(1500);
  assert.equal(await clipText(), 'user clipboard', 'the clipboard is restored after the paste');
});

test('a lost selection is refused, so nothing is pasted at the caret', async () => {
  await reset(5, 0);
  await command(`setclip ${b64('marker')}`);
  await assert.rejects(replaceSelectionInWindow({ target: hwnd, expected: 'teh', replacement: 'the' }), /no longer selected/);
  assert.equal(await fieldText(), ORIGINAL);
  assert.equal(await clipText(), 'marker');
});

test('a different selection is refused', async () => {
  await reset(0, 6);
  await command(`setclip ${b64('marker')}`);
  await assert.rejects(replaceSelectionInWindow({ target: hwnd, expected: 'teh', replacement: 'the' }), /no longer selected/);
  assert.equal(await fieldText(), ORIGINAL);
  assert.equal(await clipText(), 'marker');
});

test('the production reader accepts a native edit in another app as replaceable', async () => {
  await reset(0, 0);
  const result = fieldRuntimeId();
  assert.equal(result.active, true);
  assert.equal(result.reader, 'value');
  assert.equal(result.replaceSupported, true);
  assert.ok(result.runtimeId);
});

test('whole-field apply verifies the field, selects all of it, and never duplicates text', async () => {
  await reset(3, 0);
  const { runtimeId } = fieldRuntimeId();
  await command(`setclip ${b64('marker')}`);
  await assert.rejects(replaceFieldInWindow({ target: hwnd, runtimeId, expected: 'Different text', replacement: FIXED }), /text changed/);
  await assert.rejects(replaceFieldInWindow({ target: hwnd, runtimeId: '42.1', expected: ORIGINAL, replacement: FIXED }), /field changed/);
  assert.equal(await fieldText(), ORIGINAL);
  assert.equal(await clipText(), 'marker');
  await replaceFieldInWindow({ target: hwnd, runtimeId, expected: ORIGINAL, replacement: FIXED });
  await sleep(300);
  assert.equal(await fieldText(), FIXED, 'the text is replaced, not duplicated');
  await sleep(1500);
  assert.equal(await clipText(), 'marker');
});

test('warm helper requests are fast (no new PowerShell process per action)', async () => {
  await reset(0, 6);
  const started = performance.now();
  await captureSelection();
  const elapsed = performance.now() - started;
  console.log(`warm capture: ${Math.round(elapsed)} ms`);
  assert.ok(elapsed < 1500);
});
