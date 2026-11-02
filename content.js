(async () => {
  const isVisible = (el) => el.checkVisibility({ checkVisibilityCSS: true });

  const turndown = new TurndownService({
    headingStyle: "atx",
    hr: "---",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
  });
  // Gmail image URLs need a login to load, so "image" stands in for the file.
  // Gmail draws emoji as images; those stay as the emoji character.
  turndown.addRule("imagePlaceholder", {
    filter: "img",
    replacement: (_content, node) =>
      node.getAttribute("data-emoji") ||
      `![${node.getAttribute("alt") || ""}](image)`,
  });

  // Tracking pixels and Gmail's own "…" button aren't part of the email.
  const isDecoration = (el) =>
    el.matches(".ajR") ||
    (el.tagName === "IMG" && (el.width <= 1 || el.height <= 1));

  // Copy the body without anything the user can't see. A detached copy has no
  // layout to check, so visibility is read from the original element by element.
  function visibleCopy(body) {
    const copy = body.cloneNode(true);
    const originals = body.querySelectorAll("*");
    const copies = copy.querySelectorAll("*");
    originals.forEach((el, i) => {
      if (!isVisible(el) || isDecoration(el)) copies[i].remove();
    });
    return copy;
  }

  const finish = (lines) =>
    lines.join("\n").replace(/(\s*\n---\s*)+$/, "").trimEnd();

  const isOutlookHeader = (lines, i) => {
    if (!/^\*{0,2}From:/.test(lines[i])) return false;
    const next = lines.slice(i + 1, i + 8);
    return (
      next.some((line) => /^\*{0,2}(Sent|Date):/.test(line)) &&
      next.some((line) => /^\*{0,2}Subject:/.test(line))
    );
  };

  // A real attribution ends in ":" and names a time or an email address, e.g.
  // "On Mon, 2 Nov 2026 at 10:14, Ana <ana@example.com> wrote:". This is what
  // separates a reply quote from "Here are the numbers:" above a body quote.
  const hasTimeOrEmail = (line) => /\d{1,2}[:.]\d{2}|@/.test(line);

  // Removes only the previous email quoted at the very end of a reply. Quotes
  // with the author's own text after them, and forwards, are left in place.
  function stripTrailingQuote(markdown, isForwardThread) {
    const lines = markdown.split("\n");

    // Outlook has no quote markup, only a separator or header block. Its
    // forwards look identical, so this is skipped on forwarded threads.
    if (!isForwardThread) {
      const start = lines.findIndex(
        (line, i) =>
          /^\\?-{2,}\s*Original Message\s*-{2,}/i.test(line) ||
          isOutlookHeader(lines, i),
      );
      if (start !== -1) return finish(lines.slice(0, start));
    }

    let end = lines.length;
    while (end > 0 && /^\s*(\\?>.*)?$/.test(lines[end - 1])) end--;
    const hasQuote = lines.slice(end).some((line) => /^\s*\\?>/.test(line));
    if (!hasQuote || end === 0 || !lines[end - 1].trimEnd().endsWith(":")) {
      return markdown;
    }

    // Plain-text mail can wrap the attribution onto a second line.
    if (hasTimeOrEmail(lines[end - 1])) return finish(lines.slice(0, end - 1));
    if (end > 1 && hasTimeOrEmail(lines[end - 2])) {
      return finish(lines.slice(0, end - 2));
    }
    return markdown;
  }

  function person(el) {
    const name = el.getAttribute("name") || el.textContent.trim();
    const email = el.getAttribute("email");
    return email ? `${name} <${email}>` : name;
  }

  function messageToMarkdown(body) {
    const message = body.closest(".adn") || body;
    const sender = message.querySelector(".gD");
    const date = message.querySelector(".g3");
    const recipients = [...message.querySelectorAll(".g2")].map(person);

    const lines = [
      `## ${[sender && person(sender), date && date.title].filter(Boolean).join(" — ")}`,
    ];
    if (recipients.length) lines.push(`To: ${recipients.join(", ")}`);

    const text = stripTrailingQuote(
      turndown.turndown(visibleCopy(body)),
      isForwardThread,
    );
    return `${lines.join("\n")}\n\n${text}`;
  }

  function showToast(text) {
    const toast = document.createElement("div");
    toast.textContent = text;
    toast.style.cssText =
      "position:fixed;bottom:24px;left:24px;z-index:2147483647;padding:10px 14px;" +
      "border-radius:6px;background:#202124;color:#fff;font:14px sans-serif;";
    document.body.append(toast);
    setTimeout(() => toast.remove(), 3000);
  }

  // Collapsed messages and Gmail's hidden views fail the visibility check.
  const bodies = [...document.querySelectorAll(".a3s")].filter(
    (el) => isVisible(el) && !el.parentElement.closest(".a3s"),
  );
  if (!bodies.length) {
    showToast("No open email to copy");
    return;
  }

  const subject = [...document.querySelectorAll("h2.hP")].find(isVisible);
  const subjectText = subject ? subject.textContent.trim() : "";
  const isForwardThread = /^(fw|fwd):/i.test(subjectText);
  const title = subjectText ? `# ${subjectText}\n\n` : "";
  const markdown = title + bodies.map(messageToMarkdown).join("\n\n---\n\n");

  try {
    await navigator.clipboard.writeText(markdown);
    showToast(`Copied ${bodies.length} message${bodies.length === 1 ? "" : "s"}`);
  } catch (error) {
    showToast(`Copy failed: ${error.message}`);
  }
})();
