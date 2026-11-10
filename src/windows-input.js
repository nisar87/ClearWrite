import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

// Client for the long-running input helper (src/input-helper.ps1 + input-helper.cs). The helper
// is started on first use (or by warmWindowsInput) and reused, so actions do not pay for a new
// PowerShell process and C# compilation each time. All clipboard work happens in the helper,
// which snapshots and restores every clipboard format.
const powershell = process.env.SystemRoot
  ? `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
  : 'powershell.exe';
const helperPath = fileURLToPath(new URL('./input-helper.ps1', import.meta.url));
const STARTUP_TIMEOUT_MS = 20_000;
const REQUEST_TIMEOUT_MS = 12_000;

let helper;
let nextId = 1;

const b64 = (value) => (value ? Buffer.from(String(value), 'utf8').toString('base64') : '-');
const unb64 = (value) => Buffer.from(String(value || ''), 'base64').toString('utf8');

function startHelper() {
  const child = spawn(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Mta', '-ExecutionPolicy', 'Bypass', '-File', helperPath], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const state = { child, pending: new Map(), ready: undefined };
  state.ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { reject(new Error('The Windows input helper did not start.')); child.kill(); }, STARTUP_TIMEOUT_MS);
    state.resolveReady = () => { clearTimeout(timer); resolve(); };
    state.rejectReady = (error) => { clearTimeout(timer); reject(error); };
  });
  state.ready.catch(() => {});
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-2000); });
  createInterface({ input: child.stdout }).on('line', (line) => {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (message.ready) { state.resolveReady(); return; }
    const request = state.pending.get(message.id);
    if (!request) return;
    state.pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.ok) request.resolve(message);
    else request.reject(new Error(unb64(message.error) || 'The Windows input action failed.'));
  });
  const fail = (error) => {
    if (helper === state) helper = undefined;
    state.rejectReady(error);
    for (const request of state.pending.values()) { clearTimeout(request.timer); request.reject(error); }
    state.pending.clear();
  };
  child.on('error', fail);
  child.on('exit', (code) => fail(new Error(code === 0 ? 'The Windows input helper stopped.' : `The Windows input helper stopped unexpectedly.${stderr.includes('Exception') ? ' Check that Windows PowerShell and .NET Framework are available.' : ''}`)));
  child.stdin.on('error', () => {});
  return state;
}

async function request(action, target = 0, fields = []) {
  helper ??= startHelper();
  const state = helper;
  await state.ready;
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      state.pending.delete(id);
      reject(new Error('Windows did not complete the action in time. Nothing else was changed.'));
      // A stuck helper is replaced on the next request.
      state.child.kill();
    }, REQUEST_TIMEOUT_MS);
    state.pending.set(id, { resolve, reject, timer });
    state.child.stdin.write(`${id} ${action} ${Number(target) || 0} ${fields.map(b64).join(' ')}\n`);
  });
}

export function warmWindowsInput() {
  helper ??= startHelper();
  return helper.ready;
}

export function stopWindowsInput() {
  const state = helper;
  helper = undefined;
  if (!state) return;
  try { state.child.stdin.end(); } catch { /* already closed */ }
  setTimeout(() => { if (state.child.exitCode === null) state.child.kill(); }, 3000).unref();
}

export async function validateWindowsInput() {
  return (await request('validate')).ok === true;
}

// Copies the current selection in the foreground app and restores the user's clipboard.
// Returns { target, copied, text, x, y }: copied is false when nothing was selected.
export async function captureSelection() {
  const result = await request('capture');
  if (!Number.isSafeInteger(result.target)) throw new Error('Windows returned an invalid selection status.');
  return { target: result.target, copied: result.copied === true, text: unb64(result.text), x: result.x, y: result.y };
}

// Replaces the selection in `target` with `replacement`, only if the selection still equals
// `expected` (re-copied and compared just before pasting).
export async function replaceSelectionInWindow({ target, expected, replacement }) {
  if (!Number.isSafeInteger(target) || target <= 0) throw new Error('The original text window is no longer available.');
  if (typeof expected !== 'string' || typeof replacement !== 'string') throw new Error('Nothing to replace.');
  await request('replace-selection', target, ['', expected, replacement]);
}

// Replaces the whole verified field (`runtimeId`, value exactly `expected`) with `replacement`.
export async function replaceFieldInWindow({ target, runtimeId, expected, replacement }) {
  if (!Number.isSafeInteger(target) || target <= 0) throw new Error('The original text field is no longer available.');
  if (typeof expected !== 'string' || typeof runtimeId !== 'string' || !runtimeId) throw new Error('The original text field could not be verified.');
  await request('replace-field', target, [runtimeId, expected, replacement]);
}
