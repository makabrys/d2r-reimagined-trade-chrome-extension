// UI language for the extension: English (default) or Russian.
// Each entry is [English, Russian]; a value is a string or a function of the call's arguments.
// The choice is kept in the site's localStorage and shared by every open site tab.
(() => {
  if (window.__d2rI18n) return;
  const KEY = 'd2r_bt_lang';
  const LANGS = ['en', 'ru'];

  const S = {
    // ----- shared -----
    notSignedIn: ['You are not signed in. Sign in on the site and open the panel again.', 'Вы не вошли на сайт. Войдите (Sign in) и откройте панель снова.'],
    notSignedInWin: ['You are not signed in. Sign in on the site and open the window again.', 'Вы не вошли на сайт. Войдите (Sign in) и откройте окно снова.'],
    requestFailed: [(s) => `Request failed (${s})`, (s) => `Ошибка запроса (${s})`],
    loadFailed: [(p, s) => `Could not load ${p} (${s})`, (p, s) => `Не удалось загрузить ${p} (${s})`],
    close: ['Close', 'Закрыть'],
    hide: ['Hide', 'Скрыть'],
    noPrice: ['no price', 'без цены'],
    justNow: ['just now', 'только что'],
    minAgo: [(n) => `${n} min ago`, (n) => `${n} мин назад`],
    hAgo: [(n) => `${n} h ago`, (n) => `${n} ч назад`],
    dAgo: [(n) => `${n} d ago`, (n) => `${n} дн назад`],
    reqLvl: [(n) => `req. lvl ${n}`, (n) => `треб. ур. ${n}`],
    socketedIn: [(s) => `Socketed: ${s}`, (s) => `В гнёздах: ${s}`],
    selectedN: [(n) => `Selected: ${n}`, (n) => `Выбрано: ${n}`],
    langTitle: ['Language', 'Язык'],

    // ----- bulk listing panel -----
    fabBulk: ['☰ Bulk listing', '☰ Массовое выставление'],
    bulkTitle: ['Bulk trade listing', 'Массовое выставление на трейд'],
    ladder: ['Ladder', 'Лига'],
    nonLadderOpt: ['Non-ladder', 'Без лиги (non-ladder)'],
    nonLadder: ['non-ladder', 'без лиги (non-ladder)'],
    syncTitle: ['Reload your items and listings and mark which items are already in trade', 'Заново загрузить предметы и ваши объявления и отметить, какие предметы уже в трейде'],
    syncing: ['Syncing…', 'Синхронизирую…'],
    syncBtn: ['⇄ Sync with trade', '⇄ Синхронизировать с трейдом'],
    priceAll: ['Price for all', 'Цена для всех'],
    pricePh: ['e.g. 2 Ber / offer', 'напр. 2 Ber / offer'],
    noteAll: ['Note for all', 'Заметка для всех'],
    optional: ['optional', 'необязательно'],
    negotiable: ['Negotiable', 'Торг'],
    fromSaveHint: ['Used only when the save itself does not say', 'Используется, только если сохранение не говорит само'],
    game: ['Game', 'Игра'],
    delayHint: ['Pause between listings', 'Пауза между объявлениями'],
    delay: ['Pause, s', 'Пауза, сек'],
    viewGrid: ['▦ Inventory', '▦ Инвентарь'],
    viewList: ['☰ List', '☰ Список'],
    searchPh: ['Search: name, base, stat (life, skill, res)…', 'Поиск: имя, база, свойство (life, skill, res)…'],
    allSources: ['All sources', 'Все источники'],
    anyQuality: ['Any quality', 'Любое качество'],
    anyPlace: ['Any location', 'Любое место'],
    hideListed: ['Hide already listed', 'Скрыть уже выставленные'],
    identifiedOnly: ['Identified only', 'Только опознанные'],
    selectedOnly: ['Selected only', 'Только выбранные'],
    newOnlyHint: ['Items that appeared since you last opened this panel', 'Предметы, которые появились с прошлого открытия этой панели'],
    newOnly: [(n) => `New only (${n})`, (n) => `Только новые (${n})`],
    sort: ['Sort', 'Сортировка'],
    sort_new: ['Newest first', 'Сначала новые'],
    sort_name: ['By name', 'По названию'],
    sort_quality: ['By quality', 'По качеству'],
    sort_ilvl: ['By ilvl', 'По ilvl'],
    sort_place: ['By location', 'По месту'],
    showMissing: ['Show missing in “My listings”', 'Показать ненайденные в «Мои объявления»'],
    selectVisible: ['Select all visible', 'Выбрать все видимые'],
    clearSel: ['Clear selection', 'Снять выбор'],
    stop: ['Stop', 'Стоп'],
    submitting: ['Listing…', 'Выставляю…'],
    submit: [(n) => `List ${n}`.trim(), (n) => `Выставить ${n}`.trim()],
    footListed: [(n) => ` · listed: ${n}`, (n) => ` · выставлено: ${n}`],
    footErrors: [(n) => ` · errors: ${n}`, (n) => ` · ошибок: ${n}`],
    footMineFailed: [' · listings did not load', ' · объявления не загрузились'],
    footMine: [(o, f) => ` · your listings: ${o}, found in inventory: ${f}`, (o, f) => ` · ваших объявлений: ${o}, найдено в инвентаре: ${f}`],

    loc_merc: ['Mercenary', 'Наёмник'],
    loc_equipped: ['Equipped', 'Надето'],
    loc_belt: ['Belt', 'Пояс'],
    loc_charm: ['Charm inventory', 'Чарм-инвентарь'],
    loc_inventory: ['Inventory', 'Инвентарь'],
    loc_stash: ['Personal stash', 'Личный сундук'],
    loc_cube: ['Cube', 'Куб'],
    loc_tab: [(n) => `Tab ${n}`, (n) => `Вкладка ${n}`],
    src_stash: [(f) => `Shared stash (${f})`, (f) => `Общий сундук (${f})`],

    syncMineFailed: [(e) => `Listings did not load: ${e}`, (e) => `Объявления не загрузились: ${e}`],
    syncDone: [(o, f) => `Synced: ${o} open listings, ${f} marked in your inventory`, (o, f) => `Синхронизировано: ваших открытых объявлений ${o}, отмечено в инвентаре ${f}`],
    syncReserved: [(n) => ` (${n} awaiting trade)`, (n) => ` (из них ждут сделки: ${n})`],
    syncMissing: [(n, names) => ` Not found ${n}: ${names} — the item is not in your synced saves (sold, given away, or the save has not synced to the site yet).`,
      (n, names) => ` Не найдено ${n}: ${names} — предмета нет в синхронизированных сохранениях (продан, передан, или сохранение ещё не обновилось на сайте).`],
    summaryFailed: [(e) => `Could not load your listings: ${e}`, (e) => `Не удалось загрузить ваши объявления: ${e}`],
    summary: [(o, f) => `Your open listings: ${o}, found in inventory and stash: ${f}.`, (o, f) => `Ваших открытых объявлений: ${o}, найдено в инвентаре и сундуке: ${f}.`],
    summaryLost: [(n) => ` Not found ${n} (the item is not in your synced saves, or it is from another ladder): `, (n) => ` Не найдено ${n} (предмета нет в синхронизированных сохранениях, либо он из другой лиги): `],

    seenBefore: ['before tracking', 'до начала учёта'],
    tipAppeared: [(s) => `appeared: ${s}`, (s) => `появился: ${s}`],
    tipListed: [(p) => `● listed — price: ${p}`, (p) => `● уже выставлен — цена: ${p}`],
    tipReserved: [(p) => `● awaiting trade — price: ${p}`, (p) => `● ждёт сделки — цена: ${p}`],
    tipOffers: [(n) => `, offers: ${n}`, (n) => `, предложений: ${n}`],

    needGameMode: ['Game is not set (RotW / Expansion) — choose it in the settings above.', 'Не указан режим игры (RotW / Expansion) — выберите его в настройках сверху.'],
    needHardcore: ['Softcore/Hardcore is not set — choose it in the settings above.', 'Не указано Softcore/Hardcore — выберите в настройках сверху.'],
    andMore: [(n) => `… and ${n} more`, (n) => `… и ещё ${n}`],
    confirmList: [(n) => `List ${n} item(s) for trade?`, (n) => `Выставить ${n} предмет(ов) на трейд?`],
    confirmLadder: [(name) => `Ladder: ${name}`, (name) => `Лига: ${name}`],
    confirmDupes: [(n) => `Warning: ${n} of them are already listed — there will be duplicates.`, (n) => `Внимание: ${n} из них уже выставлены — будут дубли.`],
    confirmNoPrice: [(n) => `No price: ${n} — they will be listed without a price, buyers will make offers.`, (n) => `Без цены: ${n} — выйдут без цены, покупатели будут предлагать сами.`],
    confirmPublic: ['The listings will be public on the site.', 'Объявления появятся публично на сайте.'],
    stopped: ['Stopped', 'Остановлено'],
    listedOk: ['Listed', 'Выставлено'],
    stSending: ['… sending', '… отправка'],
    stQueued: ['queued', 'в очереди'],

    noMatch: ['Nothing matches the filter.', 'Под фильтр ничего не подходит.'],
    noItems: ['No items. Characters and stash must be synced to the server (same as on the List an item page).', 'Предметов нет. Персонажи и сундук должны быть синхронизированы с сервером (как на странице List an item).'],
    loadingInv: ['Loading characters and stash…', 'Загружаю персонажей и сундук…'],
    legendClick: ['Click to select/unselect. Hover an item to see its stats. ', 'Клик — выбрать/снять. Наведите на предмет, чтобы увидеть свойства. '],
    legendTrade: [' — already listed, ', ' — уже выставлен, '],
    legendPending: [' — offer accepted, awaiting trade. Faded — do not match the filter.', ' — принято предложение, ждёт сделки. Блёклые — не подходят под фильтр.'],
    removeSel: ['Remove from selected', 'Убрать из выбранных'],
    pricePhAll: [(p) => `price: ${p}`, (p) => `цена: ${p}`],
    pricePhEmpty: ['price (empty = no price)', 'цена (пусто = без цены)'],
    notePhAll: [(n) => `note: ${n}`, (n) => `заметка: ${n}`],
    note: ['note', 'заметка'],
    price: ['price', 'цена'],
    selectedHead: [(n) => `Selected (${n})`, (n) => `Выбранные (${n})`],
    sideHint: ['Click items on the left. Here you can set a price and a note for each; an empty field uses “Price for all” above.',
      'Кликните по предметам слева. Здесь можно задать цену и заметку каждому; пустое поле = «цена для всех» сверху.'],
    tagListed: ['already listed', 'уже выставлен'],
    req: [(n) => `req. ${n}`, (n) => `треб. ${n}`],
    sockN: [(n) => `${n} sock.`, (n) => `${n} гн.`],
    colItem: [(n) => `Item (${n})`, (n) => `Предмет (${n})`],
    colWhere: ['Where', 'Где'],
    colAppeared: ['Appeared', 'Появился'],
    colPrice: ['Price', 'Цена'],
    colNote: ['Note', 'Заметка'],
    colStatus: ['Status', 'Статус'],

    // ----- trade window -----
    st_Active: ['Active', 'Активно'],
    st_Reserved: ['Awaiting trade', 'Ждёт сделки'],
    st_Completed: ['Completed', 'Завершено'],
    st_Cancelled: ['Cancelled', 'Снято'],
    st_Expired: ['Expired', 'Истекло'],
    of_Pending: ['New', 'Новое'],
    of_Accepted: ['Accepted', 'Принято'],
    of_Declined: ['Declined', 'Отклонено'],
    of_Withdrawn: ['Withdrawn', 'Отозвано'],
    f_Active: ['Active', 'Активные'],
    f_Reserved: ['Awaiting trade', 'Ждут сделки'],
    f_Completed: ['Completed', 'Завершённые'],
    f_Cancelled: ['Cancelled', 'Снятые'],
    f_All: ['All', 'Все'],
    character: ['character', 'персонаж'],
    whereMerc: [(n) => `${n} (merc)`, (n) => `${n} (наёмник)`],
    whereTab: [(n) => `shared stash, tab ${n}`, (n) => `общий сундук, вкл. ${n}`],
    tSynced: [(o, f) => `Synced: ${o} open listings, ${f} found in inventory`, (o, f) => `Синхронизировано: открытых объявлений ${o}, найдено в инвентаре ${f}`],
    tSyncedMissing: [(n) => `, ${n} not in inventory — most likely sold or given away; such listings should be closed (“Cancel”, or “✓ Trade done” for those awaiting trade).`,
      (n) => `, нет в инвентаре ${n} — скорее всего, проданы или переданы: такие объявления стоит снять («Снять» или «✓ Сделка прошла» у ждущих сделки).`],
    confirmStatus: [(name, label) => `“${name}”: change status to “${label}”?`, (name, label) => `«${name}»: изменить статус на «${label}»?`],
    statusSet: [(name, label) => `“${name}” — ${label}.`, (name, label) => `«${name}» — ${label}.`],
    itemErr: [(name, err) => `“${name}”: ${err}`, (name, err) => `«${name}»: ${err}`],
    priceSaved: [(name) => `Price of “${name}” saved.`, (name) => `Цена «${name}» сохранена.`],
    confirmCancelMany: [(n, list) => `Cancel ${n} listing(s)?\n\n${list}`, (n, list) => `Снять с продажи ${n} объявлени(й)?\n\n${list}`],
    item: ['item', 'предмет'],
    confirmAccept: [(b, name, text) => `Accept the offer from ${b} for “${name}”?\n\n“${text}”\n\nThe item will be reserved for this buyer and the other offers for it will be declined.`,
      (b, name, text) => `Принять предложение ${b} за «${name}»?\n\n«${text}»\n\nПредмет будет зарезервирован за покупателем, остальные предложения по нему отклонятся.`],
    confirmDecline: [(b, name, text) => `Decline the offer from ${b} for “${name}”?\n\n“${text}”`, (b, name, text) => `Отклонить предложение ${b} за «${name}»?\n\n«${text}»`],
    accepted: [(b, name) => `Accepted: ${b} — “${name}”. Arrange the meeting in the chat.`, (b, name) => `Принято: ${b} — «${name}». Договоритесь о встрече в чате.`],
    declined: [(b) => `Declined: ${b}.`, (b) => `Отклонено: ${b}.`],
    newOfferFrom: [(w) => `New offer from ${w}`, (w) => `Новое предложение от ${w}`],
    newMsgFrom: [(w) => `New message from ${w}`, (w) => `Новое сообщение от ${w}`],
    newMsg: ['New message', 'Новое сообщение'],
    newOffer: ['New offer', 'Новое предложение'],
    openOffersTab: ['Open the “Offers” tab.', 'Откройте вкладку «Предложения».'],
    fabTrade: ['💬 Trade', '💬 Торговля'],
    soundHint: ['Sound on a new message or offer', 'Звук при новом сообщении или предложении'],
    sound: ['🔔 Sound', '🔔 Звук'],
    volume: ['Volume', 'Громкость'],
    desktopHint: ['Windows notification, even when Chrome is minimized', 'Всплывающее уведомление Windows, даже если Chrome свёрнут'],
    desktop: ['🖥 Notifications', '🖥 Уведомления'],
    test: ['Test', 'Проверить'],
    testTitle: ['D2R — test', 'D2R — проверка'],
    testBody: ['This is how a trade notification looks.', 'Так будет выглядеть уведомление о трейде.'],
    loadingShort: ['Loading…', 'Загрузка…'],
    tabListings: [(n) => `📋 My listings${n}`, (n) => `📋 Мои объявления${n}`],
    tabOffers: ['💰 Offers', '💰 Предложения'],
    tabChats: ['💬 Chats', '💬 Чаты'],
    listSearchPh: ['Search: name, price, stat…', 'Поиск: название, цена, свойство…'],
    invSyncTitle: ['Reload listings and check where each listed item is now', 'Заново загрузить объявления и проверить, где сейчас лежит каждый выставленный предмет'],
    invSyncBtn: ['⇄ Sync with inventory', '⇄ Синхронизировать с инвентарём'],
    missingHint: ['You no longer have the item — probably sold. Such listings should be cancelled or completed.', 'Предмета уже нет у вас — возможно, продан. Такие объявления стоит снять или завершить.'],
    missingOnly: [(n) => `Only “not in inventory” (${n})`, (n) => `Только «нет в инвентаре» (${n})`],
    loadingDots: ['Loading…', 'Загружаю…'],
    noData: ['No data.', 'Нет данных.'],
    noListings: ['No listings match this filter.', 'Нет объявлений под этот фильтр.'],
    selectAllActive: ['Select all visible active', 'Выбрать все видимые активные'],
    colOffers: ['Offers', 'Предл.'],
    colInInv: ['In inventory', 'В инвентаре'],
    tSelectHint: ['Tick listings to cancel several at once.', 'Отметьте объявления, чтобы снять сразу несколько.'],
    listMore: ['+ List more', '+ Выставить ещё'],
    cancelSelected: [(n) => `Cancel selected${n}`, (n) => `Снять выбранные${n}`],
    aCancel: ['Cancel', 'Снять'],
    aDone: ['✓ Trade done', '✓ Сделка прошла'],
    aRelist: ['Relist', 'Вернуть в продажу'],
    openOnSite: ['Open on the site', 'Открыть на сайте'],
    listedAgo: [(s) => `listed ${s}`, (s) => `выставлено ${s}`],
    savePrice: ['Save price', 'Сохранить цену'],
    showOffers: ['Show offers', 'Показать предложения'],
    buyer: [(n) => `buyer: ${n}`, (n) => `покупатель: ${n}`],
    notInInvTitle: ['The item is not on your synced characters or in the shared stash — probably sold or given away', 'Предмета нет на синхронизированных персонажах и в общем сундуке — возможно, продан или передан'],
    notInInv: ['⚠ missing', '⚠ нет'],
    ofNew: [(n) => `New (${n})`, (n) => `Новые (${n})`],
    ofAll: [(n) => `All (${n})`, (n) => `Все (${n})`],
    onlyListing: [(name) => `Only “${name}” ✕`, (name) => `Только «${name}» ✕`],
    offersHint: ['Offers on your active and reserved listings.', 'Предложения по вашим активным и зарезервированным объявлениям.'],
    offersLoading: ['Loading offers…', 'Загружаю предложения…'],
    noNewOffers: ['No new offers.', 'Новых предложений нет.'],
    noOffers: ['No offers.', 'Предложений нет.'],
    yourPrice: [(p) => `  · your price: ${p}`, (p) => `  · ваша цена: ${p}`],
    accept: ['✓ Accept', '✓ Принять'],
    decline: ['✕ Decline', '✕ Отклонить'],
    chat: ['💬 Chat', '💬 Чат'],
    chatSearchPh: ['Search chats…', 'Поиск по чатам…'],
    dealTag: ['deal', 'сделка'],
    noChats: ['No chats.', 'Чатов нет.'],
    pickChat: ['Pick a chat on the left.', 'Выберите чат слева.'],
    composerPh: ['Message… (Enter — send, Shift+Enter — new line)', 'Сообщение… (Enter — отправить, Shift+Enter — новая строка)'],
    insertHint: ['Insert into the message', 'Вставить в сообщение'],
    send: ['Send', 'Отправить'],
    partner: ['Partner', 'Собеседник'],
    youSell: ['  (you are selling)', '  (вы продаёте)'],
    youBuy: ['  (you are buying)', '  (вы покупаете)'],
    listingLink: ['Listing ↗', 'Объявление ↗'],
    offerLine: [(txt) => `Offer: “${txt}”`, (txt) => `Предложение: «${txt}»`],
    you: ['you', 'вы'],
    noMessages: ['No messages yet.', 'Сообщений пока нет.'],

    // ----- price check -----
    pcBtn: ['Market prices: who else sells this item', 'Цены на рынке: кто ещё продаёт этот предмет'],
    pcHint: ['Right-click — market prices', 'Правый клик — цены на рынке'],
    pcTitle: [(name) => `Market: ${name}`, (name) => `Рынок: ${name}`],
    pcSameQuality: [(q) => `${q} only`, (q) => `Только ${q}`],
    pcLoading: ['Searching the market…', 'Ищу на рынке…'],
    pcNone: ['Nobody else is selling this item right now.', 'Сейчас никто больше не продаёт этот предмет.'],
    pcFound: [(n, shown) => `${n} listing(s)` + (shown < n ? `, showing the ${shown} newest` : ''),
      (n, shown) => `Найдено объявлений: ${n}` + (shown < n ? `, показаны ${shown} самых свежих` : '')],
    pcYou: ['you', 'вы'],
    pcOffers: [(n) => `offers: ${n}`, (n) => `предложений: ${n}`],
    pcOpen: ['Open the listing', 'Открыть объявление'],
    pcStatsNote: ['Magic and rare items of the same base differ by stats — compare the blue lines.', 'Магические и редкие предметы одной базы отличаются свойствами — сравнивайте синие строки.']
  };

  let lang = 'en';
  try {
    const saved = localStorage.getItem(KEY);
    if (LANGS.includes(saved)) lang = saved;
  } catch { /* storage blocked: stay on English */ }

  const listeners = new Set();
  const emit = () => { for (const fn of listeners) { try { fn(lang); } catch { /* one listener must not break others */ } } };

  function t(key, ...args) {
    const entry = S[key];
    if (!entry) return key;
    const value = entry[lang === 'ru' ? 1 : 0] ?? entry[0];
    return typeof value === 'function' ? value(...args) : value;
  }

  function setLang(next) {
    if (!LANGS.includes(next) || next === lang) return;
    lang = next;
    try { localStorage.setItem(KEY, next); } catch { /* ignore */ }
    emit();
  }

  // Another site tab switched the language.
  window.addEventListener('storage', (event) => {
    if (event.key === KEY && LANGS.includes(event.newValue) && event.newValue !== lang) { lang = event.newValue; emit(); }
  });

  // An "EN | RU" toggle; it uses the panels' own .seg button style.
  function switcher() {
    const box = document.createElement('span');
    box.className = 'seg lang';
    box.title = t('langTitle');
    for (const code of LANGS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = code.toUpperCase();
      if (code === lang) button.className = 'on';
      button.addEventListener('click', () => setLang(code));
      box.append(button);
    }
    return box;
  }

  window.__d2rI18n = {
    t,
    setLang,
    switcher,
    get lang() { return lang; },
    locale: () => (lang === 'ru' ? 'ru-RU' : 'en-GB'),
    onChange: (fn) => listeners.add(fn)
  };
})();
