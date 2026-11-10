// Downloads the on-device grammar model listed in assets/models/grammar-model.json into
// assets/models/<name>/, pinned to a revision and verified by SHA-256. Run at build time
// (npm run model:fetch); the app never downloads anything at runtime.
// With --record, resolves the latest revision and prints the hashes to pin (no verification).
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../assets/models/', import.meta.url));
const manifestPath = path.join(root, 'grammar-model.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const record = process.argv.includes('--record');
let revision = manifest.revision;
if (record || !revision) {
  const info = await (await fetch(`https://huggingface.co/api/models/${manifest.repo}`)).json();
  revision = info.sha;
  if (!record) throw new Error('grammar-model.json has no pinned revision; run with --record and pin it.');
}
const target = path.join(root, manifest.name);
const hashes = {};
for (const [file, expected] of Object.entries(manifest.files)) {
  const destination = path.join(target, file);
  let bytes;
  try {
    await access(destination);
    bytes = await readFile(destination);
    if (!record && createHash('sha256').update(bytes).digest('hex') === expected) { hashes[file] = expected; continue; }
  } catch { /* not downloaded yet */ }
  const response = await fetch(`https://huggingface.co/${manifest.repo}/resolve/${revision}/${file}`);
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${file}`);
  bytes = Buffer.from(await response.arrayBuffer());
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (!record && actual !== expected) throw new Error(`Checksum mismatch for ${file}`);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, bytes);
  hashes[file] = actual;
}
if (record) console.log(JSON.stringify({ revision, files: hashes }, null, 2));
else console.log(`Grammar model ready: ${manifest.name} @ ${revision.slice(0, 12)} (${Object.keys(hashes).length} files verified)`);
