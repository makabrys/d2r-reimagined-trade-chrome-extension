// D2R Reimagined — trade window: my listings, offers, chats, sound and desktop notifications.
// Uses the helpers content.js shares on window.__d2rBT and the site's own API:
// /trades/mine, /trades/{id}/offers, /trades/offers/{id}/accept|decline, PATCH /trades/{id},
// /trades/conversations, /trades/conversations/{id}, /trades/conversations/{id}/messages.
// Live events come from the site's own WebSocket through ws-hook.js; a light poll every
// 40 seconds catches anything missed.
(() => {
  if (window.__d2rTradeWindow) return;
  window.__d2rTradeWindow = true;
  const B = window.__d2rBT;
  if (!B) return;
  const { api, h, loadData, describe, tipParts, moveTip, QUALITY_COLORS, TOKEN_KEY } = B;
  const I18N = window.__d2rI18n;
  const t = I18N ? I18N.t : (key) => key;

  const PREFS_KEY = 'd2r_bt_trade_prefs';
  const SOUND_LOCK = 'd2r_bt_sound_lock';
  const POLL_LOCK = 'd2r_bt_poll_lock';
  const POLL_MS = 40000;

  const STATUS = {
    Active: ['st_Active', '#3fcf5a'], Reserved: ['st_Reserved', '#f0c060'], Completed: ['st_Completed', '#9aa'],
    Cancelled: ['st_Cancelled', '#c08080'], Expired: ['st_Expired', '#c08080']
  };
  const OFFER_STATUS = { Pending: ['of_Pending', '#f0c060'], Accepted: ['of_Accepted', '#3fcf5a'], Declined: ['of_Declined', '#c08080'], Withdrawn: ['of_Withdrawn', '#9aa'] };
  const QUICK_REPLIES = ['Hi! Still available.', 'Deal. What is your in-game name?', 'Sorry, already sold.', 'Can you add a bit more?'];

  const prefs = (() => {
    const defaults = { sound: true, desktop: true, volume: 0.6, seenOfferSum: null };
    try { return { ...defaults, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') }; } catch { return defaults; }
  })();
  const savePrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* ignore */ } };

  const S = {
    open: false,
    tab: 'listings',
    me: null,
    listings: [],
    listingsLoaded: false,
    listFilter: 'Active',
    listSearch: '',
    missingOnly: false,
    selected: new Set(),
    priceDrafts: new Map(),
    inv: null, // Map(signature -> where)
    invLoading: false,
    offers: new Map(), // listingId -> offers
    offersLoading: false,
    offersKnown: false,
    offerFilter: 'Pending',
    offerListing: null,
    convs: [],
    convSearch: '',
    activeConvId: null,
    activeConv: null,
    drafts: new Map(),
    sending: false,
    busy: false,
    error: '',
    notice: '',
    baseline: { unread: null, offerSum: null },
    lastEventAt: 0,
    lastSent: { id: null, at: 0 },
    infoCache: new Map()
  };

  // ---------- Helpers ----------

  function parseUtc(value) {
    if (!value) return null;
    return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value}Z`);
  }

  function ago(value) {
    const date = parseUtc(value);
    if (!date || Number.isNaN(date.getTime())) return '';
    const s = Math.max(0, (Date.now() - date.getTime()) / 1000);
    if (s < 60) return t('justNow');
    if (s < 3600) return t('minAgo', Math.floor(s / 60));
    if (s < 86400) return t('hAgo', Math.floor(s / 3600));
    if (s < 86400 * 7) return t('dAgo', Math.floor(s / 86400));
    return date.toLocaleDateString(I18N?.locale() || 'en-GB', { day: 'numeric', month: 'short' });
  }

  function listingItem(listing) {
    if (!listing?.itemData) return null;
    try { return JSON.parse(listing.itemData); } catch { return null; }
  }

  function listingInfo(listing) {
    if (S.infoCache.has(listing.id)) return S.infoCache.get(listing.id);
    const item = listingItem(listing);
    let info = null;
    if (item) { try { info = describe(item); } catch { info = null; } }
    const value = { item, info };
    // Names and stats need the site's data files; cache only once they are in.
    if (dataReady && item) S.infoCache.set(listing.id, value);
    return value;
  }

  function signature(item) {
    return `${String(item?.codeText || '').toLowerCase()}:${item?.seed}`;
  }

  function errText(error) {
    return error?.message || String(error);
  }

  let dataReady = false;
  function ensureData() {
    return loadData().then(() => { if (!dataReady) { dataReady = true; S.infoCache.clear(); if (S.open) renderBody(); } }).catch(() => {});
  }

  const loggedIn = () => Boolean(localStorage.getItem(TOKEN_KEY));
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // ---------- Sound and notifications ----------

  let audio = null;
  function audioContext() {
    if (!audio) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      audio = new Ctx();
    }
    return audio;
  }
  // The audio engine is created only to play a chime and suspended right after, so it does not
  // keep running in the background. (Chrome allows it once the page has had any click.)
  let audioIdleTimer = null;
  function idleAudioSoon() {
    clearTimeout(audioIdleTimer);
    audioIdleTimer = setTimeout(() => { if (audio && audio.state === 'running') audio.suspend().catch(() => {}); }, 1500);
  }

  async function chime(kind) {
    const ctx = audioContext();
    if (!ctx) return;
    // Wake the engine first: notes scheduled on a sleeping engine would be silent.
    if (ctx.state !== 'running') {
      try { await ctx.resume(); } catch { return; }
      if (ctx.state !== 'running') return;
    }
    const notes = kind === 'offer' ? [659, 880, 1175] : [880, 1319];
    const start = ctx.currentTime + 0.02;
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t0 = start + i * 0.14;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.001, prefs.volume * 0.5), t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.45);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.5);
    });
    idleAudioSoon();
  }

  // Several site tabs may be open; only one of them plays the sound for the same event.
  function claim(lockKey, key, windowMs) {
    try {
      const last = JSON.parse(localStorage.getItem(lockKey) || 'null');
      if (last && last.key === key && Date.now() - last.at < windowMs) return false;
      localStorage.setItem(lockKey, JSON.stringify({ key, at: Date.now() }));
    } catch { /* ignore */ }
    return true;
  }

  function notify({ key, kind, title, body, open }) {
    if (!claim(SOUND_LOCK, key, 15000)) return;
    if (prefs.sound) chime(kind);
    if (prefs.desktop) {
      try { chrome.runtime.sendMessage({ type: 'd2rbt-notify', key, title, body }); } catch { /* extension reloaded */ }
    }
    showToast(title, body, open);
  }

  // ---------- Data loading ----------

  async function ensureMe() {
    if (!S.me && loggedIn()) S.me = await api('/users/me').catch(() => null);
    return S.me;
  }

  async function loadListings() {
    const mine = await api('/trades/mine');
    S.listings = Array.isArray(mine) ? mine : mine?.items ?? [];
    // Items already seen in this browser are filled in for free; missing ones are fetched only
    // when a tab that shows them is open (see ensureListingItems).
    B.applyCachedItemData(S.listings);
    S.listingsLoaded = true;
    const offerSum = S.listings.reduce((sum, l) => sum + (l.offerCount || 0), 0);
    S.baseline.offerSum = offerSum;
    if (prefs.seenOfferSum === null || prefs.seenOfferSum > offerSum) { prefs.seenOfferSum = offerSum; savePrefs(); }
  }

  async function ensureListingItems() {
    const open = S.listings.filter((l) => l.status === 'Active' || l.status === 'Reserved');
    if (!open.some((l) => !l.itemData)) return;
    await B.withItemData(open).catch(() => {});
    if (S.open && S.tab !== 'chats') renderBody();
  }

  async function loadConvs() {
    S.convs = await api('/trades/conversations');
    S.baseline.unread = S.convs.reduce((sum, c) => sum + (c.unreadCount || 0), 0);
  }

  async function loadOffers(listingIds) {
    const ids = [...listingIds];
    let next = 0;
    const worker = async () => {
      while (next < ids.length) {
        const id = ids[next++];
        try { S.offers.set(id, await api(`/trades/${encodeURIComponent(id)}/offers`)); } catch { /* keep old */ }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
  }

  function offerListingIds() {
    return S.listings.filter((l) => (l.offerCount || 0) > 0 && (l.status === 'Active' || l.status === 'Reserved')).map((l) => l.id);
  }

  async function loadAllOffers() {
    S.offersLoading = true;
    renderBody();
    try {
      if (!S.listingsLoaded) await loadListings();
      await loadOffers(offerListingIds());
      S.offersKnown = true;
      ensureListingItems();
    } catch (error) { S.error = errText(error); }
    S.offersLoading = false;
    prefs.seenOfferSum = S.baseline.offerSum;
    savePrefs();
    render();
  }

  async function loadInventory() {
    S.invLoading = true;
    renderBody();
    try {
      const ladders = [...new Set(S.listings.filter((l) => l.status === 'Active' || l.status === 'Reserved').map((l) => l.ladderId || ''))];
      const entries = [];
      for (const ladderId of ladders.length ? ladders : ['']) {
        const inv = await api(`/trades/inventory${ladderId ? `?ladderId=${encodeURIComponent(ladderId)}` : ''}`);
        for (const entry of inv.characters ?? []) {
          const name = entry.character?.name || '';
          for (const it of entry.save?.items?.entries ?? []) entries.push({ item: it, where: () => name || t('character') });
          for (const it of entry.save?.mercenaryItems?.entries ?? []) entries.push({ item: it, where: () => t('whereMerc', name || t('character')) });
        }
        for (const stash of inv.sharedStashes ?? []) {
          (stash.tabs ?? []).forEach((tab, i) => { for (const it of tab.items ?? []) entries.push({ item: it, where: () => t('whereTab', i + 1) }); });
        }
      }
      // listing id -> where the item is now (same matching as the bulk panel: seed, else attributes)
      const open = S.listings.filter((l) => l.status === 'Active' || l.status === 'Reserved');
      await B.withItemData(open).catch(() => {});
      const { matches } = B.matchListings(open, entries);
      const map = new Map();
      for (const [entry, listing] of matches) map.set(listing.id, entry.where);
      S.inv = map;
    } catch (error) { S.error = errText(error); }
    S.invLoading = false;
    renderBody();
  }

  // The "sync" button: fresh listings, then where each listed item is now.
  async function syncWithInventory() {
    if (S.invLoading) return;
    S.invLoading = true;
    renderBody();
    try {
      await ensureData();
      await loadListings();
    } catch (error) { S.error = errText(error); }
    S.invLoading = false;
    await loadInventory();
    if (S.inv) {
      const open = S.listings.filter((l) => l.status === 'Active' || l.status === 'Reserved');
      const missing = open.filter((l) => !S.inv.has(l.id)).length;
      S.notice = t('tSynced', open.length, open.length - missing) + (missing ? t('tSyncedMissing', missing) : '.');
      renderErrors();
    }
  }

  async function openConversation(id) {
    S.activeConvId = id;
    S.tab = 'chats';
    render();
    try {
      S.activeConv = await api(`/trades/conversations/${encodeURIComponent(id)}`);
      await loadConvs();
    } catch (error) { S.error = errText(error); }
    render();
    scrollMessages();
  }

  async function refreshAll() {
    if (!loggedIn()) { S.error = t('notSignedInWin'); render(); return; }
    S.error = '';
    S.busy = true;
    render();
    try {
      await ensureData();
      await ensureMe();
      await Promise.all([loadListings(), loadConvs()]);
      if (S.tab === 'offers') await loadOffers(offerListingIds());
      if (S.activeConvId) S.activeConv = await api(`/trades/conversations/${encodeURIComponent(S.activeConvId)}`).catch(() => S.activeConv);
    } catch (error) { S.error = errText(error); }
    S.busy = false;
    render();
    updateBadge();
  }

  // ---------- Actions ----------

  async function setStatus(listing, status, ask = true) {
    const label = STATUS[status] ? t(STATUS[status][0]) : status;
    if (ask && !window.confirm(t('confirmStatus', listing.itemName, label))) return false;
    try {
      const updated = await api(`/trades/${encodeURIComponent(listing.id)}`, { method: 'PATCH', body: JSON.stringify({ status }) });
      Object.assign(listing, updated || { status });
      S.notice = t('statusSet', listing.itemName, label);
      return true;
    } catch (error) {
      S.error = t('itemErr', listing.itemName, errText(error));
      return false;
    } finally { renderBody(); }
  }

  async function savePrice(listing) {
    const price = (S.priceDrafts.get(listing.id) ?? '').trim();
    try {
      const updated = await api(`/trades/${encodeURIComponent(listing.id)}`, { method: 'PATCH', body: JSON.stringify({ price }) });
      Object.assign(listing, updated || { price: price || null });
      S.priceDrafts.delete(listing.id);
      S.notice = t('priceSaved', listing.itemName);
    } catch (error) { S.error = t('itemErr', listing.itemName, errText(error)); }
    renderBody();
  }

  async function cancelSelected() {
    const rows = S.listings.filter((l) => S.selected.has(l.id) && l.status === 'Active');
    if (!rows.length) return;
    if (!window.confirm(t('confirmCancelMany', rows.length, rows.slice(0, 20).map((l) => `• ${l.itemName}`).join('\n')))) return;
    S.busy = true;
    renderBody();
    for (const listing of rows) {
      await setStatus(listing, 'Cancelled', false);
      S.selected.delete(listing.id);
      await sleep(400);
    }
    S.busy = false;
    renderBody();
  }

  async function answerOffer(offer, accept) {
    const listing = S.listings.find((l) => l.id === offer.tradeListingId);
    const name = listing?.itemName || t('item');
    const question = accept
      ? t('confirmAccept', offer.buyerDisplayName, name, offer.offerText)
      : t('confirmDecline', offer.buyerDisplayName, name, offer.offerText);
    if (!window.confirm(question)) return;
    try {
      const updated = await api(`/trades/offers/${encodeURIComponent(offer.id)}/${accept ? 'accept' : 'decline'}`, { method: 'POST' });
      const list = S.offers.get(offer.tradeListingId) ?? [];
      S.offers.set(offer.tradeListingId, list.map((o) => o.id === offer.id ? (updated || { ...o, status: accept ? 'Accepted' : 'Declined' })
        : (accept && o.status === 'Pending' ? { ...o, status: 'Declined' } : o)));
      S.notice = accept ? t('accepted', offer.buyerDisplayName, name) : t('declined', offer.buyerDisplayName);
      if (accept) { await loadListings().catch(() => {}); if (updated?.conversationId) { await openConversation(updated.conversationId); return; } }
    } catch (error) { S.error = errText(error); }
    render();
  }

  async function sendMessage() {
    const id = S.activeConvId;
    const body = (S.drafts.get(id) || '').trim();
    if (!id || !body || S.sending) return;
    S.sending = true;
    try {
      S.lastSent = { id, at: Date.now() };
      const sent = await api(`/trades/conversations/${encodeURIComponent(id)}/messages`, { method: 'POST', body: JSON.stringify({ body }) });
      if (S.activeConv?.id === id && sent && !S.activeConv.messages.some((m) => m.id === sent.id)) S.activeConv.messages.push(sent);
      S.drafts.delete(id);
      if (ui.composer) ui.composer.value = '';
      await loadConvs().catch(() => {});
    } catch (error) { S.error = errText(error); }
    S.sending = false;
    renderConvList();
    renderMessages();
    renderErrors();
    scrollMessages();
  }

  // ---------- Live events ----------

  const EVENT_TYPES = new Set(['offer_created', 'offer_updated', 'offer_accepted', 'message_created', 'listing_updated', 'listing_deleted']);

  window.addEventListener('message', (event) => {
    if (event.source === window && event.data?.__d2rbt === 'trade-socket') { S.socketOpen = event.data.state === 'open'; return; }
    if (event.source !== window || event.data?.__d2rbt !== 'trade-event') return;
    let ev;
    try { ev = JSON.parse(event.data.data); } catch { return; }
    if (!ev || !EVENT_TYPES.has(ev.type)) return;
    handleEvent(ev);
  });

  async function handleEvent(ev) {
    S.lastEventAt = Date.now();
    const ownEcho = ev.type === 'message_created' && ev.conversationId === S.lastSent.id && Date.now() - S.lastSent.at < 5000;
    const viewing = S.open && S.tab === 'chats' && S.activeConvId && ev.conversationId === S.activeConvId && document.visibilityState === 'visible';
    if (!ownEcho && ev.senderDisplayName && (ev.type === 'message_created' || ev.type === 'offer_created' || ev.type === 'offer_updated')) {
      const isOffer = ev.type !== 'message_created';
      if (!viewing || isOffer) {
        notify({
          key: ev.eventId || `${ev.type}:${ev.conversationId}:${ev.preview}`,
          kind: isOffer ? 'offer' : 'message',
          title: t(isOffer ? 'newOfferFrom' : 'newMsgFrom', ev.senderDisplayName),
          body: `${ev.itemName || ''}${ev.preview ? `: ${ev.preview}` : ''}`,
          open: isOffer ? () => openTab('offers') : () => openConversation(ev.conversationId)
        });
      }
    }
    try {
      await loadConvs();
      if (ev.tradeListingId && ev.type !== 'message_created') {
        await loadListings();
        S.infoCache.delete(ev.tradeListingId);
        if (ev.type.startsWith('offer')) await loadOffers([ev.tradeListingId]);
      }
      if (S.activeConvId && ev.conversationId === S.activeConvId) {
        S.activeConv = await api(`/trades/conversations/${encodeURIComponent(S.activeConvId)}`);
      }
    } catch { /* the poll will catch up */ }
    updateBadge();
    if (S.open) {
      if (S.tab === 'chats') { renderConvList(); renderMessages(); scrollMessages(); renderTabs(); }
      else renderBody();
    }
  }

  // Backup for anything the socket missed: every 40 s while the site's live connection is down,
  // every 3 minutes while it is up. One site tab does it for all of them.
  function pollInterval() { return S.socketOpen ? 180000 : POLL_MS; }
  function maybePoll() {
    if (Date.now() - (S.lastPollAt || 0) < pollInterval()) return;
    S.lastPollAt = Date.now();
    poll();
  }

  async function poll() {
    if (!loggedIn() || !claim(POLL_LOCK, 'poll', pollInterval() - 5000)) return;
    const before = { ...S.baseline };
    try {
      await Promise.all([loadConvs(), loadListings()]);
    } catch { return; }
    const quiet = Date.now() - S.lastEventAt > pollInterval() + 10000;
    if (quiet && before.unread !== null && S.baseline.unread > before.unread) {
      const conv = [...S.convs].sort((a, b) => (parseUtc(b.lastMessageAtUtc) || 0) - (parseUtc(a.lastMessageAtUtc) || 0)).find((c) => c.unreadCount > 0);
      notify({ key: `poll-msg:${S.baseline.unread}:${conv?.id}`, kind: 'message',
        title: conv ? t('newMsgFrom', conv.otherUserDisplayName) : t('newMsg'), body: conv ? `${conv.itemName}: ${conv.lastMessage || ''}` : '',
        open: conv ? () => openConversation(conv.id) : () => openTab('chats') });
    }
    // Offers per listing are loaded only once the Offers tab has been opened.
    if (S.offersKnown && before.offerSum !== null && S.baseline.offerSum !== before.offerSum) await loadOffers(offerListingIds()).catch(() => {});
    if (quiet && before.offerSum !== null && S.baseline.offerSum > before.offerSum) {
      notify({ key: `poll-offer:${S.baseline.offerSum}`, kind: 'offer', title: t('newOffer'), body: t('openOffersTab'), open: () => openTab('offers') });
    }
    updateBadge();
    if (S.open && S.tab !== 'chats') renderBody();
    else if (S.open) { renderConvList(); renderTabs(); }
  }

  // ---------- UI ----------

  const CSS = B.CSS + `
    .fab.trade { background: #2c4a7a; display: inline-flex; align-items: center; gap: 8px; }
    .fab.trade:hover { background: #3a5d96; }
    .badge { background: #e03c31; color: #fff; border-radius: 999px; font-size: 12px; padding: 1px 7px; min-width: 20px; text-align: center; }
    .tabs { display: flex; gap: 4px; margin-right: auto; flex-wrap: wrap; }
    .tabs button { background: transparent; border-color: transparent; font-size: 14px; padding: 7px 12px; }
    .tabs button.on { background: #2a2622; border-color: #4a433b; color: #f0b070; }
    .tabs .badge { margin-left: 6px; }
    .chips { display: flex; gap: 4px; flex-wrap: wrap; }
    .chips button { border-radius: 999px; padding: 4px 11px; font-size: 12px; }
    .chips button.on { background: #b4561c; border-color: #b4561c; }
    .st-chip { display: inline-block; border: 1px solid currentColor; border-radius: 4px; font-size: 11px; padding: 0 6px; white-space: nowrap; }
    .notice { background: #16301b; color: #a8e8b0; padding: 8px 14px; border-bottom: 1px solid #24502c; }
    .price-cell { display: flex; gap: 4px; align-items: center; }
    .price-cell input { min-width: 90px; width: 100%; }
    .inv-ok { color: #7ee08a; font-size: 12px; } .inv-miss { color: #ffb050; font-size: 12px; }
    .acts { display: flex; gap: 4px; flex-wrap: wrap; }
    .acts button, .acts a { font-size: 12px; padding: 4px 8px; }
    a.btn { color: #eee; text-decoration: none; border: 1px solid #4a433b; border-radius: 5px; background: #2a2622; }
    .offer { border: 1px solid #2c2925; border-radius: 6px; padding: 10px 12px; margin: 0 14px 8px; background: #17161a; display: flex; gap: 12px; align-items: flex-start; }
    .offer.pending { border-color: #6a5420; background: #1d1a12; }
    .offer .txt { font-size: 15px; color: #fff; margin: 4px 0; white-space: pre-wrap; word-break: break-word; }
    .offer .body { flex: 1; min-width: 0; }
    .chat { flex: 1; display: flex; min-height: 0; }
    .convs { width: 320px; border-right: 1px solid #2c2925; overflow: auto; }
    .conv { padding: 9px 12px; border-bottom: 1px solid #222; cursor: pointer; }
    .conv:hover { background: #1e1c20; }
    .conv.on { background: #2a2018; }
    .conv .top { display: flex; gap: 6px; align-items: center; }
    .conv .who { font-weight: 600; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .conv .last { color: #9a9282; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .conv.unread .who, .conv.unread .last { color: #fff; }
    .pane { flex: 1; display: flex; flex-direction: column; min-width: 0; }
    .pane-head { padding: 10px 14px; border-bottom: 1px solid #2c2925; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
    .msgs { flex: 1; overflow: auto; padding: 12px 14px; display: flex; flex-direction: column; gap: 6px; }
    .msg { max-width: 72%; padding: 7px 10px; border-radius: 8px; background: #23222a; white-space: pre-wrap; word-break: break-word; }
    .msg.mine { align-self: flex-end; background: #5a3216; }
    .msg .when { font-size: 11px; color: #9a9282; margin-top: 2px; }
    .composer { border-top: 1px solid #2c2925; padding: 10px 14px; display: flex; flex-direction: column; gap: 6px; }
    .composer textarea { width: 100%; min-height: 54px; resize: vertical; }
    .quick { display: flex; gap: 4px; flex-wrap: wrap; }
    .quick button { font-size: 12px; padding: 3px 8px; }
    .toast { position: fixed; left: 18px; bottom: 120px; z-index: 2147483647; max-width: 360px; background: #1b2436; color: #e8eefc;
      border: 1px solid #3a5d96; border-radius: 8px; padding: 10px 12px; box-shadow: 0 6px 24px rgba(0,0,0,.6); cursor: pointer; font-size: 13px; }
    .toast b { display: block; margin-bottom: 3px; color: #9cc0ff; }
    .mini-offer { border: 1px solid #6a5420; border-radius: 6px; padding: 6px 8px; background: #1d1a12; display: flex; gap: 8px; align-items: center; }
    .prefs { display: flex; gap: 10px; align-items: center; }
  `;

  let host = null;
  let root = null;
  const ui = {};

  function ensureHost() {
    if (host && document.body.contains(host)) return;
    host = document.createElement('div');
    host.id = 'd2r-trade-window';
    root = host.attachShadow({ mode: 'open' });
    root.append(h('style', {}, CSS));
    ui.badge = h('span', { class: 'badge', style: 'display:none' }, '0');
    ui.fabLabel = document.createTextNode(t('fabTrade'));
    ui.fab = h('button', { class: 'fab trade', onclick: () => openTab(S.tab) }, ui.fabLabel, ui.badge);
    ui.overlay = h('div', { class: 'overlay', style: 'display:none', onclick: (e) => { if (e.target === ui.overlay) closeWindow(); } });
    ui.toastBox = h('div');
    root.append(ui.fab, ui.overlay, ui.toastBox);
    document.body.append(host);
    syncFab();
  }

  function syncFab() {
    if (!ui.fab) return;
    ui.fab.style.display = S.open || !loggedIn() ? 'none' : '';
    // The bulk-listing button sits at the bottom on /trade pages; this one goes above it there.
    ui.fab.style.bottom = location.pathname.startsWith('/trade') ? '66px' : '18px';
  }

  function pendingOffers() {
    let n = 0;
    for (const [listingId, offers] of S.offers) {
      const listing = S.listings.find((l) => l.id === listingId);
      if (listing?.status === 'Active') n += offers.filter((o) => o.status === 'Pending').length;
    }
    return n;
  }

  function badgeCount() {
    const unread = S.baseline.unread || 0;
    const offers = S.offersKnown ? pendingOffers()
      : Math.max(0, (S.baseline.offerSum || 0) - (prefs.seenOfferSum ?? S.baseline.offerSum ?? 0));
    return { unread, offers, total: unread + offers };
  }

  function updateBadge() {
    if (!ui.badge) return;
    const { total } = badgeCount();
    ui.badge.textContent = String(total);
    ui.badge.style.display = total ? '' : 'none';
    renderTabs();
  }

  function showToast(title, body, open) {
    if (!ui.toastBox) return;
    const toast = h('div', { class: 'toast', onclick: () => { toast.remove(); if (open) open(); } }, h('b', {}, title), body);
    ui.toastBox.replaceChildren(toast);
    setTimeout(() => toast.remove(), 9000);
  }

  function openTab(tab) {
    S.open = true;
    S.tab = tab;
    ui.overlay.style.display = '';
    syncFab();
    render();
    ensureData();
    // The listings tab checks where each listed item is the first time it opens.
    const checkInventory = () => {
      if (S.tab !== 'listings' || S.invLoading) return;
      if (S.pendingSync) { S.pendingSync = false; syncWithInventory(); } else if (!S.inv) loadInventory();
    };
    if (!S.listingsLoaded) refreshAll().then(() => { if (S.tab === 'offers') loadAllOffers(); checkInventory(); });
    else if (tab === 'offers') loadAllOffers();
    else if (tab === 'listings') { checkInventory(); ensureListingItems(); }
    else if (tab === 'chats') loadConvs().then(() => { renderConvList(); renderTabs(); }).catch(() => {});
  }

  function closeWindow() {
    S.open = false;
    ui.overlay.style.display = 'none';
    hideTip();
    syncFab();
  }

  // Keep typing safe: a background refresh does not rebuild the part the user is typing in.
  function typingIn(el) {
    const active = root?.activeElement;
    return Boolean(active && el && el.contains(active) && /^(INPUT|TEXTAREA)$/.test(active.tagName));
  }

  function render() {
    if (!root) return;
    const { unread, offers } = badgeCount();
    ui.tabs = h('div', { class: 'tabs' });
    ui.err = h('div');
    ui.body = h('div', { class: 'main', style: 'flex-direction:column' });
    const panel = h('div', { class: 'panel' },
      h('header', {},
        ui.tabs,
        h('span', { class: 'prefs' },
          I18N ? I18N.switcher() : null,
          h('label', { title: t('soundHint') },
            h('input', { type: 'checkbox', checked: prefs.sound, onchange: (e) => { prefs.sound = e.target.checked; savePrefs(); } }), t('sound')),
          h('input', { type: 'range', min: '0.05', max: '1', step: '0.05', value: prefs.volume, title: t('volume'), style: 'width:70px',
            onchange: (e) => { prefs.volume = Number(e.target.value); savePrefs(); chime('message'); } }),
          h('label', { title: t('desktopHint') },
            h('input', { type: 'checkbox', checked: prefs.desktop, onchange: (e) => { prefs.desktop = e.target.checked; savePrefs(); } }), t('desktop')),
          h('button', { onclick: () => { chime('offer'); try { chrome.runtime.sendMessage({ type: 'd2rbt-notify', key: `test:${Date.now()}`, title: t('testTitle'), body: t('testBody') }); } catch { /* ignore */ } } }, t('test'))),
        h('button', { disabled: S.busy, onclick: refreshAll }, S.busy ? t('loadingShort') : '↻'),
        h('button', { class: 'close', title: t('close'), onclick: closeWindow }, '×')),
      ui.err,
      ui.body);
    ui.tip = h('div', { class: 'tip' });
    ui.overlay.replaceChildren(panel, ui.tip);
    renderTabs(unread, offers);
    renderErrors();
    renderBody();
  }

  function renderTabs() {
    if (!ui.tabs) return;
    const { unread, offers } = badgeCount();
    const active = S.listings.filter((l) => l.status === 'Active').length;
    const tab = (id, label, badge) => h('button', { class: S.tab === id ? 'on' : '', onclick: () => openTab(id) }, label,
      badge ? h('span', { class: 'badge' }, String(badge)) : null);
    ui.tabs.replaceChildren(
      tab('listings', t('tabListings', S.listingsLoaded ? ` (${active})` : '')),
      tab('offers', t('tabOffers'), offers),
      tab('chats', t('tabChats'), unread));
  }

  function renderErrors() {
    if (!ui.err) return;
    ui.err.replaceChildren(...[
      S.error ? h('div', { class: 'err', onclick: () => { S.error = ''; renderErrors(); } }, `${S.error}  ✕`) : null,
      S.notice ? h('div', { class: 'notice', onclick: () => { S.notice = ''; renderErrors(); } }, `${S.notice}  ✕`) : null].filter(Boolean));
  }

  function renderBody() {
    if (!ui.body || !S.open) return;
    renderErrors();
    renderTabs();
    if (S.tab === 'chats') { renderChats(); return; }
    if (typingIn(ui.body)) return;
    if (S.tab === 'offers') renderOffers();
    else renderListings();
  }

  // ---------- Tooltip ----------

  function hideTip() { if (ui.tip) ui.tip.style.display = 'none'; }

  function withTip(el, info, item, extra) {
    if (!info || !item) return el;
    el.addEventListener('mouseenter', (e) => {
      const parts = tipParts(info, item);
      if (extra) parts.push(h('div', { class: 'loc' }, extra));
      ui.tip.replaceChildren(...parts);
      ui.tip.style.display = 'block';
      moveTip(e, ui.tip);
    });
    el.addEventListener('mousemove', (e) => moveTip(e, ui.tip));
    el.addEventListener('mouseleave', hideTip);
    return el;
  }

  function itemName(listing, info) {
    return h('span', { class: 'name', style: `color:${QUALITY_COLORS[info?.quality || listing.itemQuality] || '#ddd'}` }, listing.itemName);
  }

  function statusChip(status, map = STATUS) {
    const [key, color] = map[status] || [null, '#aaa'];
    return h('span', { class: 'st-chip', style: `color:${color}` }, key ? t(key) : status);
  }

  // ---------- Tab: my listings ----------

  function renderListings() {
    const filters = ['Active', 'Reserved', 'Completed', 'Cancelled', 'All'].map((id) => [id, t(`f_${id}`)]);
    const count = (st) => st === 'All' ? S.listings.length : S.listings.filter((l) => l.status === st || (st === 'Cancelled' && l.status === 'Expired')).length;
    const words = S.listSearch.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const rows = S.listings.filter((l) => {
      if (S.listFilter !== 'All' && l.status !== S.listFilter && !(S.listFilter === 'Cancelled' && l.status === 'Expired')) return false;
      if (S.missingOnly && S.inv && (S.inv.has(l.id) || (l.status !== 'Active' && l.status !== 'Reserved'))) return false;
      if (words.length) {
        const info = listingInfo(l).info;
        const text = `${l.itemName} ${l.title} ${l.price || ''} ${info?.search || ''}`.toLowerCase();
        if (!words.every((w) => text.includes(w))) return false;
      }
      return true;
    }).sort((a, b) => (parseUtc(b.createdAtUtc) || 0) - (parseUtc(a.createdAtUtc) || 0));

    const missing = S.inv ? S.listings.filter((l) => (l.status === 'Active' || l.status === 'Reserved') && !S.inv.has(l.id)).length : 0;
    const bar = h('div', { class: 'bar' },
      h('div', { class: 'chips' }, filters.map(([id, label]) => h('button', { class: S.listFilter === id ? 'on' : '',
        onclick: () => { S.listFilter = id; renderBody(); } }, `${label} (${count(id)})`))),
      h('input', { type: 'text', class: 'grow', placeholder: t('listSearchPh'), value: S.listSearch,
        oninput: (e) => { S.listSearch = e.target.value; clearTimeout(ui.searchTimer); ui.searchTimer = setTimeout(() => { const pos = e.target.selectionStart; renderListingsKeepFocus(pos); }, 250); } }),
      h('button', { class: 'primary', disabled: S.invLoading || S.busy, title: t('invSyncTitle'), onclick: syncWithInventory },
        S.invLoading ? t('syncing') : t('invSyncBtn')),
      S.inv ? h('label', { title: t('missingHint') },
        h('input', { type: 'checkbox', checked: S.missingOnly, onchange: (e) => { S.missingOnly = e.target.checked; renderBody(); } }), t('missingOnly', missing)) : null);

    let content;
    if (!S.listingsLoaded) content = h('div', { class: 'empty' }, S.busy ? t('loadingDots') : t('noData'));
    else if (!rows.length) content = h('div', { class: 'empty' }, t('noListings'));
    else {
      content = h('table', {},
        h('thead', {}, h('tr', {},
          h('th', {}, h('input', { type: 'checkbox', title: t('selectAllActive'), onchange: (e) => {
            for (const l of rows) if (l.status === 'Active') { if (e.target.checked) S.selected.add(l.id); else S.selected.delete(l.id); }
            renderBody(); } })),
          h('th', {}, ''), h('th', {}, t('colItem', rows.length)), h('th', {}, t('colPrice')), h('th', {}, t('colOffers')),
          h('th', {}, t('colStatus')), S.inv ? h('th', {}, t('colInInv')) : null, h('th', {}, ''))),
        h('tbody', {}, rows.map(listingRow)));
    }
    const selectedActive = S.listings.filter((l) => S.selected.has(l.id) && l.status === 'Active').length;
    const foot = h('footer', {},
      h('span', { class: 'count' }, selectedActive ? t('selectedN', selectedActive) : t('tSelectHint')),
      h('a', { class: 'btn', href: '/trade/list', style: 'padding:6px 11px' }, t('listMore')),
      h('button', { disabled: !selectedActive || S.busy, onclick: cancelSelected }, t('cancelSelected', selectedActive ? ` (${selectedActive})` : '')));
    const list = h('div', { class: 'list' }, content);
    const scroll = ui.listScroll ?? 0;
    ui.body.replaceChildren(bar, list, foot);
    list.scrollTop = scroll;
    list.addEventListener('scroll', () => { ui.listScroll = list.scrollTop; });
  }

  function renderListingsKeepFocus(pos) {
    renderListings();
    const input = ui.body.querySelector('.bar input[type=text]');
    if (input) { input.focus(); try { input.setSelectionRange(pos, pos); } catch { /* ignore */ } }
  }

  function listingRow(l) {
    const { item, info } = listingInfo(l);
    const editable = l.status !== 'Reserved' && l.status !== 'Completed';
    const draft = S.priceDrafts.get(l.id);
    const priceValue = draft ?? l.price ?? '';
    const changed = draft !== undefined && draft.trim() !== (l.price ?? '');
    const where = S.inv ? S.inv.get(l.id) : undefined;
    const offersN = l.offerCount || 0;
    const actions = [];
    if (l.status === 'Active') actions.push(h('button', { onclick: () => setStatus(l, 'Cancelled') }, t('aCancel')));
    if (l.status === 'Reserved') {
      actions.push(h('button', { onclick: () => setStatus(l, 'Completed') }, t('aDone')));
      actions.push(h('button', { onclick: () => setStatus(l, 'Active') }, t('aRelist')));
    }
    if (l.status === 'Cancelled' || l.status === 'Expired') actions.push(h('button', { onclick: () => setStatus(l, 'Active') }, t('aRelist')));
    actions.push(h('button', { title: t('pcBtn'), onclick: () => B.openPriceCheck(root, {
      name: l.itemName, quality: l.itemQuality, ladderId: l.ladderId, ladderName: l.ladderName,
      gameMode: l.gameMode, isHardcore: l.isHardcore, ownListingId: l.id, tip: ui.tip
    }) }, '🔍'));
    actions.push(h('a', { class: 'btn', href: `/trade/${l.id}`, target: '_blank', title: t('openOnSite') }, '↗'));
    return h('tr', { class: S.selected.has(l.id) ? 'sel' : '' },
      h('td', {}, h('input', { type: 'checkbox', checked: S.selected.has(l.id), disabled: l.status !== 'Active',
        onchange: (e) => { if (e.target.checked) S.selected.add(l.id); else S.selected.delete(l.id); renderBody(); } })),
      h('td', {}, info?.sprite ? h('img', { class: 'img', src: `/data/${info.sprite}`, alt: '', loading: 'lazy' }) : ''),
      withTip(h('td', {}, itemName(l, info),
        h('div', { class: 'meta' }, [l.itemQuality, l.ladderName || 'non-ladder', t('listedAgo', ago(l.createdAtUtc))].filter(Boolean).join(' · ')),
        info?.lines?.length ? h('div', { class: 'meta', style: 'color:#8080ff' }, info.lines.slice(0, 3).map((x) => x.text).join(' · ') + (info.lines.length > 3 ? ' …' : '')) : null),
      info, item),
      h('td', {}, editable
        ? h('div', { class: 'price-cell' },
          h('input', { type: 'text', maxlength: '500', value: priceValue, placeholder: t('noPrice'),
            oninput: (e) => { S.priceDrafts.set(l.id, e.target.value); const btn = e.target.nextSibling; if (btn) btn.style.visibility = e.target.value.trim() !== (l.price ?? '') ? 'visible' : 'hidden'; },
            onkeydown: (e) => { if (e.key === 'Enter') savePrice(l); } }),
          h('button', { title: t('savePrice'), style: `visibility:${changed ? 'visible' : 'hidden'}`, onclick: () => savePrice(l) }, '💾'))
        : h('span', {}, l.price || '—')),
      h('td', {}, offersN ? h('button', { title: t('showOffers'), onclick: () => { S.offerListing = l.id; S.offerFilter = 'All'; openTab('offers'); } }, String(offersN)) : h('span', { class: 'meta' }, '0')),
      h('td', {}, statusChip(l.status), l.buyerDisplayName ? h('div', { class: 'meta' }, t('buyer', l.buyerDisplayName)) : null),
      S.inv ? h('td', {}, where ? h('span', { class: 'inv-ok' }, `✓ ${where()}`)
        : (l.status === 'Active' || l.status === 'Reserved')
          ? h('span', { class: 'inv-miss', title: t('notInInvTitle') }, t('notInInv'))
          : h('span', { class: 'meta' }, '—')) : null,
      h('td', {}, h('div', { class: 'acts' }, actions)));
  }

  // ---------- Tab: offers ----------

  function renderOffers() {
    const all = [];
    for (const [listingId, offers] of S.offers) {
      const listing = S.listings.find((l) => l.id === listingId);
      if (!listing) continue;
      for (const offer of offers) all.push({ offer, listing });
    }
    const pending = all.filter((x) => x.offer.status === 'Pending').length;
    const shown = all.filter((x) => (S.offerFilter === 'All' || x.offer.status === 'Pending') && (!S.offerListing || x.listing.id === S.offerListing))
      .sort((a, b) => (a.offer.status === 'Pending' ? 0 : 1) - (b.offer.status === 'Pending' ? 0 : 1)
        || (parseUtc(b.offer.createdAtUtc) || 0) - (parseUtc(a.offer.createdAtUtc) || 0));
    const filterListing = S.offerListing ? S.listings.find((l) => l.id === S.offerListing) : null;
    const bar = h('div', { class: 'bar' },
      h('div', { class: 'chips' },
        h('button', { class: S.offerFilter === 'Pending' ? 'on' : '', onclick: () => { S.offerFilter = 'Pending'; renderBody(); } }, t('ofNew', pending)),
        h('button', { class: S.offerFilter === 'All' ? 'on' : '', onclick: () => { S.offerFilter = 'All'; renderBody(); } }, t('ofAll', all.length))),
      filterListing ? h('button', { onclick: () => { S.offerListing = null; renderBody(); } }, t('onlyListing', filterListing.itemName)) : null,
      h('span', { class: 'hint' }, t('offersHint')));
    let content;
    if (S.offersLoading && !all.length) content = h('div', { class: 'empty' }, t('offersLoading'));
    else if (!shown.length) content = h('div', { class: 'empty' }, S.offerFilter === 'Pending' ? t('noNewOffers') : t('noOffers'));
    else content = h('div', { style: 'padding-top:10px' }, shown.map(({ offer, listing }) => offerCard(offer, listing)));
    const list = h('div', { class: 'list' }, content);
    ui.body.replaceChildren(bar, list);
  }

  function offerCard(offer, listing) {
    const { item, info } = listingInfo(listing);
    const isPending = offer.status === 'Pending' && listing.status === 'Active';
    return h('div', { class: `offer ${offer.status === 'Pending' ? 'pending' : ''}` },
      info?.sprite ? withTip(h('img', { class: 'img', src: `/data/${info.sprite}`, alt: '' }), info, item) : '',
      h('div', { class: 'body' },
        h('div', {}, withTip(itemName(listing, info), info, item), h('span', { class: 'meta' }, t('yourPrice', listing.price || t('noPrice')))),
        h('div', { class: 'meta' }, `${offer.buyerDisplayName} · ${ago(offer.createdAtUtc)} · `, statusChip(offer.status, OFFER_STATUS)),
        h('div', { class: 'txt' }, offer.offerText)),
      h('div', { class: 'acts', style: 'flex-direction:column' },
        isPending ? h('button', { class: 'primary', onclick: () => answerOffer(offer, true) }, t('accept')) : null,
        isPending ? h('button', { onclick: () => answerOffer(offer, false) }, t('decline')) : null,
        offer.conversationId ? h('button', { onclick: () => openConversation(offer.conversationId) }, t('chat')) : null));
  }

  // ---------- Tab: chats ----------

  function renderChats() {
    // The chat layout is built once per visit; refreshes update its parts.
    if (!ui.chat || !ui.body.contains(ui.chat)) {
      ui.convList = h('div');
      ui.convSearch = h('input', { type: 'text', placeholder: t('chatSearchPh'), value: S.convSearch, style: 'width:100%',
        oninput: (e) => { S.convSearch = e.target.value; renderConvList(); } });
      ui.pane = h('div', { class: 'pane' });
      ui.chat = h('div', { class: 'chat' },
        h('div', { class: 'convs' }, h('div', { style: 'padding:8px 10px;border-bottom:1px solid #2c2925' }, ui.convSearch), ui.convList),
        ui.pane);
      ui.body.replaceChildren(ui.chat);
      ui.paneConvId = undefined;
    }
    renderConvList();
    renderPane();
  }

  function renderConvList() {
    if (!ui.convList) return;
    const words = S.convSearch.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const convs = [...S.convs]
      .filter((c) => !words.length || words.every((w) => `${c.otherUserDisplayName} ${c.itemName} ${c.lastMessage || ''}`.toLowerCase().includes(w)))
      .sort((a, b) => (parseUtc(b.lastMessageAtUtc || b.createdAtUtc) || 0) - (parseUtc(a.lastMessageAtUtc || a.createdAtUtc) || 0));
    ui.convList.replaceChildren(...(convs.length ? convs.map((c) => h('div', {
      class: `conv ${c.id === S.activeConvId ? 'on' : ''} ${c.unreadCount ? 'unread' : ''}`,
      onclick: () => openConversation(c.id)
    },
    h('div', { class: 'top' }, h('span', { class: 'who' }, c.otherUserDisplayName),
      c.isAcceptedTrade ? h('span', { class: 'tag listed' }, t('dealTag')) : null,
      c.unreadCount ? h('span', { class: 'badge' }, String(c.unreadCount)) : null),
    h('div', { class: 'meta' }, `${c.itemName} · ${ago(c.lastMessageAtUtc || c.createdAtUtc)}`),
    h('div', { class: 'last' }, c.lastMessage || '—'))) : [h('div', { class: 'empty' }, t('noChats'))]));
  }

  function renderPane() {
    if (!ui.pane) return;
    if (ui.paneConvId === S.activeConvId && ui.msgs) { renderMessages(); return; }
    ui.paneConvId = S.activeConvId;
    if (!S.activeConvId) {
      ui.msgs = null;
      ui.pane.replaceChildren(h('div', { class: 'empty' }, t('pickChat')));
      return;
    }
    ui.paneHead = h('div', { class: 'pane-head' });
    ui.msgs = h('div', { class: 'msgs' });
    ui.composer = h('textarea', { maxlength: '2000', placeholder: t('composerPh'), value: S.drafts.get(S.activeConvId) || '',
      oninput: (e) => S.drafts.set(S.activeConvId, e.target.value),
      onkeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } } });
    ui.pane.replaceChildren(ui.paneHead, ui.msgs,
      h('div', { class: 'composer' },
        h('div', { class: 'quick' }, QUICK_REPLIES.map((text) => h('button', { title: t('insertHint'), onclick: () => {
          ui.composer.value = ui.composer.value ? `${ui.composer.value} ${text}` : text;
          S.drafts.set(S.activeConvId, ui.composer.value);
          ui.composer.focus();
        } }, text))),
        ui.composer,
        h('div', { style: 'display:flex;justify-content:flex-end' }, h('button', { class: 'primary', onclick: sendMessage }, t('send')))));
    renderMessages();
    scrollMessages();
  }

  function renderMessages() {
    if (!ui.msgs || !ui.paneHead) return;
    const conv = S.activeConv && S.activeConv.id === S.activeConvId ? S.activeConv : null;
    if (!conv) { ui.msgs.replaceChildren(h('div', { class: 'empty' }, t('loadingDots'))); return; }
    const meId = S.me?.id;
    const other = meId === conv.sellerId ? conv.buyerDisplayName : conv.sellerDisplayName;
    const listing = conv.listing;
    const { item, info } = listing ? listingInfo(listing) : {};
    const iAmSeller = meId && meId === conv.sellerId;
    ui.paneHead.replaceChildren(...[
      h('div', { style: 'flex:1;min-width:0' },
        h('div', { style: 'font-weight:600;font-size:15px' }, other || t('partner')),
        listing ? h('div', { class: 'meta' }, withTip(itemName(listing, info), info, item), `  · ${listing.price || t('noPrice')} · `, statusChip(listing.status),
          iAmSeller ? t('youSell') : t('youBuy')) : null),
      listing && iAmSeller && listing.status === 'Reserved' ? h('button', { onclick: async () => { if (await setStatus(listing, 'Completed')) openConversation(conv.id); } }, t('aDone')) : null,
      listing ? h('a', { class: 'btn', href: `/trade/${listing.id}`, target: '_blank', style: 'padding:5px 9px' }, t('listingLink')) : null].filter(Boolean));
    const pendingOffers = (conv.offers || []).filter((o) => o.status === 'Pending');
    const nodes = [];
    if (iAmSeller && pendingOffers.length && listing?.status === 'Active') {
      for (const offer of pendingOffers) {
        nodes.push(h('div', { class: 'mini-offer' }, h('span', { style: 'flex:1' }, t('offerLine', offer.offerText)),
          h('button', { class: 'primary', onclick: () => answerOffer({ ...offer, tradeListingId: listing.id }, true) }, t('accept')),
          h('button', { onclick: () => answerOffer({ ...offer, tradeListingId: listing.id }, false) }, '✕')));
      }
    }
    for (const m of conv.messages || []) {
      const mine = m.authorId === meId;
      nodes.push(h('div', { class: `msg ${mine ? 'mine' : ''}` }, m.body,
        h('div', { class: 'when' }, `${mine ? t('you') : m.authorDisplayName} · ${ago(m.createdAtUtc)}`)));
    }
    if (!nodes.length) nodes.push(h('div', { class: 'empty' }, t('noMessages')));
    const atBottom = ui.msgs.scrollHeight - ui.msgs.scrollTop - ui.msgs.clientHeight < 40;
    ui.msgs.replaceChildren(...nodes);
    if (atBottom) scrollMessages();
  }

  function scrollMessages() {
    requestAnimationFrame(() => { if (ui.msgs) ui.msgs.scrollTop = ui.msgs.scrollHeight; });
  }

  // ---------- Start ----------

  try {
    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === 'd2rbt-open-trade') {
        ensureHost();
        const { unread, offers } = badgeCount();
        openTab(offers && !unread ? 'offers' : 'chats');
      }
    });
  } catch { /* not running as an extension (test page) */ }

  // Badge data only: who am I, my listings (one request), my chats (one request).
  async function start() {
    ensureHost();
    if (!loggedIn() || S.starting) return;
    S.starting = true;
    S.lastStartAt = Date.now();
    try {
      await ensureMe();
      await Promise.all([loadListings(), loadConvs()]);
      S.lastPollAt = Date.now();
    } catch { /* shown when the window opens */ }
    S.starting = false;
    updateBadge();
    syncFab();
  }

  // Is the site's live connection already open? (ws-hook.js answers.)
  window.postMessage({ __d2rbt: 'socket-query' }, location.origin);

  // Let the site finish loading first.
  const whenIdle = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 4000 }) : setTimeout(fn, 1500));
  whenIdle(() => start());
  setInterval(maybePoll, 20000);
  let lastPath = location.pathname;
  setInterval(() => {
    if (!host || !document.body.contains(host)) ensureHost();
    if (location.pathname !== lastPath) { lastPath = location.pathname; syncFab(); }
    // Signed in later (or the first start failed): try again, at most once a minute.
    if (!S.listingsLoaded && !S.open && loggedIn() && Date.now() - (S.lastStartAt || 0) > 60000) start();
    else if (ui.fab && ui.fab.style.display === 'none' && !S.open && loggedIn()) syncFab();
  }, 2000);

  window.__d2rTradeOpen = openTab;

  // The UI language changed (here or in another site tab): redraw everything.
  I18N?.onChange(() => {
    if (ui.fabLabel) ui.fabLabel.textContent = t('fabTrade');
    if (S.open) render();
  });
  // From the bulk panel's sync result: show the open listings whose item is gone.
  window.__d2rTradeOpenMissing = () => {
    ensureHost();
    S.listFilter = 'All';
    S.missingOnly = true;
    S.pendingSync = true;
    openTab('listings');
  };
})();
