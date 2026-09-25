// The Firefox package is derived from manifest.json so the two browsers cannot drift
// apart. These tests pin the differences that are allowed, and prove that everything
// else is inherited from the shared manifest.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { BROWSERS, FIREFOX_ID, FIREFOX_MIN_VERSION, readManifest, resolveManifest } from '../scripts/manifests.mjs';

const source = readManifest();

// Builds a package and returns { manifest, entries } for it.
function build(target) {
  const archive = execFileSync('node', ['scripts/zip.mjs', target], { encoding: 'utf8' }).trim();
  assert.ok(existsSync(archive), `${target} archive was not created`);
  const entries = execFileSync('unzip', ['-Z1', archive], { encoding: 'utf8' }).trim().split('\n');
  const manifest = JSON.parse(execFileSync('unzip', ['-p', archive, 'manifest.json'], { encoding: 'utf8' }));
  return { archive, entries, manifest };
}

test('chrome gets the shared manifest untouched', () => {
  assert.deepEqual(resolveManifest('chrome', source), source);
});

test('firefox keeps one source of truth and only overrides the background entry and identity', () => {
  const firefox = resolveManifest('firefox', source);

  // The only differences are the two documented ones.
  const { background: chromeBackground, ...chromeRest } = source;
  const { background: firefoxBackground, browser_specific_settings: settings, ...firefoxRest } = firefox;
  assert.deepEqual(firefoxRest, chromeRest, 'fields other than background and identity must be inherited');
  assert.equal(firefoxBackground.service_worker, undefined, 'firefox must not keep service_worker');
  assert.deepEqual(firefoxBackground.scripts, [source.background.service_worker]);
  assert.equal(firefoxBackground.type, 'module');
  assert.deepEqual(settings, {
    gecko: { id: FIREFOX_ID, strict_min_version: FIREFOX_MIN_VERSION },
  });
  assert.equal(chromeBackground.service_worker, source.background.service_worker, 'chrome keeps its worker');
});

test('firefox inherits permissions, content scripts, and any future shared field', () => {
  const firefox = resolveManifest('firefox', source);
  assert.deepEqual(firefox.permissions, source.permissions);
  assert.deepEqual(firefox.host_permissions, source.host_permissions);
  assert.deepEqual(firefox.content_scripts, source.content_scripts);

  // A field added to the shared manifest later must reach Firefox without an edit here.
  const future = { ...source, minimum_chrome_version: '116', some_new_field: { a: 1 } };
  const derived = resolveManifest('firefox', future);
  assert.equal(derived.minimum_chrome_version, '116');
  assert.deepEqual(derived.some_new_field, { a: 1 });
});

test('the shared manifest carries the upstream Firefox-relevant fields', () => {
  assert.ok(source.host_permissions.includes('https://openrouter.ai/api/*'), 'OpenRouter permission');
  const youtube = source.content_scripts.find((entry) => entry.matches.includes('https://www.youtube.com/*'));
  assert.ok(youtube, 'a YouTube content script');
  assert.ok(youtube.js.includes('src/transcript.js'), 'the YouTube transcript script');
});

test('the add-on id is the project one, not a contributor\u2019s', () => {
  assert.equal(resolveManifest('firefox', source).browser_specific_settings.gecko.id, FIREFOX_ID);
  assert.ok(!FIREFOX_ID.includes('carmelocampos'));
});

test('an unknown browser and a manifest with no worker are refused', () => {
  assert.throws(() => resolveManifest('safari', source), /Unknown browser/);
  assert.throws(() => resolveManifest('firefox', { manifest_version: 3 }), /service_worker/);
});

test('both archives hold a matching manifest and every file the manifest names', () => {
  // The version comes from the manifest and so does the archive name, so this catches
  // a package whose manifest and filename disagree.
  const version = source.version;
  for (const target of BROWSERS) {
    const { archive, entries, manifest } = build(target);
    assert.ok(archive.endsWith(`slop-filter-${version}-${target}.zip`), `${archive} is not versioned ${version}`);
    assert.equal(manifest.version, version, `${target} manifest version matches its filename`);
    assert.equal(manifest.manifest_version, 3);
    assert.deepEqual(manifest.icons, source.icons);
    assert.ok(manifest.options_ui.page && entries.includes(manifest.options_ui.page), 'options page is packaged');
    for (const path of [...entries]) assert.ok(!path.startsWith('/'), `${path} is not at the archive root`);

    const referenced = [
      ...Object.values(manifest.icons),
      ...manifest.content_scripts.flatMap((entry) => [...(entry.js ?? []), ...(entry.css ?? [])]),
      ...Object.values(manifest.background.scripts ?? [manifest.background.service_worker ?? []]).flat(),
    ];
    for (const path of referenced) assert.ok(entries.includes(path), `${target} is missing ${path}`);
  }
});

test('the packages carry no development files', () => {
  const { entries } = build('chrome');
  for (const path of entries) {
    assert.ok(!path.startsWith('test/'), `${path} is a test file`);
    assert.ok(!path.startsWith('scripts/'), `${path} is a build script`);
    assert.ok(!path.startsWith('docs/'), `${path} is documentation`);
    assert.ok(!path.startsWith('.github/'), `${path} is CI configuration`);
  }
  assert.ok(!entries.includes('manifest.firefox.json'), 'no second manifest is packaged');
  assert.ok(!entries.includes('package-lock.json'));
});
