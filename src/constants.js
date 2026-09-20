// Shared by the content script (classic script) and the background worker (module),
// so it attaches to globalThis instead of exporting.
globalThis.XAF = Object.freeze({
  MSG: Object.freeze({
    CLASSIFY: 'xaf/classify',
    LABEL: 'xaf/label',
  }),
  STORE: Object.freeze({
    API_KEY: 'apiKey',
    THRESHOLD: 'threshold',
    MODE: 'mode',
    LABELING: 'labeling',
    WEIGHTS: 'weights',
    LABELS: 'labels',
  }),
  MODE: Object.freeze({
    COLLAPSE: 'collapse',
    ANIMATED: 'animated',
    DIM: 'dim',
    BADGE: 'badge',
  }),
  LABEL: Object.freeze({ AI: 1, HUMAN: 0 }),
  DEFAULTS: Object.freeze({
    threshold: 0.75,
    mode: 'collapse',
    labeling: true,
  }),
});
