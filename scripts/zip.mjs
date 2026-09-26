#!/usr/bin/env node
// Builds a browser package with the selected manifest at its root.
//   node scripts/zip.mjs chrome   -> dist/slop-filter-<version>-chrome.zip
//   node scripts/zip.mjs firefox  -> dist/slop-filter-<version>-firefox.zip
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { manifestVersion } from './changelog.mjs';
import { readManifest, resolveManifest } from './manifests.mjs';

const target = process.argv[2] ?? 'chrome';
// One source of truth: the Firefox manifest is derived from manifest.json at build time.
const manifest = resolveManifest(target, readManifest());
const packageFiles = ['options.html', 'src', 'assets', 'LICENSE'];
const exclude = ['*.DS_Store', 'assets/icons/icon-source.png'];
const outDir = 'dist';
const out = `${outDir}/slop-filter-${manifestVersion()}-${target}.zip`;
const staging = mkdtempSync(join(tmpdir(), 'slop-filter-'));

mkdirSync(outDir, { recursive: true });
rmSync(out, { force: true });
try {
  writeFileSync(join(staging, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  for (const file of packageFiles) cpSync(file, join(staging, file), { recursive: true });
  try {
    execFileSync('zip', ['-r', '-q', '-X', join(process.cwd(), out), '.', '-x', ...exclude], {
      cwd: staging,
      stdio: 'inherit',
    });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    execFileSync('python3', ['-c', `
import os, sys, zipfile
root, output = sys.argv[1:]
excluded = ('icon-source.png', '.DS_Store')
with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
    for directory, _, files in os.walk(root):
        for filename in files:
            path = os.path.join(directory, filename)
            if any(part in excluded for part in path.split(os.sep)):
                continue
            archive.write(path, os.path.relpath(path, root))
`, staging, join(process.cwd(), out)], { stdio: 'inherit' });
  }
} finally {
  rmSync(staging, { recursive: true, force: true });
}
console.log(out);
