// Shows Windows notifications for new trade messages and offers, so they are seen even when
// Chrome is in the background (for example while playing). Several open site tabs report the
// same event; it is shown once.
const recent = new Map();

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== 'd2rbt-notify') return;
  const key = message.key || `${message.title}|${message.body}`;
  const now = Date.now();
  for (const [k, at] of recent) if (now - at > 15000) recent.delete(k);
  if (recent.has(key)) return;
  recent.set(key, now);
  chrome.notifications.create(`d2rbt:${sender.tab?.id ?? ''}:${now}`, {
    type: 'basic',
    iconUrl: 'icon128.png',
    title: message.title || 'D2R Reimagined — trade',
    message: message.body || '',
    priority: 2
  });
});

// Clicking a notification brings the site tab forward and opens the trade window there.
chrome.notifications.onClicked.addListener(async (id) => {
  const tabId = Number(id.split(':')[1]);
  chrome.notifications.clear(id);
  if (!tabId) return;
  try {
    const tab = await chrome.tabs.update(tabId, { active: true });
    if (tab?.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
    chrome.tabs.sendMessage(tabId, { type: 'd2rbt-open-trade' });
  } catch { /* the tab is gone */ }
});
