// Site adapter for linkedin.com. See sites/x.js for the adapter contract.
//
// LinkedIn's React front end has no stable class names. What it does have:
//   - every feed post is a `role="listitem"` whose `componentkey` starts with "update-card"
//   - every comment carries its URN in `componentkey`, on several nested wrappers
//   - post and comment text sit in `data-testid="expandable-text-box"`. The full text is
//     in the page even when it is clamped to two lines behind a "... more" button.
(() => {
  const { readText, hash } = globalThis.XAF_DOM;

  const SEL = Object.freeze({
    POST: '[role="listitem"][componentkey^="update-card"]',
    COMMENT: '[componentkey*="urn:li:comment:"]',
    TEXT: '[data-testid="expandable-text-box"]',
    MORE_BUTTON: '[data-testid="expandable-text-button"]',
    AUTHOR: 'a[href*="/in/"], a[href*="/company/"]',
  });
  const COMMENT_URN = /urn:li:comment:\([^)]*\)/;
  const AUTHOR_SLUG = /\/(?:in|company)\/([^/?#]+)/;
  const ID_PREFIX = Object.freeze({ POST: 'li:post:', COMMENT: 'li:comment:' });

  const commentUrn = (element) => element.getAttribute('componentkey')?.match(COMMENT_URN)?.[0];

  // Several nested wrappers share one comment URN. Only the outermost one is the comment.
  function isCommentRoot(element, urn) {
    const outer = element.parentElement?.closest(SEL.COMMENT);
    return !outer || commentUrn(outer) !== urn;
  }

  // First text box that belongs to this element and not to a comment nested inside it.
  function ownTextBox(element, ownUrn) {
    for (const box of element.querySelectorAll(SEL.TEXT)) {
      const comment = box.closest(SEL.COMMENT);
      const belongsToOther = comment && element.contains(comment) && commentUrn(comment) !== ownUrn;
      if (!belongsToOther) return box;
    }
    return null;
  }

  const authorOf = (element) =>
    element.querySelector(SEL.AUTHOR)?.getAttribute('href')?.match(AUTHOR_SLUG)?.[1] ?? '';

  function extract(element) {
    const urn = commentUrn(element);
    if (urn && !isCommentRoot(element, urn)) return null;

    const box = ownTextBox(element, urn);
    if (!box) return null;
    const text = readText(box, SEL.MORE_BUTTON).trim();
    const handle = authorOf(element);
    // Posts expose no id. Author plus text is stable across reloads, and a repost of
    // the same text gets the same score, which is what we want.
    const id = urn ? ID_PREFIX.COMMENT + urn : ID_PREFIX.POST + hash(`${handle}\n${text}`);
    return { id, handle, text };
  }

  // A comment replies to the post it sits under.
  function parentText(element) {
    if (!commentUrn(element)) return null;
    const post = element.closest(SEL.POST);
    const box = post && ownTextBox(post, undefined);
    return box ? readText(box, SEL.MORE_BUTTON).trim() : null;
  }

  globalThis.XAF_SITE = Object.freeze({
    name: 'linkedin',
    itemSelector: `${SEL.POST}, ${SEL.COMMENT}`,
    extract,
    parentText,
  });
})();
