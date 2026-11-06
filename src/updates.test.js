import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { createUpdateManager, UPDATE_INTERVAL_MS, UPDATE_STARTUP_MS } from './updates.js';

class FakeUpdater extends EventEmitter {
  checks = 0; downloads = 0; installs = [];
  nextVersion = '0.2.0-beta.3';
  async checkForUpdates() {
    this.checks++;
    this.emit(this.nextVersion ? 'update-available' : 'update-not-available', { version: this.nextVersion });
    this.token = { cancelled: false, cancel() { this.cancelled = true; } };
    return { cancellationToken: this.token };
  }
  async downloadUpdate() { this.downloads++; this.emit('update-downloaded', { version: this.nextVersion }); }
  quitAndInstall(...args) { this.installs.push(args); }
}
const create = (options = {}) => {
  const updater = options.updater || new FakeUpdater();
  const manager = createUpdateManager({ updater, version: '0.2.0-beta.2', ...options });
  return { updater, manager };
};

test('update checks never auto-download, auto-install or downgrade', async () => {
  const { updater, manager } = create();
  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal(updater.allowDowngrade, false);
  assert.equal(updater.channel, 'beta');
  await manager.check();
  assert.equal(manager.snapshot().status, 'available');
  assert.equal(updater.downloads, 0);
  assert.equal(updater.installs.length, 0);
});
test('stable clients stay on the stable channel', () => {
  const { updater } = create({ version: '1.0.0' });
  assert.equal(updater.allowPrerelease, false);
  assert.equal(updater.channel, 'latest');
  assert.equal(updater.allowDowngrade, false);
});
test('only a downloaded update and explicit confirmation can install', async () => {
  let approved = false;
  const { updater, manager } = create({ prepareInstall: async () => approved });
  await manager.install();
  await manager.check();
  await manager.install();
  assert.equal(updater.installs.length, 0);
  await manager.download();
  assert.equal(manager.snapshot().status, 'downloaded');
  await manager.install();
  assert.equal(manager.snapshot().status, 'downloaded');
  approved = true;
  await manager.install();
  assert.equal(manager.snapshot().status, 'installing');
  assert.deepEqual(updater.installs, [[true, true]]);
});
test('concurrent checks and downloads are ignored; verified updates are not replaced by checks', async () => {
  const { updater, manager } = create();
  const first = manager.check();
  await manager.check();
  await first;
  assert.equal(updater.checks, 1);
  const download = manager.download();
  await manager.download();
  await download;
  await manager.check();
  assert.equal(updater.downloads, 1);
  assert.equal(updater.checks, 1);
});
test('network failure stays retryable without exposing raw errors', async () => {
  const { updater, manager } = create();
  updater.checkForUpdates = async () => { throw new Error('https://user:private@bad.example token=secret'); };
  await manager.check();
  assert.equal(manager.snapshot().status, 'error');
  assert.doesNotMatch(manager.snapshot().error, /secret|private|bad.example/);
  updater.checkForUpdates = FakeUpdater.prototype.checkForUpdates;
  await manager.check();
  assert.equal(manager.snapshot().status, 'available');
});
test('checksum or signature failure cannot mark a download as ready', async () => {
  const { updater, manager } = create();
  await manager.check();
  updater.downloadUpdate = async () => { const error = new Error('SHA512 checksum mismatch'); updater.emit('error', error); throw error; };
  await manager.download();
  await manager.install();
  assert.equal(manager.snapshot().status, 'error');
  assert.match(manager.snapshot().error, /verification failed/);
  assert.equal(updater.installs.length, 0);
});
test('download progress is clamped and cancelling allows a fresh retry', async () => {
  const { updater, manager } = create();
  await manager.check();
  let rejectDownload;
  updater.downloadUpdate = async () => new Promise((_resolve, reject) => { rejectDownload = reject; });
  const pending = manager.download();
  updater.emit('download-progress', { percent: 140 });
  assert.equal(manager.snapshot().percent, 100);
  manager.cancel();
  assert.equal(updater.token.cancelled, true);
  rejectDownload(new Error('cancelled'));
  await pending;
  assert.equal(manager.snapshot().status, 'available');
  updater.downloadUpdate = FakeUpdater.prototype.downloadUpdate;
  await manager.download();
  assert.equal(updater.checks, 2);
  assert.equal(manager.snapshot().status, 'downloaded');
});
test('notifications occur once per version, not on every periodic check', async () => {
  const notifications = [];
  const { manager } = create({ notify: (version) => notifications.push(version) });
  await manager.check(); await manager.check();
  assert.deepEqual(notifications, ['0.2.0-beta.3']);
});
test('automatic checks can be disabled and disposed without affecting manual checking', async () => {
  const tasks = new Map(); let id = 0;
  const timers = {
    setTimeout(fn, ms) { tasks.set(++id, { fn, ms }); return id; },
    setInterval(fn, ms) { tasks.set(++id, { fn, ms }); return id; },
    clearTimeout(key) { tasks.delete(key); }, clearInterval(key) { tasks.delete(key); },
  };
  const { updater, manager } = create({ timers });
  manager.start();
  assert.deepEqual([...tasks.values()].map((task) => task.ms), [UPDATE_STARTUP_MS, UPDATE_INTERVAL_MS]);
  manager.setAutomatic(false);
  assert.equal(tasks.size, 0);
  await manager.check();
  assert.equal(updater.checks, 1);
  manager.setAutomatic(true); manager.dispose();
  assert.equal(tasks.size, 0);
  updater.emit('error', new Error('late shutdown request failure'));
  await manager.check();
  assert.equal(updater.checks, 1);
});
test('ZIP/development copies never start an updater or schedule network calls', async () => {
  const manager = createUpdateManager({ version: '0.2.0', updater: null });
  manager.start(); await manager.check(); await manager.download(); await manager.install();
  assert.equal(manager.snapshot().status, 'unavailable');
  assert.equal(manager.snapshot().supported, false);
  manager.dispose();
});
