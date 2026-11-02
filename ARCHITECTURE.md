# Architecture

This document explains how Gmail Passer works and why. [README.md](README.md) covers installation and the behaviour users see.

## Design philosophy

**Copy what the user is looking at.** The open Gmail page is the only data source, and whether a message is expanded is how the user chooses what to copy.

Two alternatives were considered and rejected as too complex for the job:

- **Gmail API:** needs OAuth and a Google Cloud project.
- **Gmail's print view:** would capture the whole thread with one request, but needs an undocumented URL and internal account ID, and would copy messages the user chose not to expand.

The consequence is deliberate: a collapsed message is left out, and this is correct behaviour rather than a gap to fix. Do not add auto-expansion or fetching without revisiting this decision.

The rest of the design follows the same preference for less: no build step, no installed dependencies, no options page and no stored state.

## Components

| File | Runs in | Lifetime | Responsibility |
| --- | --- | --- | --- |
| `background.js` | Non-persistent background page | Wakes for extension events | Registers the menu item and injects scripts on click |
| `turndown.js` | Content-script sandbox in the Gmail tab | Re-run on every click | Defines `TurndownService` |
| `content.js` | Same sandbox | One run per click, inside an async IIFE | All extraction, cleanup, Markdown assembly, clipboard write and on-page messages |

There is no message passing. `background.js` starts the scripts and receives nothing back, which is why it cannot report results to the user and `content.js` shows them itself.

## Main data flow

```text
Right-click → "Copy thread as Markdown"
        │  menus.onClicked (also grants activeTab)
        ▼
background.js: scripting.executeScript(turndown.js, content.js) in the top frame
        ▼
content.js:
  1. Find visible, outermost .a3s elements ── none ──► "No open email to copy"
  2. Read the visible h2.hP subject and set isForwardThread
  3. For each body, in page order:
       a. Read sender, date and recipients from the enclosing .adn
       b. visibleCopy(): clone the body and remove hidden and decorative elements
       c. Turndown: convert the clone to Markdown
       d. stripTrailingQuote(): remove a reply quote from the Markdown
  4. Join with "\n\n---\n\n", after an optional "# subject" line
  5. navigator.clipboard.writeText()
        ├── success ──► "Copied N message(s)"
        └── failure ──► "Copy failed: <reason>"
```

## Key invariants and rules

