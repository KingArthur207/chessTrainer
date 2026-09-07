// Downloads the latest official Stockfish release for this platform into
// ./stockfish so the app's native engine provider can find it.
//
//   npm run fetch:stockfish
//
// Stockfish is GPL-3.0; the licence is kept next to the binary.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dest = path.join(root, 'stockfish');
const ASSET = {
  darwin: 'stockfish-macos-universal',
  linux: 'stockfish-ubuntu-x86-64-avx2',
  win32: 'stockfish-windows-x86-64-avx2',
}[process.platform];
if (!ASSET) {
  console.error(`No official Stockfish build for platform ${process.platform}`);
  process.exit(1);
}

const release = await (await fetch('https://api.github.com/repos/official-stockfish/Stockfish/releases/latest')).json();
const asset = release.assets.find((a) => a.name.startsWith(ASSET) && /\.(tar\.gz|tar|zip)$/.test(a.name));
if (!asset) {
  console.error(`Release ${release.tag_name} has no asset starting with ${ASSET}`);
  process.exit(1);
}
console.log(`Downloading ${asset.name} (${(asset.size / 1e6).toFixed(1)} MB) from ${release.tag_name}…`);
fs.mkdirSync(dest, { recursive: true });
const archive = path.join(dest, asset.name);
fs.writeFileSync(archive, Buffer.from(await (await fetch(asset.browser_download_url)).arrayBuffer()));

// Archives contain a top-level "stockfish/" folder with the binary, licence and wiki.
const tmp = path.join(dest, '.extract');
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp);
execFileSync('tar', ['-xf', archive, '-C', tmp]);
const inner = path.join(tmp, 'stockfish');
const binary = fs.readdirSync(inner).find((f) => f.startsWith('stockfish-') && !f.endsWith('.md'));
fs.copyFileSync(path.join(inner, binary), path.join(dest, binary));
fs.chmodSync(path.join(dest, binary), 0o755);
for (const extra of ['Copying.txt']) {
  if (fs.existsSync(path.join(inner, extra))) fs.copyFileSync(path.join(inner, extra), path.join(dest, extra));
}
const wiki = path.join(inner, 'wiki', 'UCI-Protocol-and-Stockfish-Commands.md');
if (fs.existsSync(wiki)) fs.copyFileSync(wiki, path.join(dest, 'UCI-Protocol.md'));
fs.rmSync(tmp, { recursive: true, force: true });
fs.rmSync(archive);
console.log(`Installed ${binary} (${release.tag_name}) into ${dest}`);
