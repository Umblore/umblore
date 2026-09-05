# Umblore

A small Chrome extension for keeping a quote or claim tied to where it came from — while you're still on the page, not after you've lost track of the tab.

Highlight something, right-click, and it saves the text along with the source URL and a timestamp. No account, no library to set up first, nothing leaves your machine.

![Umblore side panel showing four saved claims with tags and export buttons](docs/screenshot.png)

## Why

Research and reporting both involve the same failure: you read something worth keeping across a dozen-plus tabs, and by the time you're writing it up, you can't remember which tab it came from. Read-later tools solve "read this later." Reference managers solve "cite this properly." Neither one is built for the narrower, faster thing this does: grab the line, keep the source, move on.

## What it does

- **Highlight → right-click → save.** Captures the selected text, the page URL, the page title, and the time.
- **Optional full-page snapshot.** A second menu option also saves an offline `.mhtml` copy of the page, in case the source changes or disappears later.
- **Tag and filter.** Add a free-text topic to any saved claim, then filter the list by tag.
- **Notes.** Attach a short note to a claim — why it matters, what to check next.
- **Search.** Filter everything by keyword.
- **Export.** Pull the whole set out as Markdown (grouped by topic, source and timestamp under each quote) or raw JSON.

Everything lives in the browser's local storage. There's no server and no sync — this is a personal capture tool, not a team platform.

## What it deliberately doesn't do

- No persistent in-page annotation (the highlight doesn't stay visible on the page itself when you revisit it — it's pulled into a separate list instead).
- No cross-device sync.
- No PDF support — regular web pages only, for now.
- Snapshot capture is manual per-claim, not automatic for every page, on purpose — this is meant to stay lightweight rather than capture everything indiscriminately.

## Install (unpacked, for now)

This isn't on the Chrome Web Store yet.

1. Clone or download this repo.
2. Go to `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the `umblore` folder.
5. Pin it from the puzzle-piece icon in the toolbar.

## Use it

1. Highlight a sentence on any page.
2. Right-click → **Save claim to Umblore**, or **Save claim + page snapshot** if you want an offline copy too.
3. Click the toolbar icon to open the side panel and see what you've saved.
4. Tag it, add a note if useful, and search or filter as the list grows.
5. Export to Markdown when you're ready to write.

## Status

Early, personal-use MVP. Built to solve one specific problem for one specific workflow, not yet validated as something other people want in this exact form. Feedback — especially "this doesn't do X and it should," or "I wouldn't use this because Y" — is genuinely useful right now.

## License

MIT — see [LICENSE](LICENSE).
