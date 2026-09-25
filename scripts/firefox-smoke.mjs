#!/usr/bin/env node
// Firefox package validation and optional runtime smoke test.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const staging = mkdtempSync(join(tmpdir(), 'slop-filter-firefox-'));
try {
  execFileSync('node', ['scripts/zip.mjs', 'firefox'], { stdio: 'inherit' });
  const archive = readdirSync('dist')
    .filter((file) => file.endsWith('-firefox.zip'))
    .map((file) => join('dist', file))
    .sort()
    .at(-1);
  if (!archive) throw new Error('Firefox archive was not created');
  execFileSync('unzip', ['-q', archive, '-d', staging]);
  execFileSync('npx', ['--yes', 'web-ext@8.9.0', 'lint', '--source-dir', staging], { stdio: 'inherit' });

  const firefox = process.env.FIREFOX_BIN;
  if (!firefox || !existsSync(firefox)) {
    throw new Error('Firefox runtime smoke test requires FIREFOX_BIN to point to a Firefox executable');
  }

  try {
    execFileSync('timeout', ['12s', 'npx', '--yes', 'web-ext@8.9.0', 'run', '--source-dir', staging, '--firefox', firefox, '--no-reload'], {
      stdio: 'inherit',
    });
  } catch (error) {
    // timeout(1) status 124 means Firefox launched and stayed alive for the smoke window.
    if (error.status !== 124) throw error;
  }
} finally {
  rmSync(staging, { recursive: true, force: true });
}
