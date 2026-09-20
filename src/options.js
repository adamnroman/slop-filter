(() => {
  const { STORE, LABEL, DEFAULTS } = globalThis.XAF;

  const EXPORT_FILENAME = 'labels.json';
  const MANIFEST_PATH = 'manifest.json';
  const TEXT = Object.freeze({
    SAVED: 'Saved.',
    BAD_WEIGHTS: 'Weights must be JSON shaped like {"bias": number, "w": {...}}.',
    CONFIRM_CLEAR: 'Delete every saved label?',
  });

  // Styled in options.css via [data-state].
  const STATUS_STATE = Object.freeze({ OK: 'ok', ERROR: 'error' });

  const $ = (id) => document.getElementById(id);
  const status = (text, isError = false) => {
    $('status').textContent = text;
    $('status').dataset.state = isError ? STATUS_STATE.ERROR : STATUS_STATE.OK;
  };

  // The weights field sits in a collapsed <details>. Open it so the error has something to point at.
  function revealWeights() {
    $('advanced').open = true;
    $('weights').focus();
  }

  function parseWeights(raw) {
    if (!raw.trim()) return null;
    const weights = JSON.parse(raw);
    if (typeof weights.bias !== 'number' || typeof weights.w !== 'object') throw new Error();
    return weights;
  }

  async function load() {
    const stored = await chrome.storage.local.get(Object.values(STORE));
    $('apiKey').value = stored[STORE.API_KEY] ?? '';
    $('threshold').value = Math.round((stored[STORE.THRESHOLD] ?? DEFAULTS.threshold) * 100);
    $('thresholdValue').textContent = $('threshold').value;
    $('mode').value = stored[STORE.MODE] ?? DEFAULTS.mode;
    $('labeling').checked = stored[STORE.LABELING] ?? DEFAULTS.labeling;
    $('stats').checked = stored[STORE.STATS] ?? DEFAULTS.stats;
    $('weights').value = stored[STORE.WEIGHTS] ? JSON.stringify(stored[STORE.WEIGHTS], null, 2) : '';
    showLabelCounts(stored[STORE.LABELS] ?? {});
  }

  function showLabelCounts(labels) {
    const rows = Object.values(labels);
    const ai = rows.filter((row) => row.label === LABEL.AI).length;
    $('labelCounts').textContent = `${rows.length} labeled: ${ai} AI, ${rows.length - ai} human.`;
  }

  async function save() {
    let weights;
    try {
      weights = parseWeights($('weights').value);
    } catch {
      status(TEXT.BAD_WEIGHTS, true);
      revealWeights();
      return;
    }
    await chrome.storage.local.set({
      [STORE.API_KEY]: $('apiKey').value.trim(),
      [STORE.THRESHOLD]: Number($('threshold').value) / 100,
      [STORE.MODE]: $('mode').value,
      [STORE.LABELING]: $('labeling').checked,
      [STORE.STATS]: $('stats').checked,
    });
    if (weights) await chrome.storage.local.set({ [STORE.WEIGHTS]: weights });
    else await chrome.storage.local.remove(STORE.WEIGHTS);
    status(TEXT.SAVED);
  }

  // This page is read from disk every time it opens. The running extension is not.
  // A version mismatch means Chrome still has old page scripts in memory.
  async function warnIfStale() {
    const running = chrome.runtime.getManifest().version;
    $('version').textContent = `v${running}`;
    const onDisk = await fetch(chrome.runtime.getURL(MANIFEST_PATH), { cache: 'no-store' })
      .then((response) => response.json())
      .then((manifest) => manifest.version)
      .catch(() => running);
    if (onDisk === running) return;
    $('runningVersion').textContent = running;
    $('diskVersion').textContent = onDisk;
    $('stale').hidden = false;
  }

  async function exportLabels() {
    const { [STORE.LABELS]: labels = {} } = await chrome.storage.local.get(STORE.LABELS);
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(labels, null, 2)], { type: 'application/json' }),
    );
    const link = Object.assign(document.createElement('a'), { href: url, download: EXPORT_FILENAME });
    link.click();
    URL.revokeObjectURL(url);
  }

  async function clearLabels() {
    if (!confirm(TEXT.CONFIRM_CLEAR)) return;
    await chrome.storage.local.remove(STORE.LABELS);
    showLabelCounts({});
  }

  $('threshold').addEventListener('input', () => {
    $('thresholdValue').textContent = $('threshold').value;
  });
  $('save').addEventListener('click', save);
  $('exportLabels').addEventListener('click', exportLabels);
  $('clearLabels').addEventListener('click', clearLabels);
  $('reloadExtension').addEventListener('click', () => chrome.runtime.reload());
  load();
  warnIfStale();
})();
