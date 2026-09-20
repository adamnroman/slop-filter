import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { RELEASE_VERSION, manifestVersion, notesFor, packageVersion, releases } from '../scripts/changelog.mjs';

const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');

test('every release has notes and a link, newest first', () => {
  const all = releases();
  assert.ok(all.length > 0);
  for (const { version, notes } of all) {
    assert.ok(notes.length > 0, `${version} has no notes`);
    assert.ok(changelog.includes(`\n[${version}]: https://`), `${version} has no link at the bottom`);
  }
  const versions = all.map((entry) => entry.version);
  const sorted = [...versions].sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  assert.deepEqual(versions, sorted);
});

test('notes stop at the next release', () => {
  assert.ok(notesFor('0.5.2').includes('Slop Filter'));
  assert.ok(!notesFor('0.5.2').includes('first version in this repository'));
});

test('a release version in the manifest has a changelog section and matches package.json', () => {
  const version = manifestVersion();
  // Development builds carry a fourth number and are not released.
  if (!RELEASE_VERSION.test(version)) return;
  assert.equal(packageVersion(), version);
  assert.ok(notesFor(version).length > 0);
});