- **Nothing outside a visible `.a3s` body contributes body text.** Header fields come only from the enclosing `.adn`. This is why attachments, which sit outside the body, are not included.
- **Visibility is read from the live element, never the clone.** A detached clone has no layout. `visibleCopy()` relies on `querySelectorAll("*")` returning the original and clone elements in matching order, and on those lists being static so removals do not shift the indexes. Any change that alters one tree before the walk breaks the mapping.
- **Visibility is `checkVisibility({ checkVisibilityCSS: true })`.** This covers `display`, `visibility` and `content-visibility`. It does not cover scroll position, which is what makes off-screen expanded messages count as visible, and see [Permissions and security considerations](#permissions-and-security-considerations) for what else it misses.
- **Outermost bodies only.** `.a3s` elements nested in another `.a3s` are skipped so content is not emitted twice.
- **Quote stripping works on Markdown lines, not Gmail markup.** One path handles Gmail, plain-text and other mail clients. Line-based matching does not recognise Markdown context, so `>`-prefixed or header-like lines in other contexts are treated the same way.
- **When unsure, keep the quote.** Leaving a repeated quote in costs noise, while removing real content loses information silently. The attributed-quote rule follows this. The Outlook rule cannot fully, and can remove Outlook forwards, as described below.
- **Images never carry a URL.** `![alt](image)` uses a literal placeholder, because Gmail image URLs generally do not work outside the logged-in session.
- **The clipboard is only written on success.** All other paths leave it unchanged.
- **`turndown.js` is not edited.** It is an unmodified copy of `lib/turndown.browser.umd.js` from the `turndown@7.2.0` npm package. Customisation belongs in rules added from `content.js`.

## Gmail integration

Gmail's class names are obfuscated and undocumented. This table lists everything the extension depends on, so it is the first place to look when Gmail changes.

| Selector | Used for | If it stops matching |
| --- | --- | --- |
| `.a3s` | Message body, and whether anything is open | `No open email to copy` on every email |
| `.adn` | Message container | Falls back to the body element, so the sender, date and recipients are lost |
| `.gD` with `name` and `email` attributes | Sender | Sender missing from the `##` line |
| `.g3` with `title` attribute | Date | Date missing from the `##` line |
| `.g2` with `name` and `email` attributes | Recipients | `To:` line omitted |
| `h2.hP` | Subject | `#` line omitted, and `isForwardThread` is false, so Outlook forwards can be stripped |
| `.ajR` | Gmail's "…" trimmed-content button | Its image appears as `![](image)` |
| `img[data-emoji]` | Emoji drawn as images | Emoji appear as `![alt](image)` |

Gmail leaves previous views in the page with `display: none`. The visibility filter on `.a3s` and `h2.hP` is what prevents copying a thread from a hidden view, so these lookups must not drop it. Recipient, sender and date lookups are scoped to the message and are not visibility-filtered.

## Quote stripping rules

`stripTrailingQuote(markdown, isForwardThread)` applies two independent checks, in this order, and returns as soon as one matches.

**1. Outlook-style markers.** Skipped when `isForwardThread` is true, meaning the visible subject matches `/^(fw|fwd):/i`. The first line matching either pattern, anywhere in the message, cuts it and everything after it:

- `-----Original Message-----`, with any run of two or more dashes on each side, case-insensitive, and allowing Turndown's leading `\` escape
- A `From:` line, optionally bold, with `Sent:` or `Date:` and `Subject:` lines within the next 7 lines; these labels are English only

This is an **intentional exception** to the "only at the very end" rule, because these formats have no quote markup that shows where the old email stops. Any text the author wrote below such a marker is lost.

**Forward marker.** If the line directly above a matched `From:` block is a dash-wrapped label starting with a letter (`isForwardMarker`), the message is a Gmail-format forward and is returned whole, skipping rule 2 as well. The check looks for the shape of the line rather than the words "Forwarded message", because Gmail translates them. Only the first match is examined, so `From:` blocks further down inside the forwarded content cannot trigger a cut. A reply that quotes a forward is unaffected, because its marker line starts with `>`.

**2. Attributed trailing quote.**

1. Walk back from the end over blank lines and lines starting with `>` or `\>`. Turndown produces `>` from blockquotes, and `\>` from literal `>` in plain-text mail.
2. Stop if no quoted line was found, or if the line above the quote does not end in `:`.
3. If that line matches `/\d{1,2}[:.]\d{2}|@/`, remove from that line to the end.
4. Otherwise, if the line before it matches, remove from that earlier line. This handles attributions wrapped across two lines.
5. Otherwise keep everything.

The pattern exists to separate attribution lines from ordinary lead-ins without depending on the word "wrote", so it works across languages.

False positives to be aware of:

- `.` is allowed as a time separator, so a lead-in such as "The total was 10.50:" matches.
- A wrapped match does not check the earlier line's content, so "Email ana@example.com\nSee below:" above a final quote is treated as an attribution.

After a cut, `finish()` removes trailing `---` rules, since Outlook's separator can leave one behind.

**Known limit: Outlook forwards can be stripped.** They have no marker line, so the subject check is their only protection. When the thread subject does not match, such as `Re: Fwd: …` or an edited subject, the forwarded content is removed.

`isForwardThread` is a property of the thread, not the message. On a matching thread every message skips rule 1, so Outlook reply quotes stay in. A forward on such a thread also still goes through rule 2, so an attributed quote at the end of the forwarded content is removed; without the `Fw:` or `Fwd:` subject, the forward marker returns the message whole and that quote stays.

## Persistence and state

There is no persistence: no `storage` API, cookies, IndexedDB or files. Each click starts from nothing and reads the page again.

- **Menu item:** created in `runtime.onInstalled` and retained by Firefox. Its listener is registered at the top level of `background.js` so the background page can wake to handle the click.
- **Re-injection:** both scripts run again on every click. `content.js` is wrapped in an IIFE so repeated runs do not hit redeclaration errors. No listeners or observers are left behind; the only thing a run leaves behind is an on-page message for 3 seconds.

## Permissions and security considerations

There is no authentication. The extension reads no tokens or cookies, and relies only on the user being signed in to the page they have open.

| Permission | Why it is needed |
| --- | --- |
| `menus` | The right-click item |
| `activeTab` | Temporary access to the tab, granted by clicking the menu item |
| `scripting` | Injecting the two scripts |
| `clipboardWrite` | Writing the clipboard from an injected script, which does not run inside a page click handler |

There are deliberately no `host_permissions` or declared `content_scripts`. The extension has no code in Gmail until the user clicks, and the `documentUrlPatterns` value of `https://mail.google.com/*` limits where the item appears.

- **Data leaving the browser:** the code makes no `fetch` or XHR calls and sends nothing anywhere. The manifest declares no data collection. Cloning `<img>` elements in the live document can make the browser re-resolve those image URLs, normally from its cache, so "no network activity" should not be claimed in the strictest sense.
- **Page isolation:** scripts run in the content-script sandbox, so Gmail's page scripts cannot see `TurndownService` or the extension's variables.
- **Injected HTML:** Turndown receives a DOM node, not an HTML string, and on-page messages use `textContent`, so email content is not inserted into the page as HTML. `error.message` is rendered the same way.
- **Hidden text is only partly filtered.** The visibility check does not catch `opacity: 0`, white-on-white text, tiny fonts or off-screen positioning. Such text is copied. This matters if output is pasted into an AI tool, because hidden prompt-injection text can get through.
- **Output is not structurally safe.** Turndown escapes body text, but the subject and names are inserted raw. A body can contain its own headings and `---` rules, so the output cannot be reliably parsed back into messages.
- **Clipboard exposure:** clipboard managers and history features may keep copied mail. The extension cannot prevent this.

## Failure handling and edge cases

| Situation | Behaviour |
| --- | --- |
| No visible body | Message shown, clipboard unchanged |
| `writeText()` rejects | `Copy failed: <reason>`, clipboard unchanged |
| Exception before the clipboard step, such as in Turndown | **Not caught.** The async IIFE rejects with no on-page message. It only appears in the console |
| `executeScript()` rejects | **Not caught.** There is no on-page message. It appears in the extension's console, opened with **Inspect** in `about:debugging` |
| No sender or date found | A bare `## ` heading is emitted |
| Message consisting only of a stripped quote | Header with an empty body |
| Image not loaded yet, with no size attributes | `el.width` can be 0, so it is treated as a tracking pixel and dropped |
| Rapid repeat clicks | Each run shows its own message in the same position, so they overlap for up to 3 seconds |
| Multiple Gmail accounts, Workspace accounts | No account-specific code; any `mail.google.com` page is handled the same way |
| Right-click inside a frame not on `mail.google.com` | `documentUrlPatterns` does not match, so the item does not appear |
| Non-English Gmail interface | Detection uses classes and attributes, not interface text. Only Outlook labels are English-specific |

`executeScript` targets only the top frame, regardless of which frame was right-clicked.

## Performance and scalability

There is no measured performance data and no optimisation has been needed so far.

- All work runs synchronously on Gmail's main thread, apart from the clipboard call. Cost grows with the number of elements in visible bodies, because each element gets a visibility check and the body is cloned for `visibleCopy()` and again inside Turndown.
- Injecting on click means the extension costs nothing while unused, at the price of re-evaluating the 27 KB Turndown file on each click.
- Output size is limited by what Gmail renders. The extension has no size limit of its own.

## Testing and maintenance

**The repository has no automated tests.** Real emails make poor committed test data, and the main risk is changes to Gmail's live markup, which fixtures would not catch. Any saved email samples should stay out of version control.

The extension has been confirmed working through manual use in Firefox on Gmail, and `npx web-ext lint` reports no problems. No minimum Firefox version is declared and no version range has been tested. The code needs at least Manifest V3 support (Firefox 109) and `checkVisibility` (Firefox 106).

After changes, check these by hand:

- Single message, and a long thread with some messages collapsed
- Inbox view (expects `No open email to copy`)
- Split-pane view, and navigating between threads to confirm hidden views are not copied
- Gmail reply, plain-text reply and Outlook reply
- Quote with text after it, and answers written between quoted lines
- Gmail forward with and without a `Fwd:` subject, and Outlook forward with an `FW:` subject
- HTML newsletter with images and tracking pixels
- Non-English Gmail interface

**When Gmail changes:** use the [selector table](#gmail-integration), inspect the affected element in Gmail, and update the selector in `content.js`.

**Updating Turndown:** copy `lib/turndown.browser.umd.js` from the new npm package over `turndown.js`, then update the version in this document and the README. The file does not state its own version. Check the `\>`, `\-` and `*` handling in `stripTrailingQuote`, because those patterns depend on how Turndown escapes text and formats output.

## Not implemented

Ideas only; none of this exists in the code:

- Listing attachment names
- Separate `To:` and `Cc:` lines
- Markdown tables through Turndown's GFM plugin, which would need a way to tell data tables from layout tables
- Non-English Outlook header labels
- Filtering `opacity: 0` and similar hidden text
- On-page messages for uncaught errors
- Packaging and signing automation
