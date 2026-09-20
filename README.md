# Slop Filter

A Chrome extension that hides AI-generated posts. It works on X and LinkedIn today. Reddit and YouTube are next.

## What it does

- Scores every post in your feed for how likely it is to be AI-written.
- Collapses the ones over your threshold. One click shows a post again.
- Animated mode lets you watch it work: a scan line runs over each post, then the post turns green and stays, or turns red and folds away.
- Can be tuned to your own judgment. Mark posts as `AI` or `Human`, then fit the weights from your labels.

## How it does it

1. It reads the text of each post as it nears your screen.
2. It asks [TypeSafe Jev](https://docs.typesafe.ai) about 17 narrow yes/no and rating questions about the text. Examples: does it use the "it's not X, it's Y" frame, does it open with praise, how generic is it, how much personal voice does it have.
3. Jev answers each question with a probability. It writes no text and gives no opinions.
4. The extension combines the answers into one score with weights. A small script fits those weights from the posts you labeled.
5. Posts under 8 words are left alone. There is too little to judge.

You bring your own TypeSafe API key. It stays in your browser. Post text is sent to TypeSafe for scoring and nowhere else. 1,000 posts cost about 4 cents.

## Install

Paste this into Claude Code, Codex, or any coding agent:

```text
Install the Slop Filter Chrome extension for me.

1. Clone https://github.com/adamnroman/slop-filter into ~/slop-filter.
   If that folder already exists, run `git pull` in it instead.
2. If Node 20 or newer is installed, run `node --test` in the folder and
   tell me if anything fails. If Node is missing, skip this step.
3. Chrome does not let a script install an extension, so walk me through
   the rest one step at a time. Wait for me to confirm each step:
   a. Open chrome://extensions in Chrome.
   b. Turn on "Developer mode" in the top right.
   c. Click "Load unpacked" and pick the ~/slop-filter folder.
      Print the full path so I can paste it.
   d. On the Slop Filter card, click Details, then "Extension options".
   e. Paste my TypeSafe API key and click Save. If I do not have a key,
      send me to https://console.typesafe.ai/keys to create one.
   f. Open x.com or linkedin.com and scroll. Every post of 8 or more words should get
      a small "AI 12%" line under it.
4. Never ask me to paste my API key into this chat. It goes only into
   the extension's options page.
5. Do not change any files in the repo.
```

Or do it by hand: clone this repo, open `chrome://extensions`, turn on Developer mode, click Load unpacked, pick the folder. Then open the extension's options and paste your [TypeSafe API key](https://console.typesafe.ai/keys).

## Tune it and contribute

[docs/development.md](docs/development.md) covers how to fit the weights from your labels, add a question for a tell you noticed, and what to know before changing the code.
