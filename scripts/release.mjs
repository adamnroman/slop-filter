#!/usr/bin/env node
// Cuts a release: checks everything, then creates the annotated tag. It never pushes.
//   1. Set the release version (three numbers) in manifest.json and package.json.
//   2. Move the Unreleased notes in CHANGELOG.md under "## [x.y.z] - yyyy-mm-dd".
//   3. Commit, then run: node scripts/release.mjs
//   4. Push the branch and the tag. The Release workflow publishes the GitHub Release.
import { execFileSync } from 'node:child_process';
import { RELEASE_VERSION, manifestVersion, notesFor, packageVersion, tagFor } from './changelog.mjs';

const RELEASE_BRANCH = 'main';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const fail = (message) => {
  console.error(`Not released: ${message}`);
  process.exit(1);
};

const version = manifestVersion();
const tag = tagFor(version);

if (!RELEASE_VERSION.test(version)) fail(`manifest.json version ${version} is a development build. A release is three numbers, like 0.7.0.`);
if (packageVersion() !== version) fail(`package.json version ${packageVersion()} does not match manifest.json ${version}.`);
if (git('branch', '--show-current') !== RELEASE_BRANCH) fail(`releases are cut from ${RELEASE_BRANCH}.`);
if (git('status', '--porcelain')) fail('the working tree has uncommitted changes.');
if (git('tag', '--list', tag)) fail(`tag ${tag} already exists.`);

let notes;
try {
  notes = notesFor(version);
} catch (error) {
  fail(error.message);
}

try {
  execFileSync('node', ['--test'], { stdio: 'inherit' });
} catch {
  fail('the tests fail.');
}

git('tag', '--annotate', tag, '--message', `Slop Filter ${version}\n\n${notes}`);
console.log(`\nTagged ${tag}. Nothing was pushed. To publish:\n  git push origin ${RELEASE_BRANCH} ${tag}`);
