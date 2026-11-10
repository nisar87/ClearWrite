import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { proofreadLocally, stopLocalProofreader } from './local-proofread.js';
import { stopWindowsInput, validateWindowsInput } from './windows-input.js';

// Explicit developer-only launch mode: no monitoring, provider calls, or sign-in.
export async function runDistributionSmoke({ app, BrowserWindow, safeStorage }, dataDir) {
  const root = path.dirname(fileURLToPath(import.meta.url));
  const checks = [];
  let window;
  let error;
  try {
    assert.equal(app.isPackaged, true);
    window = new BrowserWindow({ show: false, webPreferences: {
      preload: path.join(root, 'preload.cjs'), contextIsolation: true,
      sandbox: true, nodeIntegration: false, spellcheck: false,
    } });
    for (const page of ['index.html', 'assistant.html']) {
      await window.loadFile(path.resolve(root, '../public', page));
      assert.equal(await window.webContents.executeJavaScript('typeof window.clearWrite.getState'), 'function');
      checks.push(`${page}: loaded with preload bridge`);
    }
    const result = await proofreadLocally('I am not quet sure what to do.');
    assert.ok(result.correctedText.includes('quite'), JSON.stringify(result));
    checks.push('offline worker, WASM and context model: correction passed');
    const devkit = await import('@siwc/local').catch(() => null);
    const build = JSON.parse(await readFile(path.resolve(root, '../build-manifest.json'), 'utf8'));
    if (!devkit) {
      assert.equal(build.chatgptLicense, 'not included', 'ChatGPT DevKit missing from a build that should include it');
      checks.push('ChatGPT DevKit: not included in this build (explicit opt-out)');
    }
    const { createChatGPT } = devkit || { createChatGPT: null };
    if (createChatGPT) {
    const client = createChatGPT({ appName: 'ClearWrite', appId: 'clearwrite-desktop', redirectPort: 0,
      storageDir: path.join(dataDir, 'chatgpt'), openBrowser: async () => { throw new Error('No browser calls allowed in smoke test'); },
      credentialEncryption: {
        id: 'electron-safe-storage-v1', isAvailable: () => safeStorage.isEncryptionAvailable(),
        encrypt: (value) => safeStorage.encryptString(value),
        decrypt: (value) => safeStorage.decryptString(Buffer.from(value)),
      },
    });
    assert.ok(client && typeof client.signIn === 'function');
    assert.equal(safeStorage.isEncryptionAvailable(), true);
    checks.push('ChatGPT dependency closure and Windows credential encryption: available (no login/inference attempted)');
    }
    assert.equal(safeStorage.isEncryptionAvailable(), true);
    const updater = await import('electron-updater');
    assert.equal(typeof updater.default.NsisUpdater, 'function');
    checks.push('Windows updater dependency closure: available (no check/download/install attempted)');
    const powershell = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
    const { stdout } = await promisify(execFile)(powershell,
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Mta', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'focus-monitor.ps1')],
      { windowsHide: true, timeout: 25000, env: { ...process.env, CLEARWRITE_READER_VALIDATE: '1' } });
    assert.equal(stdout.trim(), 'ok');
    checks.push('packaged Windows accessibility helpers: compile passed');
    assert.equal(await validateWindowsInput(), true);
    checks.push('packaged keyboard/clipboard helper: compile passed (no input sent)');
  } catch (cause) { error = cause.stack || String(cause); }
  finally {
    stopLocalProofreader();
    stopWindowsInput();
    window?.destroy();
    await mkdir(dataDir, { recursive: true });
    await writeFile(path.join(dataDir, 'distribution-smoke.json'), JSON.stringify({ passed: !error, checks, error }, null, 2));
  }
  app.exit(error ? 1 : 0);
}
