# D2R Reimagined Trade Helper (Chrome and Firefox extension)

Makes trading on d2r-reimagined.com comfortable: list many items at once, see what is already
in trade, check market prices, and manage your listings, offers and chats in one window with
sound and Windows notifications. The interface is in **English** by default; switch to Russian
with the **EN | RU** toggle in either window. (Русская инструкция — в README.ru.md.)

## Install

### Chrome

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose this project folder (the one with `manifest.json`).
4. Open https://www.d2r-reimagined.com/trade and sign in on the site if you have not yet.

### Firefox

1. Open `about:debugging#/runtime/this-firefox` in Firefox.
2. Click **Load Temporary Add-on…**.
3. Select `firefox/manifest.json` inside this project folder.
4. Open https://www.d2r-reimagined.com/trade and sign in on the site if you have not yet.

Firefox temporary add-ons are removed when Firefox closes. To keep the extension installed
permanently, it needs to be packaged and signed by Mozilla before installation.

After an update, reload the extension from the browser's extensions page and refresh the site tab.

## Bulk listing (the "☰ Bulk listing" button, bottom left on Trade pages)

- Shows every item from your synced characters (equipped, inventory, charm inventory, stash,
  cube, mercenary) and the shared stash — the same items the site's "List an item" page sees.
- **▦ Inventory** view: grids like in the game. Click an item to select it; the right side lists
  the selected items with a price and a note for each. **☰ List** view: one table of everything,
  with sorting (newest first, name, quality, ilvl, location).
- Hover an item for a game-style tooltip with its stats. Search works on names **and stats**
  (`life`, `skill`, `resist`…).
- **IN TRADE** (green) marks items you have already listed, **PENDING** (yellow) — an accepted
  offer awaiting the trade. **⇄ Sync with trade** reloads items and listings and reports how many
  listings were found in your inventory and which were not (those are probably sold). The panel
  also syncs every time you open it.
- **NEW** (blue) marks items that appeared since you last opened the panel. The game save has
  no pick-up time, so the extension remembers when it first saw each item.
- **Right-click an item** (or press 🔍) to see **market prices**: other active listings of the same
  item on the same ladder, game and side, with prices, sellers and stats. Your own listings are
  highlighted.
- Set "Price for all" / "Note for all", or per item. An empty price lists the item without a price
  (buyers make offers); the confirmation dialog says how many such items there are.
- **List N** asks for confirmation, then posts the listings one by one with a pause, showing a
  status for each (✓ with a link, or ✗ with the server's error). **Stop** halts the queue.

## Trade window (the "💬 Trade" button, bottom left on every site page)

- **📋 My listings** — filter by status, search, edit the price inline, Cancel / ✓ Trade done /
  Relist, cancel several at once, 🔍 market prices. **⇄ Sync with inventory** shows where each
  listed item is now; "⚠ missing" means it is no longer in your synced saves.
- **💰 Offers** — all offers on your listings in one place: Accept (the site reserves the item for
  the buyer and declines the other offers), Decline, open the chat.
- **💬 Chats** — conversations on the left, messages on the right; Enter sends, Shift+Enter makes a
  new line; quick English replies; accept an offer right from the chat.
- **Sound and notifications** — a chime and a Windows notification on every new message or offer,
  even with Chrome minimized; click the notification to jump to the chat. Toggle sound and
  notifications, set the volume, and test them in the window header. Works while at least one site
  tab is open (it can be minimized). Browsers allow sound only after one click on the page.

## Light on resources

- On a normal site page the extension makes three small requests (who you are, your listings,
  your chats) after the page has loaded, then relies on the site's own live connection; a backup
  check runs every 3 minutes while that connection is up (every 40 s if it is down), from one tab.
- Offers per listing are loaded only when you open the Offers tab; a listing's item data is fetched
  once and remembered in this browser.
- The bulk panel reuses the inventory it loaded in the last 3 minutes; press ⇄ Sync for fresh data.
- Search redraws after you stop typing; the sound engine runs only while a chime plays.

## How it works

Everything runs inside the site's own page and uses your site login (the token the site keeps in
the browser); nothing is sent anywhere else. It calls the same API the site uses
(`https://api.d2r-reimagined.com`): `/trades/inventory`, `/trades/mine`, `/trades` (list, search,
create), `/trades/{id}` (update), offers and conversations. Live events come from the site's own
WebSocket; a light check every 40 seconds catches anything missed. Item names, stats and required
levels follow the site's open-source rules (github.com/D2R-Reimagined/d2r-reimagined-website).

## Troubleshooting

- "You are not signed in" — sign in on d2r-reimagined.com and open the panel again.
- Empty item list — your characters/stash are not synced to the server (the site's "List an item"
  page is empty too).
- A listed item has no IN TRADE mark — press ⇄ Sync with trade; the result line names listings that
  were not found (the item is not in your synced saves, or it belongs to another ladder).
- An error on one item is shown in its status; the other items keep going. If the site changes its
  API, the extension needs an update.
