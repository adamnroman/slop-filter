#!/usr/bin/env node
// Builds the zip for the Chrome Web Store: only the files Chrome needs, manifest at the root.
//   node scripts/zip.mjs   ->  dist/slop-filter-<version>.zip
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { manifestVersion } from './changelog.mjs';

const PACKAGE_FILES = ['manifest.json', 'options.html', 'src', 'assets', 'LICENSE'];
// The 512 px source is only for regenerating the sizes.
const EXCLUDE = ['*.DS_Store', 'assets/icons/icon-source.png'];
const OUT_DIR = 'dist';

const out = `${OUT_DIR}/slop-filter-${manifestVersion()}.zip`;
mkdirSync(OUT_DIR, { recursive: true });
rmSync(out, { force: true });
execFileSync('zip', ['-r', '-q', '-X', out, ...PACKAGE_FILES, '-x', ...EXCLUDE], { stdio: 'inherit' });
console.log(out);
