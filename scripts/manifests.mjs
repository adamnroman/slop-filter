// The browser-specific manifest, derived from manifest.json so the browsers cannot
// drift apart. Only the Firefox differences live here: the background entry and the
// add-on identity. Everything else, permissions and content scripts included, is
// inherited from the shared manifest.
import { readFileSync } from 'node:fs';

export const BROWSERS = ['chrome', 'firefox'];
// On Firefox the add-on ID is the extension's permanent identity. It must be a
// project address, never a contributor's, because it outlives every contributor.
export const FIREFOX_ID = 'slop-filter@adamnroman.github.io';
// Firefox 112 is the first release with MV3 background scripts as a module.
export const FIREFOX_MIN_VERSION = '112.0';

export const readManifest = (path = 'manifest.json') => JSON.parse(readFileSync(path, 'utf8'));

export function resolveManifest(target, source) {
  if (!BROWSERS.includes(target)) throw new Error(`Unknown browser: ${target}`);
  const manifest = structuredClone(source);
  if (target === 'chrome') return manifest;

  const { service_worker: serviceWorker, ...background } = manifest.background ?? {};
  if (!serviceWorker) {
    throw new Error('manifest.json has no background.service_worker to derive the Firefox package from');
  }
  manifest.background = { scripts: [serviceWorker], ...background };
  manifest.browser_specific_settings = {
    gecko: { id: FIREFOX_ID, strict_min_version: FIREFOX_MIN_VERSION },
  };
  return manifest;
}
