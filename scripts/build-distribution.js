import { cp, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, Platform, Arch } from 'electron-builder';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const output = path.join(root, 'release');
const stage = path.join(output, `staging-${Date.now()}`);
const appDir = path.join(stage, 'app');
await mkdir(appDir, { recursive: true });

// Only explicitly public application inputs enter the package. Never copy the checkout.
for (const name of ['src', 'public', 'assets', 'LICENSE', 'SIWC-DEVKIT-LICENSE.txt', 'THIRD_PARTY_NOTICES.md']) {
  await cp(path.join(root, name), path.join(appDir, name), {
    recursive: true,
    filter: (file) => !/\.test\.js$|editor-reader-fixture\.cs$/.test(file),
  });
}

const bundled = new Map();
async function copyDependency(name, from) {
  const resolver = createRequire(path.join(from, 'package.json'));
  let packageFile;
  // Resolve package directories directly: ESM-only packages may hide package.json
  // and have no CommonJS export, even though their runtime imports are valid.
  for (const directory of resolver.resolve.paths(name) || []) {
    const candidate = path.join(directory, name, 'package.json');
    try {
      if (JSON.parse(await readFile(candidate, 'utf8')).name === name) { packageFile = candidate; break; }
    } catch { /* Continue along Node's package search path. */ }
  }
  if (!packageFile) throw new Error(`Cannot locate installed runtime package ${name}`);
  const source = await realpath(path.dirname(packageFile));
  const metadata = JSON.parse(await readFile(path.join(source, 'package.json'), 'utf8'));
  if (bundled.has(name)) {
    if (bundled.get(name) !== metadata.version) throw new Error(`Conflicting versions of ${name}`);
    return metadata.version;
  }
  bundled.set(name, metadata.version);
  const destination = path.join(appDir, 'node_modules', name);
  await cp(source, destination, {
    recursive: true, dereference: true,
    filter: (file) => {
      const parts = path.relative(source, file).split(path.sep);
      if (name === '@siwc/local' && parts[0] && !['dist', 'package.json'].includes(parts[0])) return false;
      // ONNX Runtime ships native binaries for every platform; the Windows x64 package needs one.
      if (name === 'onnxruntime-node' && parts[0] === 'bin' && ((parts[2] && parts[2] !== 'win32') || (parts[3] && parts[3] !== 'x64'))) return false;
      return !parts.some((part) => ['node_modules', '.git', 'test', 'tests', '.cache'].includes(part));
    },
  });
  if (name === '@siwc/local') {
    for (const entry of await readdir(destination)) {
      if (!['dist', 'package.json'].includes(entry)) throw new Error(`Unexpected DevKit package input: ${entry}`);
    }
    await readFile(path.join(destination, 'dist/index.js'));
  }
  for (const dependency of Object.keys(metadata.dependencies || {})) await copyDependency(dependency, source);
  // Optional dependencies hold platform binaries (for example sharp's Windows build): copy the
  // ones npm installed for this platform, skip the rest.
  for (const dependency of Object.keys(metadata.optionalDependencies || {})) {
    if (dependency === '@siwc/local') continue;
    try { await copyDependency(dependency, source); } catch (error) { if (!/Cannot locate/.test(error.message)) throw error; }
  }
  return metadata.version;
}

const dependencies = {};
// The ChatGPT DevKit is required unless the build explicitly opts out (CI builds a Gemini and
// offline-only package this way). Never dropped silently.
const withoutChatGPT = process.env.CLEARWRITE_DIST_WITHOUT_CHATGPT === '1';
if (withoutChatGPT) console.log('Building WITHOUT the optional ChatGPT DevKit (CLEARWRITE_DIST_WITHOUT_CHATGPT=1).');
for (const name of [...Object.keys(manifest.dependencies), ...(withoutChatGPT ? [] : ['@siwc/local'])]) {
  dependencies[name] = await copyDependency(name, root);
}
await writeFile(path.join(appDir, 'package.json'), JSON.stringify({
  name: manifest.name, version: manifest.version, description: manifest.description,
  author: manifest.author, license: manifest.license, type: 'module', main: manifest.main, dependencies,
}, null, 2));
await writeFile(path.join(appDir, 'build-manifest.json'), JSON.stringify({
  version: manifest.version,
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  sourceDirty: Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()),
  dependencies: Object.fromEntries(bundled),
  chatgptLicense: withoutChatGPT ? 'not included' : 'SIWC-DEVKIT-LICENSE.txt (noncommercial only)',
}, null, 2));

await build({
  targets: Platform.WINDOWS.createTarget(['nsis', 'zip'], Arch.x64),
  publish: 'never',
  config: {
    appId: 'net.clearwrite.desktop', productName: 'ClearWrite',
    directories: { app: appDir, output },
    electronVersion: manifest.devDependencies.electron,
    electronDist: path.join(root, 'node_modules/electron/dist'),
    asar: false, npmRebuild: false,
    publish: [{ provider: 'github', owner: 'nisar87', repo: 'ClearWrite',
      channel: manifest.version.includes('-') ? 'beta' : 'latest',
      releaseType: manifest.version.includes('-') ? 'prerelease' : 'release' }],
    generateUpdatesFilesForAllChannels: true,
    files: ['**/*'],
    extraFiles: [
      { from: path.join(root, 'docs/GETTING-STARTED.md'), to: 'GETTING-STARTED.md' },
      { from: path.join(root, 'SIWC-DEVKIT-LICENSE.txt'), to: 'SIWC-DEVKIT-LICENSE.txt' },
      { from: path.join(root, 'THIRD_PARTY_NOTICES.md'), to: 'THIRD_PARTY_NOTICES.md' },
      { from: path.join(root, 'LICENSE'), to: 'CLEARWRITE-LICENSE.txt' },
    ],
    win: { executableName: 'ClearWrite', signExecutable: false, requestedExecutionLevel: 'asInvoker' },
    nsis: {
      oneClick: false, perMachine: false, allowElevation: false,
      allowToChangeInstallationDirectory: true, createDesktopShortcut: true,
      createStartMenuShortcut: true, runAfterFinish: false, deleteAppDataOnUninstall: false,
      license: path.join(root, 'docs/DISTRIBUTION-LICENSE.txt'),
      artifactName: 'ClearWrite-${version}-Setup-${arch}.${ext}',
    },
    artifactName: 'ClearWrite-${version}-Windows-${arch}.${ext}',
  },
});
const artifacts = (await readdir(output)).filter((name) => name.includes(manifest.version) && /\.(exe|zip)$/.test(name));
const yaml = createRequire(import.meta.url)('js-yaml');
const channel = manifest.version.includes('-') ? 'beta' : 'latest';
const updateInfo = yaml.load(await readFile(path.join(output, `${channel}.yml`), 'utf8'));
const installerName = `ClearWrite-${manifest.version}-Setup-x64.exe`;
const installerInfo = updateInfo.files?.find((file) => file.url === installerName);
const installerHash = createHash('sha512').update(await readFile(path.join(output, installerName))).digest('base64');
if (updateInfo.version !== manifest.version || installerInfo?.sha512 !== installerHash) throw new Error('Invalid update channel metadata or installer checksum');
const checksums = [];
for (const name of artifacts) checksums.push(`${createHash('sha256').update(await readFile(path.join(output, name))).digest('hex')}  ${name}`);
await writeFile(path.join(output, 'SHA256SUMS.txt'), `${checksums.join('\n')}\n`);
console.log(`Distribution ready: ${output}`);
