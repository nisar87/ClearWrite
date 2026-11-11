// Prints the version for the next automatic release. A prerelease line such as 0.2.0-beta.3 in
// package.json continues as 0.2.0-beta.<next>, after the highest published tag on that line, so
// installed copies always see a newer version. A plain version (1.0.0) must not exist yet.
// Usage: node scripts/release-version.js <file with one published tag per line>
import { readFile } from 'node:fs/promises';

const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const tags = (await readFile(process.argv[2] || 0, 'utf8').catch(() => '')).split(/\r?\n/).map((tag) => tag.trim().replace(/^v/, '')).filter(Boolean);
export function nextVersion(current, published) {
  const match = current.match(/^(\d+\.\d+\.\d+-[a-z]+\.)(\d+)$/);
  if (!match) {
    if (published.includes(current)) throw new Error(`Version ${current} is already released; raise the version in package.json.`);
    return current;
  }
  const [, prefix, number] = match;
  const numbers = published.filter((tag) => tag.startsWith(prefix)).map((tag) => Number(tag.slice(prefix.length))).filter(Number.isSafeInteger);
  const highest = Math.max(Number(number) - 1, ...numbers);
  return `${prefix}${highest + 1}`;
}
if (process.argv[1]?.endsWith('release-version.js')) console.log(nextVersion(manifest.version, tags));
