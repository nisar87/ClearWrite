import assert from 'node:assert/strict';
import { readFile, readdir, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';

const directory = path.resolve(process.argv[2] || 'release/win-unpacked');
const app = path.join(directory, 'resources/app');
const build = JSON.parse(await readFile(path.join(app, 'build-manifest.json'), 'utf8'));
for (const name of await readdir(app)) {
  assert.ok(['src', 'public', 'assets', 'node_modules', 'package.json', 'build-manifest.json',
    'LICENSE', 'SIWC-DEVKIT-LICENSE.txt', 'THIRD_PARTY_NOTICES.md'].includes(name), `Unexpected app input: ${name}`);
}
async function inspect(folder) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name);
    assert.equal((await lstat(file)).isSymbolicLink(), false, `External link: ${file}`);
    assert.ok(!/^\.env(?:\.|$)|^personal-dictionary.*\.json$|^preferences\.json$|^gemini-api-key|^startup\.log$/i.test(entry.name), `Private filename: ${file}`);
    if (entry.isDirectory()) await inspect(file);
    else if (/\.(js|cjs|mjs|json|html|md|ps1|cs|txt)$/i.test(entry.name)) {
      const contents = await readFile(file, 'utf8');
      assert.ok(!/(?<![0-9A-Za-z_-])AIza[0-9A-Za-z_-]{35}(?![0-9A-Za-z_-])|(?<![0-9A-Za-z_-])sk-(?:proj-|svcacct-)[0-9A-Za-z_-]{30,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\r?\n[A-Za-z0-9+/]{40}/.test(contents), `Potential secret: ${file}`);
    }
  }
}
await inspect(app);
for (const [name, version] of Object.entries(build.dependencies)) {
  assert.equal(JSON.parse(await readFile(path.join(app, 'node_modules', name, 'package.json'), 'utf8')).version, version);
}
for (const component of ['offline', 'windows']) {
  const folder = path.join(app, 'assets', component);
  const manifest = JSON.parse(await readFile(path.join(folder, 'manifest.json'), 'utf8'));
  if (component === 'windows') {
    assert.equal(createHash('sha256').update(await readFile(path.join(folder, 'Interop.UIAutomationClient.dll'))).digest('hex'), manifest.sha256);
  }
}
for (const name of ['GETTING-STARTED.md', 'CLEARWRITE-LICENSE.txt', 'SIWC-DEVKIT-LICENSE.txt', 'THIRD_PARTY_NOTICES.md']) await readFile(path.join(directory, name));
if (build.dependencies['electron-updater']) {
  const yaml = createRequire(import.meta.url)('js-yaml');
  const config = yaml.load(await readFile(path.join(directory, 'resources/app-update.yml'), 'utf8'));
  assert.equal(config.provider, 'github');
  assert.equal(config.owner, 'nisar87');
  assert.equal(config.repo, 'ClearWrite');
  assert.equal(config.channel || 'latest', build.version.includes('-') ? 'beta' : 'latest');
  assert.equal(config.token, undefined);
}
console.log(JSON.stringify({ passed: true, version: build.version, sourceCommit: build.sourceCommit, sourceDirty: build.sourceDirty,
  runtimePackages: Object.keys(build.dependencies).length, checks: 'allowlist, no links/private filenames/known secret patterns, dependency versions, interop hash, notices' }, null, 2));
