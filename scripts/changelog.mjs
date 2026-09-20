// Reads release notes out of CHANGELOG.md. Used by the release script, the release
// workflow, and the tests.
//   node scripts/changelog.mjs v0.6.2   prints that version's notes, and fails when the
//                                       tag does not match `version` in manifest.json
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('../', import.meta.url);
const TAG_PREFIX = 'v';
export const RELEASE_VERSION = /^\d+\.\d+\.\d+$/;

const read = (path) => readFileSync(new URL(path, ROOT), 'utf8');

export const manifestVersion = () => JSON.parse(read('manifest.json')).version;
export const packageVersion = () => JSON.parse(read('package.json')).version;
export const tagFor = (version) => `${TAG_PREFIX}${version}`;

// Every "## [x.y.z] - yyyy-mm-dd" section, newest first, as { version, date, notes }.
export function releases(changelog = read('CHANGELOG.md')) {
  const heading = /^## \[(\d+\.\d+\.\d+)\] - (\d{4}-\d{2}-\d{2})$/gm;
  const found = [...changelog.matchAll(heading)];
  return found.map((match, index) => {
    const start = match.index + match[0].length;
    const nextSection = found[index + 1]?.index ?? changelog.search(/^\[[^\]]+\]: /m);
    const end = nextSection === -1 ? changelog.length : nextSection;
    return { version: match[1], date: match[2], notes: changelog.slice(start, end).trim() };
  });
}

export function notesFor(version) {
  const release = releases().find((entry) => entry.version === version);
  if (!release) throw new Error(`CHANGELOG.md has no "## [${version}] - date" section`);
  if (!release.notes) throw new Error(`CHANGELOG.md section for ${version} is empty`);
  return release.notes;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const tag = process.argv[2];
  try {
    if (!tag) throw new Error('usage: node scripts/changelog.mjs vX.Y.Z');
    if (tag !== tagFor(manifestVersion())) {
      throw new Error(`tag ${tag} does not match manifest.json version ${manifestVersion()}`);
    }
    console.log(notesFor(manifestVersion()));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
