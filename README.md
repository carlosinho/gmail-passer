# Gmail Passer

A Firefox extension that copies the Gmail thread you have open to the clipboard as Markdown. Right-click anywhere in Gmail and choose **Copy thread as Markdown**.

## Why it exists

Gmail has no "copy as Markdown" option, and selecting a thread by hand brings along interface text and repeated quotes. This extension copies what you are reading with its structure intact: subject, sender, date, recipients, formatting and links.

It reads the page that is already open. There is no Gmail API, Google Cloud project, OAuth login, account or server.

## How it works for you

1. Open a thread in Gmail and expand the messages you want.
2. Right-click anywhere on the page and choose **Copy thread as Markdown**.
3. Wait for the message at the bottom left of the page, then paste.

Gmail shows its own menu when you right-click rows in the inbox list. Shift+right-click opens the Firefox menu there, although the extension still needs an open email to copy.

### On-screen messages

| Message | Meaning | Clipboard |
| --- | --- | --- |
| `Copied N message(s)` | N expanded messages were copied. | Replaced |
| `No open email to copy` | No expanded message body is visible. This is expected in the inbox or when every message is collapsed. On an open email, it means Gmail's markup has changed. | Unchanged |
| `Copy failed: <reason>` | The conversion worked, but the browser refused the clipboard write. | Unchanged |

If you pick the menu item and no message appears, an unexpected error occurred. See [failure handling](ARCHITECTURE.md#failure-handling-and-edge-cases).

## What gets copied

The rule is simple: if you can see it in the thread, it is copied. A message that is expanded but scrolled off screen still counts as visible.

| Content | Result |
| --- | --- |
| Expanded messages | Included, in page order |
| Collapsed messages | Left out, including their sender and preview line |
| Text hidden with CSS (`display: none`, `visibility: hidden`) | Left out |
| Quoted text Gmail has collapsed behind "…" | Left out |
| Previous email quoted at the end of a reply | Removed, even if you expanded "…" |
| A quote with your own text after it, such as answers written between quoted lines | Kept |
| A quote at the end with an ordinary lead-in, such as "Here are the numbers:" | Kept |
| Forwarded messages | Kept, with an Outlook exception; see [Known limits](#known-limits) |
| Signatures | Kept |
| Images | `![alt text](image)`, or `![](image)` without alt text; `image` is a literal placeholder and the real URL is not kept |
| Emoji that Gmail draws as images | The emoji character |
| Tracking pixels (images rendered 1px or smaller) | Left out |
| Links | Kept, with their full URL |
| Attachments | Not listed |
| Tables | Text is kept, but not the table layout |

### Output format

```markdown
# Quarterly report

## Ana Silva <ana@example.com> — 2 Nov 2026, 10:14
To: Carlos <carlos@example.com>

Hello **team**, see [this](https://example.com).

![chart](image)

-   one
-   two

---

## Carlos <carlos@example.com> — 2 Nov 2026, 11:02

Thanks
```

The date is whatever Gmail shows in that field's tooltip, so its format follows your Gmail settings. To and Cc recipients share one `To:` line, built from the recipients Gmail shows in the message header.

### Known limits

- **Outlook-style replies:** these are recognised by `-----Original Message-----` or by English `From:` / `Sent:` or `Date:` / `Subject:` labels. Other languages, such as German `Von:`, stay in. When one is found, everything after it is removed, including any text you wrote below it.
- **Outlook forwards:** they look the same as Outlook replies and have no marker line, so they are only kept when the thread subject starts with `Fw:` or `Fwd:`. With any other subject, including `Re: Fwd:`, the forwarded content is removed. On a `Fw:` or `Fwd:` thread, Outlook-style reply quotes stay in. Forwards with Gmail's `---------- Forwarded message` line are kept whatever the subject.
- **"On … wrote:" detection:** the line above the quote must end in `:` and contain a time-like number or an `@`. Otherwise the quote stays in. A body quote whose lead-in fits this pattern is removed by mistake, for example "Contact ana@example.com:".
- **Quote followed by a signature:** the quote is no longer at the end of the message, so it stays in.
- **Very long messages:** Gmail clips these and only shows part of them, so only that part is copied until you open the full message in Gmail.
- **Gmail updates:** the extension depends on Gmail's undocumented class names, so a Gmail change can break it without warning.

## Tech stack

- Firefox WebExtension, Manifest V3, in plain JavaScript with no build step and no runtime dependencies to install
- [Turndown](https://github.com/mixmark-io/turndown) 7.2.0 for HTML to Markdown, vendored as `turndown.js` (MIT)

The code uses Firefox-specific extension features (`browser.*`, `menus`, and `background.scripts` in Manifest V3). It has not been built for Chrome or other browsers.

## Install

There is nothing to compile or configure, and no environment variables. You only need Firefox.

1. Go to `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on**.
3. Select `manifest.json` from this folder.

A temporary add-on is removed when Firefox restarts, so repeat these steps after each restart. After changing the code, click **Reload** on the extension's card in the same page.

### Keeping it installed

The repository has no packaging or signing set up yet, and these routes have not been tried with this project.

- **Signed, for release Firefox:** sign it through Mozilla as an unlisted add-on. This uploads the code, but no mail, and needs a free AMO account with API credentials. The manifest already includes the add-on ID and data-collection declaration that signing expects.

  ```sh
  npx web-ext sign --channel=unlisted --api-key="$WEB_EXT_API_KEY" --api-secret="$WEB_EXT_API_SECRET"
  ```

- **Unsigned, for Developer Edition or Nightly:** set `xpinstall.signatures.required` to `false` in `about:config`, build a package with `npx web-ext build`, and install the resulting file through `about:addons`.

Both commands use `web-ext`, which is only needed for this step and is not a project dependency.

## Project structure

```text
manifest.json   Extension metadata, permissions and icon
background.js   Registers the menu item and injects the scripts on click
content.js      Reads the page, builds the Markdown and writes to the clipboard
turndown.js     Vendored Turndown library, not edited
passer.png      Extension icon (256×256)
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for design rules, data flow and how to fix it when Gmail changes.
