const MENU_ID = "copy-thread-as-markdown";

browser.runtime.onInstalled.addListener(() => {
  browser.menus.create({
    id: MENU_ID,
    title: "Copy thread as Markdown",
    contexts: ["all"],
    documentUrlPatterns: ["https://mail.google.com/*"],
  });
});

browser.menus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  browser.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["turndown.js", "content.js"],
  });
});
