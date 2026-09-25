#!/usr/bin/env node
// Firefox package validation and optional runtime smoke test.
import { execFileSync, spawn } from 'node:child_process';
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
    console.log('Firefox runtime smoke test skipped; set FIREFOX_BIN to a Firefox executable to run it.');
    process.exit(0);
  }

  await new Promise((resolve, reject) => {
    const child = spawn('npx', ['--yes', 'web-ext@8.9.0', 'run', '--source-dir', staging, '--firefox', firefox, '--no-reload'], {
      stdio: 'inherit',
    });
    const timer = setTimeout(() => child.kill('SIGTERM'), 10000);
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      if (signal === 'SIGTERM') resolve();
      else if (code === 0) resolve();
      else reject(new Error(`web-ext runtime smoke test exited with ${code ?? signal}`));
    });
  });
} finally {
  rmSync(staging, { recursive: true, force: true });
}
