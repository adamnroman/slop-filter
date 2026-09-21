// Site adapter for www.youtube.com comments. See sites/x.js for the adapter contract.
//
// This judges comments, not videos. Whether a video is slop depends on its script, not
// its title or thumbnail, and that is a bigger job for later.
//
// Comments are plain elements with stable ids, inspected live in 2026-09:
//   - every comment, top level or reply, is a `ytd-comment-view-model`
//   - its text is `#content-text`, complete even when YouTube collapses it behind "Read more"
//   - its header row `#header-author` is a flex row of author, badges, and time
//   - the time links to the comment, and the `lc` parameter of that link is the comment id
//   - in a `ytd-comment-thread-renderer`, the top comment sits in `#comment-container` and
//     its replies in `#replies`
// YouTube enforces Trusted Types, so nothing here or in the core may use innerHTML.
(() => {
  const { readText, hash } = globalThis.XAF_DOM;

  const SEL = Object.freeze({
    COMMENT: 'ytd-comment-view-model',
    TEXT: '#content-text',
    AUTHOR: '#author-text',
    HEADER: '#header-author',
    PERMALINK: '#published-time-text a',
    THREAD: 'ytd-comment-thread-renderer',
    REPLIES: '#replies',
    TOP_COMMENT: '#comment-container ytd-comment-view-model',
    VIDEO_TITLE: 'ytd-watch-metadata h1',
  });
  const COMMENT_ID = /[?&]lc=([\w.-]+)/;
  const ID_PREFIX = 'youtube:comment:';

  const textOf = (node) => (node ? readText(node).trim() : '');

  function extract(comment) {
    const text = textOf(comment.querySelector(SEL.TEXT));
    if (!text) return null;
    const handle = textOf(comment.querySelector(SEL.AUTHOR));
    const id =
      comment.querySelector(SEL.PERMALINK)?.getAttribute('href')?.match(COMMENT_ID)?.[1] ??
      hash(`${handle}\n${text}`);
    return { id: ID_PREFIX + id, handle, text };
  }

  // A reply answers the top comment of its thread. A top comment answers the video, and
  // the title is the only text of the video on the page.
  function parentText(comment) {
    if (comment.closest(SEL.REPLIES)) {
      const top = comment.closest(SEL.THREAD)?.querySelector(SEL.TOP_COMMENT);
      return textOf(top?.querySelector(SEL.TEXT)) || null;
    }
    return textOf(document.querySelector(SEL.VIDEO_TITLE)) || null;
  }

  // The chip goes at the end of the comment's own header row, after the time.
  function chipHosts(comment) {
    const header = comment.querySelector(SEL.HEADER);
    return header ? [header] : [];
  }

  globalThis.XAF_SITE = Object.freeze({
    name: 'youtube',
    itemSelector: SEL.COMMENT,
    extract,
    parentText,
    chipHosts,
  });
})();
