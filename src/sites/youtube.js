// Site adapter for www.youtube.com: comments, and videos on the home grid and in search.
// See sites/x.js for the adapter contract.
//
// A video is judged by its script, never by its title or thumbnail. The script is the
// captions, which `loadText` fetches: an excerpt from the first minute goes to Jev as a
// transcript, with the questions about typing and punctuation left out.
//
// Getting captions from a page script, as of 2026-09: the website's own player call
// answers UNPLAYABLE, the caption links in the watch page download empty, and the
// transcript panel's endpoint refuses. Asking the player endpoint as the Android app
// works, and its caption links download in full. No cookies are sent, so none of it
// touches the user's account. YouTube changes this often. If videos stop getting scores,
// look here first.
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

  const { pickExcerpt } = globalThis.XAF_TRANSCRIPT;

  const SEL = Object.freeze({
    // Home grid and search results. The watch page sidebar and Shorts are left alone.
    CARD: 'ytd-rich-item-renderer, ytd-video-renderer',
    WATCH_LINK: 'a[href*="/watch"]',
    CHANNEL_LINK: 'a[href^="/@"]',
    CARD_META: '#metadata-line, yt-content-metadata-view-model',
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
  const VIDEO_ID = /[?&]v=([\w-]{11})/;
  const ID_PREFIX = 'youtube:comment:';
  const VIDEO_ID_PREFIX = 'youtube:video:';
  const KIND_TRANSCRIPT = 'transcript';

  const PLAYER_ENDPOINT = '/youtubei/v1/player?prettyPrint=false';
  const ANDROID_CLIENT = Object.freeze({
    clientName: 'ANDROID',
    clientVersion: '20.10.38',
    androidSdkVersion: 30,
    hl: 'en',
  });
  const CAPTION_FORMAT = Object.freeze({ PARAM: 'fmt', JSON: 'json3' });
  // Jev is strongest in English, so other languages are left unjudged for now.
  const LANGUAGE = 'en';
  const TIMEOUT_MS = 10_000;
  // Each video costs two requests to YouTube and about half a megabyte.
  const MAX_IN_FLIGHT = 3;

  const transcripts = new Map(); // video id -> promise of excerpt text, or null
  let inFlight = 0;
  const waiting = [];

  async function withSlot(task) {
    if (inFlight >= MAX_IN_FLIGHT) await new Promise((resolve) => waiting.push(resolve));
    inFlight++;
    try {
      return await task();
    } finally {
      inFlight--;
      waiting.shift()?.();
    }
  }

  // No cookies: the request does not need them, and it keeps it off the user's account.
  const request = (url, options = {}) =>
    fetch(url, { ...options, credentials: 'omit', signal: AbortSignal.timeout(TIMEOUT_MS) });

  async function captionTrackUrl(videoId) {
    const response = await request(PLAYER_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context: { client: ANDROID_CLIENT }, videoId }),
    });
    const player = await response.json();
    const tracks = player?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
    const track = tracks.find((candidate) => candidate.languageCode?.startsWith(LANGUAGE));
    if (!track) return null;
    const url = new URL(track.baseUrl, location.origin);
    url.searchParams.set(CAPTION_FORMAT.PARAM, CAPTION_FORMAT.JSON);
    return url.toString();
  }

  async function fetchExcerpt(videoId) {
    const url = await captionTrackUrl(videoId);
    if (!url) return null;
    const captions = await (await request(url)).json();
    return pickExcerpt(captions, videoId) || null;
  }

  // Resolves to the excerpt, or null when the video cannot be judged: no English captions,
  // or YouTube refused. A failure is logged, never thrown, so one bad video does not put an
  // error bar on the card.
  function loadText(post) {
    if (!post.videoId) return post.text;
    if (!transcripts.has(post.videoId)) {
      transcripts.set(
        post.videoId,
        withSlot(() => fetchExcerpt(post.videoId)).catch((error) => {
          console.warn('[xaf] transcript', post.videoId, error.message);
          transcripts.delete(post.videoId);
          return null;
        }),
      );
    }
    return transcripts.get(post.videoId);
  }

  const videoIdOf = (card) =>
    card.querySelector(SEL.WATCH_LINK)?.getAttribute('href')?.match(VIDEO_ID)?.[1] ?? null;

  function fromCard(card) {
    const videoId = videoIdOf(card);
    if (!videoId) return null; // Shorts, playlists, ads
    const handle = card.querySelector(SEL.CHANNEL_LINK)?.getAttribute('href')?.slice(1) ?? '';
    return { id: VIDEO_ID_PREFIX + videoId, videoId, handle, text: null, kind: KIND_TRANSCRIPT };
  }

  const textOf = (node) => (node ? readText(node).trim() : '');

  function extract(element) {
    if (element.matches(SEL.CARD)) return fromCard(element);
    return fromComment(element);
  }

  function fromComment(comment) {
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
    if (comment.matches(SEL.CARD)) return null;
    if (comment.closest(SEL.REPLIES)) {
      const top = comment.closest(SEL.THREAD)?.querySelector(SEL.TOP_COMMENT);
      return textOf(top?.querySelector(SEL.TEXT)) || null;
    }
    return textOf(document.querySelector(SEL.VIDEO_TITLE)) || null;
  }

  // The chip goes at the end of the comment's own header row, after the time. On a video
  // card it goes at the end of the metadata line, after the view count.
  function chipHosts(element) {
    const host = element.matches(SEL.CARD)
      ? element.querySelector(SEL.CARD_META)
      : element.querySelector(SEL.HEADER);
    return host ? [host] : [];
  }

  globalThis.XAF_SITE = Object.freeze({
    name: 'youtube',
    itemSelector: `${SEL.CARD}, ${SEL.COMMENT}`,
    extract,
    parentText,
    chipHosts,
    loadText,
  });
})();
