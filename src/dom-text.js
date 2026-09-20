// DOM text helpers shared by the site adapters.
const PARAGRAPH_TAGS = new Set(['P', 'LI', 'BLOCKQUOTE', 'PRE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6']);

globalThis.XAF_DOM = Object.freeze({
  // Visible text of a node: emoji images by their alt text, <br> and the end of a
  // paragraph as a newline, and anything matching `skipSelector` (a "see more"
  // button, say) left out.
  readText(node, skipSelector = null) {
    let out = '';
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) out += child.data;
      else if (child.nodeType !== Node.ELEMENT_NODE) continue;
      else if (skipSelector && child.matches(skipSelector)) continue;
      else if (child.nodeName === 'IMG') out += child.alt;
      else if (child.nodeName === 'BR') out += '\n';
      else {
        out += globalThis.XAF_DOM.readText(child, skipSelector);
        // Without this, "<p>one.</p><p>Two.</p>" reads as "one.Two."
        if (PARAGRAPH_TAGS.has(child.nodeName)) out += '\n';
      }
    }
    return out;
  },

  // Short stable id for sites that expose none. 53-bit cyrb hash, base 36.
  hash(text) {
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      h1 = Math.imul(h1 ^ code, 2654435761);
      h2 = Math.imul(h2 ^ code, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  },
});
