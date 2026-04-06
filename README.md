# xthread

A Microsoft Edge browser extension that extracts X/Twitter threads into a single readable text.

## What it does

Navigate to any tweet that is part of a thread, click the extension icon, and xthread will:

- Scroll the page automatically to load all tweets in the thread
- Filter tweets by the thread author (ignoring replies from others)
- Expand truncated tweets ("Show more" / "Mehr anzeigen") automatically
- Detect `xx/yy` numbering markers used by the author and preserve them
- Output the full thread as clean plain text with a header (author, tweet count, date, source URL)
- Let you copy to clipboard or download as a `.txt` file

## Installation (Developer Mode)

1. Clone or download this repository
2. Open Edge and navigate to `edge://extensions/`
3. Enable **Developer mode** (toggle in the top right)
4. Click **Load unpacked** and select the `xthread` folder
5. The extension icon appears in the toolbar

> **Note:** On managed/enterprise machines, group policy may block unpacked extensions.
> The `ExtensionInstallBlocklist` registry key must not contain `*` for developer mode to work.

## Usage

1. Open a tweet permalink on `x.com` (URL must match `x.com/<handle>/status/<id>`)
2. Click the **xthread** toolbar icon
3. The extension scrolls the page, collects all thread tweets, and displays the result
4. Click **Copy** to copy to clipboard, or **Save** to download as a `.txt` file
5. Click **Clear** to reset the output

## Output format

```
Thread by @AuthorHandle · 25 tweets · 2025-11-14
https://x.com/AuthorHandle/status/123456789

[1/25]
First tweet text here.

[2/25]
Second tweet text here.

Third tweet without a number marker — no label shown.
```

Tweets without `xx/yy` markers are included without a label. Media attachments are noted as `[image]` or `[video]`.

## File structure

```
xthread/
  manifest.json          — Manifest V3 extension definition
  background.js          — Service worker stub
  content/
    content.js           — DOM extraction engine (injected into x.com)
  popup/
    popup.html           — Extension popup UI
    popup.css            — Popup styles
    popup.js             — Popup orchestration and clipboard/download logic
```

## Technical notes

- No X/Twitter API required — reads the already-rendered DOM
- X uses a virtualized list; the extractor scrolls in viewport steps and harvests tweets before they are removed from the DOM
- Uses stable `data-testid` attributes to locate tweet elements
- Quoted tweets (nested articles) are detected and skipped to avoid content bleed
- Zero Width Space characters (U+200B) are stripped from output

## Limitations

- Only captures tweets visible during the scroll pass; very long threads (100+) may need the page to fully load before clicking
- Protected/private accounts require you to be logged in
- Relies on X.com DOM structure — may break if X changes their markup significantly

## License

MIT
