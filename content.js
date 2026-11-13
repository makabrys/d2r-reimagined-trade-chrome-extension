// D2R Reimagined — bulk trade listing.
// Runs on www.d2r-reimagined.com and uses the site's own login (the access token the site
// keeps in localStorage, refreshed through the site's refresh cookie). It calls the same API
// the "List an item" page calls: GET /trades/inventory, GET /trades/mine, POST /trades.
(() => {
  if (window.__d2rBulkTrade) return;
  window.__d2rBulkTrade = true;
  const I18N = window.__d2rI18n;
  const t = I18N ? I18N.t : (key) => key;

  const API = 'https://api.d2r-reimagined.com';
  const TOKEN_KEY = 'd2r_reimagined_access_token';
  const GAME_MODE_KEY = 'd2r_reimagined_trade_game_mode';
  const HARDCORE_KEY = 'd2r_reimagined_trade_hardcore';
  const SETTINGS_KEY = 'd2r_bulk_trade_settings';

  // ---------- API ----------

  class ApiError extends Error {
    constructor(message, status) { super(message); this.status = status; }
  }

  let refreshing = null;
  function refreshToken() {
    if (!refreshing) {
      refreshing = (async () => {
        const response = await fetch(`${API}/auth/refresh`, { method: 'POST', credentials: 'include' });
        if (!response.ok) return false;
        const body = await response.json();
        if (!body?.accessToken) return false;
        localStorage.setItem(TOKEN_KEY, body.accessToken);
        return true;
      })().catch(() => false).finally(() => { refreshing = null; });
    }
    return refreshing;
  }

  async function api(path, init = {}, retry = true) {
    const headers = new Headers(init.headers);
    if (init.body) headers.set('Content-Type', 'application/json');
    let token = localStorage.getItem(TOKEN_KEY);
    if (!token && retry && await refreshToken()) token = localStorage.getItem(TOKEN_KEY);
    if (!token) throw new ApiError(t('notSignedIn'), 401);
    headers.set('Authorization', `Bearer ${token}`);
    const response = await fetch(`${API}${path}`, { ...init, headers, credentials: 'include' });
    if (response.status === 401 && retry && await refreshToken()) return api(path, init, false);
    if (!response.ok) {
      const problem = await response.json().catch(() => null);
      let message = problem?.detail || problem?.title || t('requestFailed', response.status);
      if (problem?.errors) message += ': ' + Object.values(problem.errors).flat().join('; ');
      throw new ApiError(message, response.status);
    }
    if (response.status === 204) return undefined;
    return response.json();
  }

  async function staticJson(path) {
    const response = await fetch(path);
    if (!response.ok) throw new Error(t('loadFailed', path, response.status));
    return response.json();
  }

  // ---------- Item data (same rules as the site's List an item page) ----------

  const data = {
    presentations: new Map(),
    strings: {},
    tiers: new Map(),
    reqLevels: new Map(), // unique/set name -> required level
    runewordNames: new Map(),
    runewordReq: new Map()
  };
  let dataLoaded = null;

  function stripGender(value) {
    if (typeof value !== 'string' || value.charCodeAt(0) !== 91) return value;
    for (const part of value.split(/\[[a-z]{2}\]/g)) if (part) return part;
    return value;
  }

  // Game text (item and stat names) from the site's English strings.
  function gt(key) {
    if (!key) return '';
    return stripGender(data.strings[key]) ?? key;
  }

  function buildTiers(bases) {
    const links = new Map();
    for (const base of bases) {
      const chain = [base.NameKey, base.NormCode, base.UberCode, base.UltraCode]
        .filter(Boolean).map((code) => String(code).toLowerCase());
      for (const code of chain) {
        const linked = links.get(code) ?? new Set();
        for (const sibling of chain) linked.add(sibling);
        links.set(code, linked);
      }
    }
    const tiers = new Map();
    for (const code of links.keys()) {
      if (tiers.has(code)) continue;
      const family = new Set();
      const pending = [code];
      while (pending.length) {
        const next = pending.pop();
        if (family.has(next)) continue;
        family.add(next);
        for (const sibling of links.get(next) ?? []) pending.push(sibling);
      }
      for (const member of family) tiers.set(member, family);
    }
    return tiers;
  }

  function loadData() {
    if (!dataLoaded) {
      dataLoaded = Promise.all([
        staticJson('/data/keyed/item-presentation.json'),
        staticJson('/data/strings/enUS.json'),
        staticJson('/data/keyed/uniques.json'),
        staticJson('/data/keyed/sets.json'),
        staticJson('/data/keyed/runewords.json'),
        staticJson('/data/keyed/armors.json'),
        staticJson('/data/keyed/weapons.json'),
        staticJson('/data/keyed/item-stat-presentation.json').catch(() => ({ Stats: {}, Skills: {}, CompositeKeys: {} }))
      ]).then(([presentations, strings, uniques, sets, runewords, armors, weapons, statBundle]) => {
        data.statBundle = statBundle;
        data.presentations = new Map(presentations.map((row) => [row.Code.toLowerCase(), row]));
        data.strings = strings;
        for (const row of [...uniques, ...sets.flatMap((set) => set.SetItems ?? [])]) {
          if (row?.Index != null && typeof row.RequiredLevel === 'number' && !data.reqLevels.has(String(row.Index))) data.reqLevels.set(String(row.Index), row.RequiredLevel);
        }
        data.tiers = buildTiers([...armors, ...weapons]);
        for (const rw of runewords) {
          const runes = rw.Runes ?? [];
          if (!runes.length || runes.some((r) => !r.NameKey) || rw.Index == null || rw.Enabled === false) continue;
          const key = runes.map((r) => r.NameKey.trim().toLowerCase()).join(',');
          if (!data.runewordNames.has(key)) {
            data.runewordNames.set(key, String(rw.Index));
            data.runewordReq.set(String(rw.Index), rw.RequiredLevel);
          }
        }
      }).catch((error) => { dataLoaded = null; throw error; });
    }
    return dataLoaded;
  }

  // ---------- Item stat lines (a compact port of the site's item-stat-presentation.ts) ----------

  const TOKEN = /%(?:\+d|d|D|s|S|i|c\d|\d|%)/g;

  function formatDecimal(n) {
    return Number.isInteger(n) ? String(n) : String(Number(n.toPrecision(15)));
  }

  function formatArg(value, token) {
    if (value === null || value === undefined) return '';
    if (token === '%+d') {
      const n = Number(value);
      return Number.isFinite(n) ? (n >= 0 ? '+' : '') + formatDecimal(n) : String(value);
    }
    if (/^%[dDi]$/.test(token)) {
      const n = Number(value);
      return Number.isFinite(n) ? formatDecimal(n) : String(value);
    }
    return typeof value === 'number' ? formatDecimal(value) : String(value);
  }

  function formatTemplate(template, args = []) {
    if (!template) return '';
    const tokens = template.match(TOKEN) ?? [];
    const sequential = tokens.filter((m) => m !== '%%' && !/^%\d$/.test(m) && !/^%c\d$/.test(m));
    const isNumeric = (m) => m === '%+d' || /^%[dDi]$/.test(m);
    let pairBudget = Math.max(0, Math.min(args.length - sequential.length, sequential.filter(isNumeric).length));
    let i = 0;
    return template.replace(TOKEN, (m) => {
      if (m === '%%') return '%';
      if (/^%c\d$/.test(m)) return '';
      if (/^%\d$/.test(m)) return formatArg(args[Number(m[1])], m);
      if (isNumeric(m) && pairBudget > 0) {
        pairBudget--;
        const min = args[i++];
        const max = args[i++];
        const minStr = formatArg(min, m);
        return typeof min === 'number' && typeof max === 'number' && min !== max
          ? `${minStr}-${formatArg(max, m === '%+d' ? '%d' : m)}` : minStr;
      }
      return formatArg(args[i++], m);
    });
  }

  // key + args the way the site's i18n "line" helper renders them: string args are keys too.
  function line(key, args = [], extra = {}) {
    let text = formatTemplate(gt(key), args.map((a) => (typeof a === 'string' ? gt(a) : a)));
    if (extra.perLevel) text += gt('strPerCharacterLevelSuffix');
    if (extra.classOnly) text += ` ${gt(extra.classOnly)}`;
    return text;
  }

  const CLASS_SKILL_LINES = [['ModStr3a', 'Amazon'], ['ModStr3d', 'Sorceress'], ['ModStr3c', 'Necromancer'], ['ModStr3b', 'Paladin'],
    ['ModStr3e', 'Barbarian'], ['ModStre8a', 'Druid'], ['ModStre8b', 'Assassin'], ['ModStrge9', 'Warlock']];
  const SKILL_TAB_IDS = [[3, 2, 1], [15, 14, 13], [8, 7, 9], [6, 5, 4], [11, 12, 10], [16, 17, 18], [19, 20, 21], [24, 22, 23]];
  const SKILL_TAB_CLASS = ['AmaOnly', 'SorOnly', 'NecOnly', 'PalOnly', 'BarOnly', 'DruOnly', 'AssOnly', 'WarOnly'];
  const DAMAGE_PAIRS = [['mindamage', 'maxdamage', 'PhysicalDamage'], ['firemindam', 'firemaxdam', 'FireDamage'],
    ['coldmindam', 'coldmaxdam', 'ColdDamage'], ['lightmindam', 'lightmaxdam', 'LightningDamage'], ['magicmindam', 'magicmaxdam', 'MagicDamage']];

  function words(value) {
    return value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function statValue(stat) {
    const shift = data.statBundle?.Stats?.[stat.name]?.ValueShift ?? 0;
    let value = stat.value / 2 ** shift;
    if (stat.name.toLowerCase().endsWith('_perlevel')) value /= 4;
    return Math.round(value * 100) / 100;
  }

  function fallbackLine(stat) {
    const v = statValue(stat);
    return `${words(stat.name)}${stat.layer ? ` (Layer ${stat.layer})` : ''}: ${v > 0 ? '+' : ''}${v}`
      + (stat.name.toLowerCase().endsWith('_perlevel') ? ' (Based on Character Level)' : '');
  }

  function mergedStats(item) {
    const merged = (item.stats ?? []).map((s) => ({ ...s }));
    const byKey = new Map(merged.map((s) => [`${s.name}:${s.layer}`, s]));
    const add = (stats) => {
      for (const stat of stats ?? []) {
        const key = `${stat.name}:${stat.layer}`;
        const existing = byKey.get(key);
        if (existing) existing.value += stat.value;
        else { const copy = { ...stat }; byKey.set(key, copy); merged.push(copy); }
      }
    };
    for (const socket of item.sockets ?? []) if (socket) add(mergedStats(socket));
    add(item.runewordStats);
    return merged;
  }

  function statLines(item) {
    const bundle = data.statBundle;
    if (!bundle) return [];
    const stats = mergedStats(item);
    const out = [];
    const consumed = new Set();
    const meta = (s) => bundle.Stats[s.name];
    const skillName = (skill) => skill.NameKey || skill.FallbackName;
    const packed = (s) => ({ skill: bundle.Skills[String(s.layer >> 6)], level: s.layer & 0x3f });

    stats.forEach((stat, index) => {
      if (stat.name !== 'item_nonclassskill_display') return;
      const backing = stats.findIndex((c, ci) => ci !== index && c.name === 'item_nonclassskill' && c.layer === stat.layer && c.value === stat.value);
      if (backing >= 0) consumed.add(backing);
    });
    for (const [minName, maxName, composite] of DAMAGE_PAIRS) {
      const a = stats.findIndex((s, i) => !consumed.has(i) && s.name === minName);
      const b = stats.findIndex((s, i) => !consumed.has(i) && s.name === maxName);
      const key = bundle.CompositeKeys?.[composite];
      if (a < 0 || b < 0 || !key) continue;
      consumed.add(a); consumed.add(b);
      out.push({ p: meta(stats[a])?.Priority ?? 0, text: line(key, [statValue(stats[a]), statValue(stats[b])]) });
    }
    const pMin = stats.findIndex((s) => s.name === 'poisonmindam');
    const pMax = stats.findIndex((s) => s.name === 'poisonmaxdam');
    const pLen = stats.findIndex((s) => s.name === 'poisonlength');
    if (pMin >= 0 && pMax >= 0 && pLen >= 0 && bundle.CompositeKeys?.PoisonDamage) {
      consumed.add(pMin); consumed.add(pMax); consumed.add(pLen);
      const frames = statValue(stats[pLen]);
      out.push({ p: meta(stats[pMin])?.Priority ?? 0, text: line(bundle.CompositeKeys.PoisonDamage,
        [Math.ceil(statValue(stats[pMin]) * frames / 256), Math.ceil(statValue(stats[pMax]) * frames / 256), Math.round(frames / 25 * 100) / 100]) });
    }

    stats.forEach((stat, index) => {
      if (consumed.has(index) || stat.name === 'charm_weight' || stat.name === 'poison_count') return;
      const m = meta(stat);
      const value = statValue(stat);
      const perLevel = stat.name.toLowerCase().endsWith('_perlevel');
      let text = null;
      if (stat.name === 'item_addclassskills') {
        const cls = CLASS_SKILL_LINES[stat.layer];
        text = cls ? line(cls[0], [value]) : fallbackLine(stat);
      } else if (stat.name === 'item_addskill_tab') {
        const ci = Math.floor(stat.layer / 8);
        const id = SKILL_TAB_IDS[ci]?.[stat.layer % 8];
        text = id !== undefined ? line(`StrSklTabItem${id}`, [value], { classOnly: SKILL_TAB_CLASS[ci] }) : fallbackLine(stat);
      } else if (stat.name === 'item_nonclassskill' || stat.name === 'item_singleskill') {
        const skill = bundle.Skills[String(stat.layer)];
        if (!skill || stat.layer === 449 || String(skill.NameKey || '').toLowerCase() === 'charmweight1') return;
        const args = [value, skillName(skill)];
        if (skill.ClassOnlyKey) args.push(skill.ClassOnlyKey);
        text = line(skill.LineKey, args);
      } else if ((m?.Function === 16 || m?.Function === 28) && m.PositiveKey && bundle.Skills[String(stat.layer)]) {
        text = line(m.PositiveKey, [value, skillName(bundle.Skills[String(stat.layer)])]);
      } else if (m?.Function === 15 && m.PositiveKey && packed(stat).skill) {
        const { skill, level } = packed(stat);
        text = line(m.PositiveKey, [value, level, skillName(skill)]);
      } else if (m?.Function === 24 && packed(stat).skill) {
        const { skill, level } = packed(stat);
        text = line('strSkillCharges', [level, skillName(skill), stat.value & 0xff, (stat.value >> 8) & 0xff]);
      } else if (m?.Function === 11) {
        if (stat.value <= 0) return;
        text = line('ModStre9u', [1, Math.max(1, Math.floor(100 / stat.value))]);
      } else if (m) {
        const key = value < 0 && m.NegativeKey ? m.NegativeKey : m.PositiveKey;
        if (!key) return;
        let shown = value;
        if (m.Function === 5) shown = Math.round(shown * 100 / 128 * 100) / 100;
        if (m.Function === 20) shown *= -1;
        text = line(key, m.Function === 3 ? [] : [shown], { perLevel });
      } else {
        text = fallbackLine(stat);
      }
      if (text) out.push({ p: m?.Priority ?? 0, text, tone: stat.name === 'item_corrupted' ? 'corrupted' : stat.name.startsWith('upgrade_') ? 'enchant' : 'magic' });
    });
    return out.sort((a, b) => b.p - a.p);
  }

  function isIdentified(item) {
    return (item.flags?.names ?? []).some((name) => name.toLowerCase() === 'identified');
  }

  function variantQuality(item) {
    const quality = String(item.quality || '').toLowerCase();
    if (quality.includes('unique')) return 'unique';
    if (quality.includes('set')) return 'set';
    return null;
  }

  function itemVariant(item) {
    const fileIndex = item.qualityData?.fileIndex;
    const quality = variantQuality(item);
    const code = String(item.codeText || '').toLowerCase();
    const presentation = data.presentations.get(code);
    if (fileIndex == null || !quality || !presentation) return null;
    const listOf = (p) => (quality === 'unique' ? p.UniqueSprites : p.SetSprites) ?? [];
    const own = listOf(presentation).find((v) => v.FileIndex === fileIndex);
    if (own) return own;
    for (const sibling of data.tiers.get(code) ?? []) {
      if (sibling === code) continue;
      const base = data.presentations.get(sibling);
      const variant = base && listOf(base).find((v) => v.FileIndex === fileIndex);
      if (variant) return variant;
    }
    return null;
  }

  function runewordName(item) {
    if (item.runewordId == null) return null;
    const codes = (item.sockets ?? []).filter(Boolean).map((s) => String(s.codeText).trim().toLowerCase());
    return codes.length ? data.runewordNames.get(codes.join(',')) ?? null : null;
  }

  function stashGameMode(fileName) {
    const name = fileName.toLowerCase();
    if (name.startsWith('modernsharedstash')) return 'RotW';
    if (name.startsWith('sharedstash')) return 'Expansion';
    return null;
  }

  function stashIsHardcore(fileName) {
    const name = fileName.toLowerCase();
    if (name.includes('hardcore')) return true;
    if (name.includes('softcore')) return false;
    return null;
  }

  function describe(item) {
    const identified = isIdentified(item);
    const baseName = item.baseName || item.codeText;
    const variant = itemVariant(item);
    const rwName = runewordName(item);
    let name = baseName;
    if (identified) name = rwName || (variant?.NameKey ? gt(variant.NameKey) : '') || item.personalizedName || baseName;
    const quality = identified ? (item.runewordId != null ? 'Runeword' : item.quality) : 'Unidentified';
    let requiredLevel = null;
    if (identified) {
      if (rwName && typeof data.runewordReq.get(rwName) === 'number') requiredLevel = data.runewordReq.get(rwName);
      else if (variantQuality(item)) {
        if (data.reqLevels.has(name)) requiredLevel = data.reqLevels.get(name);
      }
    }
    const flags = (item.flags?.names ?? []).map((n) => n.toLowerCase());
    const presentation = data.presentations.get(String(item.codeText || '').toLowerCase());
    let lines = [];
    try { lines = identified ? statLines(item) : []; } catch { lines = []; }
    const socketed = (item.sockets ?? []).filter(Boolean).map((s) => {
      const sp = data.presentations.get(String(s.codeText || '').toLowerCase());
      return (sp?.NameKey ? gt(sp.NameKey) : '') || s.baseName || s.codeText;
    });
    return {
      lines,
      socketed,
      width: presentation?.Width ?? 1,
      height: presentation?.Height ?? 1,
      search: `${name} ${baseName} ${item.quality} ${lines.map((l) => l.text).join(' ')} ${socketed.join(' ')}`.toLowerCase(),
      name,
      baseName,
      quality,
      identified,
      requiredLevel,
      itemType: item.baseName || item.codeText,
      sockets: (item.sockets ?? []).length,
      isEthereal: flags.includes('ethereal'),
      isCorrupted: flags.some((n) => n.includes('corrupt'))
        || (item.stats ?? []).some((s) => String(s.name || '').toLowerCase().includes('corrupt')),
      sprite: variant?.Sprite || presentation?.Sprite || null
    };
  }

  // A language-neutral id for where an item is; locName() turns it into words.
  function locationId(item, merc) {
    if (merc) return 'merc';
    const pos = item.position ?? {};
    if (pos.mode === 'Equipped') return 'equipped';
    if (pos.mode === 'Belt') return 'belt';
    if (pos.mode === 'Stored' && pos.storePageId === 6) return 'charm';
    const page = pos.storePage || pos.mode || '';
    return { Inventory: 'inventory', Stash: 'stash', Cube: 'cube' }[page] || `raw:${page || '—'}`;
  }

  function locName(id) {
    if (id.startsWith('tab:')) return t('loc_tab', id.slice(4));
    if (id.startsWith('raw:')) return id.slice(4);
    return t(`loc_${id}`);
  }

  // Labels that depend on the UI language; redone when it changes.
  function labelRow(row) {
    row.location = locName(row.locId);
    if (row.stashFile) row.sourceLabel = t('src_stash', row.stashFile);
    return row;
  }

  // ---------- State ----------

  const state = {
    ladders: [],
    ladderId: '',
    rows: [],
    listedKeys: new Map(),
    loading: false,
    running: false,
    stopRequested: false,
    error: '',
    filters: { search: '', source: '', quality: '', location: '', hideListed: true, identifiedOnly: false, selectedOnly: false, newOnly: false, notInTradeOnly: false },
    newSince: null,
    trackingSince: null,
    settings: loadSettings()
  };

  function loadSettings() {
    const defaults = {
      price: '',
      note: '',
      negotiable: true,
      gameMode: localStorage.getItem(GAME_MODE_KEY) || '',
      isHardcore: localStorage.getItem(HARDCORE_KEY) ?? '',
      delay: 2,
      view: 'grid',
      sort: 'new'
    };
    try { return { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch { return defaults; }
  }

  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings)); } catch { /* ignore */ }
  }

  function itemSignature(item) {
    return `${String(item.codeText || '').toLowerCase()}:${item.seed}`;
  }

  async function loadEverything() {
    state.loading = true;
    state.error = '';
    render();
    try {
      await loadData();
      if (!state.ladders.length) {
        state.ladders = await api('/ladders/summaries');
        const now = Date.now();
        const current = state.ladders.find((l) => new Date(l.startDateUtc).getTime() <= now && new Date(l.endDateUtc).getTime() > now);
        state.ladderId = current?.id ?? '';
      }
      const query = state.ladderId ? `?ladderId=${encodeURIComponent(state.ladderId)}` : '';
      state.mineError = '';
      const [inventory, mine] = await Promise.all([
        api(`/trades/inventory${query}`),
        api('/trades/mine').catch((error) => { state.mineError = error.message || String(error); return []; })
      ]);
      state.openListings = (Array.isArray(mine) ? mine : mine?.items ?? []).filter((l) => ['Active', 'Reserved'].includes(l.status));
      await withItemData(state.openListings);
      const previous = new Map(state.rows.map((r) => [r.key, r]));
      const rows = [];
      for (const entry of inventory.characters ?? []) {
        const character = entry.character;
        const save = entry.save;
        if (!save) continue;
        const add = (item, merc) => {
          if (!item || item.position?.mode === 'Socketed') return;
          rows.push(makeRow(item, {
            origin: 'character',
            characterId: character.id,
            sourceKey: `c:${character.id}`,
            sourceLabel: `${character.name} (${character.class}, ${character.level})`,
            locId: locationId(item, merc),
            gameMode: character.gameMode ?? null,
            isHardcore: typeof character.isHardcore === 'boolean' ? character.isHardcore : null
          }, previous));
        };
        for (const item of save.items?.entries ?? []) add(item, false);
        for (const item of save.mercenaryItems?.entries ?? []) add(item, true);
      }
      for (const stash of inventory.sharedStashes ?? []) {
        (stash.tabs ?? []).forEach((tab, index) => {
          for (const item of tab.items ?? []) {
            rows.push(makeRow(item, {
              origin: 'stash',
              characterId: null,
              sourceKey: `s:${stash.fileName}`,
              stashFile: stash.fileName.replace(/\.d2i$/i, ''),
              locId: `tab:${index + 1}`,
              gameMode: stashGameMode(stash.fileName),
              isHardcore: stashIsHardcore(stash.fileName)
            }, previous));
          }
        });
      }
      trackFirstSeen(rows);
      state.loadedAt = Date.now();
      // signature -> the listing that holds the item (Active or Reserved)
      const { matches, unmatched } = matchListings(state.openListings, rows);
      state.unmatchedListings = unmatched;
      state.listedKeys = new Map();
      for (const [row, listing] of matches) state.listedKeys.set(itemSignature(row.item), listing);
      state.rows = rows;
    } catch (error) {
      state.error = error.message || String(error);
    } finally {
      state.loading = false;
      render();
    }
  }

  // Where the grid view draws an item: a grid (inventory, charms, stashes, cube) or a strip.
  const GRID_MIN = { inventory: [10, 8], charm: [10, 4], stash: [10, 10], cube: [3, 4] };
  const GROUP_ORDER = ['equipped', 'inventory', 'charm', 'belt', 'stash', 'cube', 'merc'];

  function gridPlace(source, item) {
    const loc = source.locId;
    const isGrid = source.origin === 'stash' || Boolean(GRID_MIN[loc]);
    return {
      groupKey: `${source.sourceKey}|${loc}`,
      groupId: loc,
      isGrid,
      minSize: source.origin === 'stash' ? [10, 10] : GRID_MIN[loc] ?? [1, 1],
      x: item.position?.inventoryX ?? 0,
      y: item.position?.inventoryY ?? 0
    };
  }

  // Which inventory item each open listing is. A listing made from a synced save carries the
  // item's seed. One made in game with /sell on Ladder carries seed 0 (the game does not give
  // online clients the seed), so those are matched by their attributes, the way the site's
  // own trade-game-item.ts does: base code, quality, item level, unique/set row, flags,
  // sockets and stats. Each listing marks at most one item.
  const VOLATILE_STATS = new Set([31, 70, 72, 73, 194]); // defense, quantity, durability, max durability, sockets

  function itemPrint(item, withStats) {
    const flags = (item.flags?.names ?? []).map((n) => String(n).toLowerCase());
    const parts = [String(item.codeText || '').toLowerCase(), String(item.quality || '').toLowerCase(), item.itemLevel,
      item.qualityData?.fileIndex ?? '', flags.includes('identified') ? 1 : 0, flags.includes('ethereal') ? 1 : 0,
      (item.sockets ?? []).length];
    if (withStats) {
      parts.push((item.stats ?? []).filter((s) => !VOLATILE_STATS.has(s.id))
        .map((s) => `${s.name || s.id}:${s.layer}:${s.value}`).sort().join(','));
    }
    return parts.join('|');
  }

  // The "sync with trade" button: reload items and listings, re-mark what is in trade, report.
  async function syncTrades() {
    state.syncNotice = null;
    await loadEverything();
    if (state.error) return;
    if (state.mineError) { state.syncNotice = { text: t('syncMineFailed', state.mineError), missing: [] }; render(); return; }
    const open = state.openListings?.length ?? 0;
    const found = state.listedKeys.size;
    const reserved = [...state.listedKeys.values()].filter((l) => l.status === 'Reserved').length;
    const missing = state.unmatchedListings ?? [];
    let text = t('syncDone', open, found)
      + (reserved ? t('syncReserved', reserved) : '') + '.';
    if (missing.length) {
      text += t('syncMissing', missing.length, missing.slice(0, 8).map((l) => l.itemName).join(', ') + (missing.length > 8 ? '…' : ''));
    }
    state.syncNotice = { text, missing };
    render();
  }

  // The "my listings" list may come without the item itself; a listing's own page has it.
  // A listing's item never changes, so it is remembered in this browser (up to 250 listings)
  // and fetched at most once.
  const ITEMDATA_KEY = 'd2r_bt_itemdata';
  let itemDataCache = null;
  let itemDataSaveTimer = null;
  function itemDataStore() {
    if (!itemDataCache) {
      try { itemDataCache = new Map(Object.entries(JSON.parse(localStorage.getItem(ITEMDATA_KEY) || '{}'))); } catch { itemDataCache = new Map(); }
    }
    return itemDataCache;
  }
  function rememberItemData(id, itemData) {
    const store = itemDataStore();
    store.delete(id);
    store.set(id, itemData);
    while (store.size > 250) store.delete(store.keys().next().value);
    clearTimeout(itemDataSaveTimer);
    itemDataSaveTimer = setTimeout(() => {
      try { localStorage.setItem(ITEMDATA_KEY, JSON.stringify(Object.fromEntries(store))); } catch { /* storage full: keep in memory */ }
    }, 1500);
  }
  function applyCachedItemData(listings) {
    for (const l of listings ?? []) {
      if (l.itemData) continue;
      const cached = itemDataStore().get(l.id);
      if (cached) l.itemData = cached;
    }
    return listings;
  }
  async function withItemData(listings) {
    applyCachedItemData(listings);
    const todo = (listings ?? []).filter((l) => !l.itemData);
    let next = 0;
    const worker = async () => {
      while (next < todo.length) {
        const listing = todo[next++];
        try {
          const full = await api(`/trades/${encodeURIComponent(listing.id)}`);
          if (full?.itemData) { listing.itemData = full.itemData; rememberItemData(listing.id, full.itemData); }
        } catch { /* leave it unmatched */ }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    return listings;
  }

  // entries: [{ item }]; returns Map(entry -> listing)
  function matchListings(listings, entries) {
    const result = new Map();
    const pending = [];
    const bySeed = new Map();
    for (const entry of entries) if (entry.item?.seed) bySeed.set(itemSignature(entry.item), entry);
    for (const listing of listings ?? []) {
      let item = null;
      try { item = listing.itemData ? JSON.parse(listing.itemData) : null; } catch { item = null; }
      if (!item) continue;
      const exact = item.seed ? bySeed.get(itemSignature(item)) : null;
      if (exact && !result.has(exact)) result.set(exact, listing);
      else pending.push({ listing, item });
    }
    for (const withStats of [true, false]) {
      const free = new Map();
      for (const entry of entries) {
        if (result.has(entry)) continue;
        const key = itemPrint(entry.item, withStats);
        if (!free.has(key)) free.set(key, []);
        free.get(key).push(entry);
      }
      for (let i = pending.length - 1; i >= 0; i--) {
        const candidates = (free.get(itemPrint(pending[i].item, withStats)) ?? []).filter((e) => !result.has(e));
        // Without stats the attributes are looser, so only a single candidate counts.
        if (candidates.length && (withStats || candidates.length === 1)) {
          result.set(candidates[0], pending[i].listing);
          pending.splice(i, 1);
        }
      }
    }
    return { matches: result, unmatched: pending.map((p) => p.listing) };
  }

  // The game's save has no "picked up at" time, so the extension remembers when it first saw
  // each item (by its unique seed) on a server sync. Items already there on the very first run
  // get time 0 ("before tracking"). Moving an item between characters keeps its seed and time.
  const FIRST_SEEN_KEY = 'd2r_bt_first_seen';
  const LAST_VISIT_KEY = 'd2r_bt_last_visit';

  function trackFirstSeen(rows) {
    const now = Date.now();
    let store = null;
    try { store = JSON.parse(localStorage.getItem(FIRST_SEEN_KEY) || 'null'); } catch { store = null; }
    const firstRun = !store || typeof store.items !== 'object';
    const items = firstRun ? {} : store.items;
    if (state.newSince === null) {
      let last = 0;
      try { last = Number(localStorage.getItem(LAST_VISIT_KEY)) || 0; } catch { /* ignore */ }
      state.newSince = firstRun ? now : last;
      try { localStorage.setItem(LAST_VISIT_KEY, String(now)); } catch { /* ignore */ }
    }
    const present = new Set();
    for (const row of rows) {
      const sig = itemSignature(row.item);
      present.add(sig);
      if (!items[sig]) items[sig] = [firstRun ? 0 : now, now];
      else items[sig][1] = now;
      row.firstSeen = items[sig][0];
      row.isNew = !firstRun && row.firstSeen > 0 && row.firstSeen > state.newSince;
    }
    // Forget items gone for more than 30 days (sold, dropped, used in the cube).
    for (const [sig, value] of Object.entries(items)) {
      if (!present.has(sig) && now - (value?.[1] || 0) > 30 * 86400000) delete items[sig];
    }
    try { localStorage.setItem(FIRST_SEEN_KEY, JSON.stringify({ v: 1, since: store?.since || now, items })); } catch { /* storage full */ }
    state.trackingSince = store?.since || now;
  }

  function seenLabel(row) {
    if (!row.firstSeen) return t('seenBefore');
    const s = (Date.now() - row.firstSeen) / 1000;
    if (s < 3600) return t('minAgo', Math.max(1, Math.floor(s / 60)));
    if (s < 86400) return t('hAgo', Math.floor(s / 3600));
    return new Date(row.firstSeen).toLocaleDateString(I18N?.locale() || 'en-GB', { day: 'numeric', month: 'short' })
      + ' ' + new Date(row.firstSeen).toLocaleTimeString(I18N?.locale() || 'en-GB', { hour: '2-digit', minute: '2-digit' });
  }

  const QUALITY_RANK = { Unique: 0, Set: 1, Runeword: 2, Rare: 3, Crafted: 4, Magic: 5, Unidentified: 6 };
  const SORTS = {
    new: ['sort_new', (a, b) => (b.firstSeen || 0) - (a.firstSeen || 0)],
    name: ['sort_name', (a, b) => a.info.name.localeCompare(b.info.name)],
    quality: ['sort_quality', (a, b) => (QUALITY_RANK[a.info.quality] ?? 9) - (QUALITY_RANK[b.info.quality] ?? 9) || a.info.name.localeCompare(b.info.name)],
    ilvl: ['sort_ilvl', (a, b) => (b.item.itemLevel || 0) - (a.item.itemLevel || 0)],
    place: ['sort_place', () => 0]
  };

  function makeRow(item, source, previous) {
    const key = `${source.sourceKey}|${source.locId}|${itemSignature(item)}`;
    const old = previous.get(key);
    return labelRow({
      key,
      item,
      info: describe(item),
      place: gridPlace(source, item),
      ...source,
      selected: old?.selected ?? false,
      price: old?.price ?? '',
      note: old?.note ?? '',
      status: old?.status ?? '',
      message: old?.message ?? '',
      listingId: old?.listingId ?? null
    });
  }

  function isListed(row) {
    return row.status === 'ok' || state.listedKeys.has(itemSignature(row.item));
  }

  // In the grid view listed items stay bright and carry an "IN TRADE" label instead of fading out.
  function visibleRows() {
    const f = state.filters;
    const words = f.search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const hideListed = f.hideListed && state.settings.view !== 'grid';
    return state.rows.filter((row) => {
      if (f.source && row.sourceKey !== f.source) return false;
      if (f.quality && row.info.quality !== f.quality) return false;
      if (f.location && row.locId !== f.location) return false;
      if (hideListed && isListed(row) && row.status !== 'ok') return false;
      if (f.notInTradeOnly && isListed(row)) return false;
      if (f.identifiedOnly && !row.info.identified) return false;
      if (f.selectedOnly && !row.selected) return false;
      if (f.newOnly && !row.isNew) return false;
      if (words.length) {
        const text = `${row.info.search} ${row.sourceLabel} ${row.location}`.toLowerCase();
        if (!words.every((w) => text.includes(w))) return false;
      }
      return true;
    });
  }

  // ---------- Building and sending listings ----------

  function buildListing(row) {
    const s = state.settings;
    const info = row.info;
    const gameMode = row.gameMode || s.gameMode || null;
    const isHardcore = row.isHardcore ?? (s.isHardcore === 'true' ? true : s.isHardcore === 'false' ? false : null);
    if (!gameMode) throw new Error(t('needGameMode'));
    if (isHardcore === null) throw new Error(t('needHardcore'));
    const price = (row.price || s.price || '').trim();
    const note = (row.note || s.note || '').trim();
    const name = info.name.slice(0, 120);
    return {
      characterId: row.origin === 'character' ? row.characterId : null,
      ladderId: state.ladderId || null,
      title: (info.identified ? `${name} for trade` : `Unidentified ${name} for trade`).slice(0, 120),
      itemName: name,
      description: note ? note.slice(0, 4000) : null,
      itemData: JSON.stringify(row.item),
      itemCode: row.item.codeText,
      itemQuality: info.quality,
      itemType: info.itemType || null,
      requiredLevel: info.requiredLevel,
      itemLevel: row.item.itemLevel,
      socketCount: info.sockets,
      isEthereal: info.isEthereal,
      isCorrupted: info.isCorrupted,
      isLadder: Boolean(state.ladderId),
      gameMode,
      isHardcore,
      price: price ? price.slice(0, 500) : null,
      isNegotiable: Boolean(s.negotiable)
    };
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function submitSelected() {
    const queue = state.rows.filter((r) => r.selected && r.status !== 'ok');
    if (!queue.length || state.running) return;
    const ladder = state.ladders.find((l) => l.id === state.ladderId);
    const lines = queue.slice(0, 25).map((r, i) => `${i + 1}. ${r.info.name} — ${(r.price || state.settings.price || t('noPrice')).trim()}`);
    if (queue.length > 25) lines.push(t('andMore', queue.length - 25));
    const already = queue.filter((r) => state.listedKeys.has(itemSignature(r.item))).length;
    const noPrice = queue.filter((r) => !(r.price || state.settings.price || '').trim()).length;
    const ok = window.confirm(
      `${t('confirmList', queue.length)}\n` +
      `${t('confirmLadder', ladder ? ladder.name : t('nonLadder'))}\n` +
      (already ? `${t('confirmDupes', already)}\n` : '') +
      (noPrice ? `${t('confirmNoPrice', noPrice)}\n` : '') +
      `\n${lines.join('\n')}\n\n${t('confirmPublic')}`
    );
    if (!ok) return;

    state.running = true;
    state.stopRequested = false;
    for (const row of queue) { row.status = 'queued'; row.message = ''; }
    render();
    const delayMs = Math.max(0.5, Number(state.settings.delay) || 2) * 1000;
    for (let i = 0; i < queue.length; i++) {
      const row = queue[i];
      if (state.stopRequested) { row.status = ''; row.message = t('stopped'); continue; }
      row.status = 'sending';
      updateRow(row);
      try {
        const listing = await api('/trades', { method: 'POST', body: JSON.stringify(buildListing(row)) });
        row.status = 'ok';
        row.listingId = listing?.id ?? null;
        row.message = t('listedOk');
        row.selected = false;
        state.listedKeys.set(itemSignature(row.item), listing || { status: 'Active', price: buildListing(row).price });
      } catch (error) {
        row.status = 'error';
        row.message = error.message || String(error);
        if (error.status === 401) state.stopRequested = true;
      }
      updateRow(row);
      updateFooter();
      if (i < queue.length - 1 && !state.stopRequested) await sleep(delayMs);
    }
    for (const row of queue) if (row.status === 'queued') row.status = '';
    state.running = false;
    render();
  }

  // ---------- UI ----------

  const QUALITY_COLORS = {
    Unique: '#c7b377', Set: '#1ec81e', Rare: '#ffff64', Magic: '#7878ff', Runeword: '#c7b377',
    Crafted: '#ffa800', Unidentified: '#d05050'
  };

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
    .fab { position: fixed; left: 18px; bottom: 18px; z-index: 2147483646; background: #b4561c; color: #fff;
      border: 0; border-radius: 999px; padding: 12px 18px; font-size: 14px; font-weight: 600; cursor: pointer;
      box-shadow: 0 4px 16px rgba(0,0,0,.5); }
    .fab:hover { background: #d0682a; }
    .overlay { position: fixed; inset: 0; z-index: 2147483647; background: rgba(0,0,0,.7); display: flex; }
    .panel { margin: auto; width: min(1280px, 100vw - 24px); height: calc(100vh - 24px); background: #141418; color: #e8e2d4;
      border: 1px solid #3a3530; border-radius: 10px; display: flex; flex-direction: column; overflow: hidden; font-size: 13px; }
    header, .bar, footer { padding: 10px 14px; border-bottom: 1px solid #2c2925; display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
    footer { border-bottom: 0; border-top: 1px solid #2c2925; }
    h2 { margin: 0; font-size: 17px; color: #f0b070; margin-right: auto; }
    label { display: inline-flex; align-items: center; gap: 6px; color: #bdb5a4; }
    input[type=text], input[type=number], select, textarea { background: #0d0d10; color: #eee; border: 1px solid #3a3530; border-radius: 5px;
      padding: 5px 7px; font-size: 13px; }
    input[type=text]:focus, textarea:focus, select:focus { outline: 1px solid #b4561c; }
    button { background: #2a2622; color: #eee; border: 1px solid #4a433b; border-radius: 5px; padding: 6px 11px; cursor: pointer; font-size: 13px; }
    button:hover:not(:disabled) { background: #3a342e; }
    button:disabled { opacity: .45; cursor: default; }
    button.primary { background: #b4561c; border-color: #b4561c; font-weight: 600; }
    button.primary:hover:not(:disabled) { background: #d0682a; }
    .close { font-size: 18px; padding: 2px 10px; }
    .list { flex: 1; overflow: auto; }
    table { width: 100%; border-collapse: collapse; }
    th { position: sticky; top: 0; background: #1c1b1f; text-align: left; font-weight: 600; color: #bdb5a4; padding: 7px 8px; z-index: 1; }
    td { padding: 5px 8px; border-top: 1px solid #222; vertical-align: middle; }
    tr.sel td { background: #241d16; }
    tr.done td { opacity: .75; }
    .img { width: 34px; height: 34px; object-fit: contain; image-rendering: auto; }
    .name { font-weight: 600; }
    .meta { color: #8f887a; font-size: 12px; }
    .tag { display: inline-block; font-size: 11px; padding: 0 5px; border-radius: 3px; background: #2e2a26; color: #c9c0ae; margin-left: 4px; }
    .tag.listed { background: #1d3320; color: #8fd99a; }
    td input[type=text] { width: 100%; min-width: 110px; }
    .st { font-size: 12px; max-width: 260px; }
    .st.ok { color: #7ee08a; } .st.error { color: #ff8a80; } .st.sending { color: #f0c060; } .st.queued { color: #9aa; }
    .st a { color: #f0b070; }
    .err { background: #3a1414; color: #ffb4b4; padding: 10px 14px; border-bottom: 1px solid #5a2020; }
    .notice { background: #16301b; color: #a8e8b0; padding: 8px 14px; border-bottom: 1px solid #24502c; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .empty { padding: 40px; text-align: center; color: #8f887a; }
    .count { margin-right: auto; color: #bdb5a4; }
    .grow { flex: 1; min-width: 180px; }
    .hint { color: #8f887a; font-size: 12px; }
    .main { flex: 1; display: flex; overflow: hidden; min-height: 0; }
    .seg { display: inline-flex; border: 1px solid #4a433b; border-radius: 5px; overflow: hidden; }
    .seg button { border: 0; border-radius: 0; }
    .seg button.on { background: #b4561c; }
    .seg.lang button { padding: 4px 9px; font-size: 12px; font-weight: 600; }
    .pc-back { position: fixed; inset: 0; z-index: 2147483647; background: rgba(0,0,0,.55); display: flex; }
    .pc { margin: auto; width: min(820px, 100vw - 40px); max-height: calc(100vh - 60px); background: #17161b; color: #e8e2d4;
      border: 1px solid #4a433b; border-radius: 10px; display: flex; flex-direction: column; overflow: hidden; font-size: 13px;
      box-shadow: 0 10px 40px rgba(0,0,0,.7); }
    .pc-list { overflow: auto; padding: 4px 14px 10px; }
    .pc-row { display: flex; gap: 10px; align-items: flex-start; padding: 8px 6px; border-bottom: 1px solid #26232a; }
    .pc-row.mine { background: rgba(50, 120, 60, .18); }
    .pc-row .img { width: 34px; height: 34px; flex: none; }
    .pc-body { flex: 1; min-width: 0; }
    .pc-stats { color: #8080ff; font-size: 12px; margin: 2px 0; }
    .pc-price { color: #f0b070; font-weight: 700; font-size: 14px; text-align: right; max-width: 260px; display: flex; gap: 8px;
      align-items: flex-start; justify-content: flex-end; word-break: break-word; }
    .pc-price a { font-weight: 400; font-size: 12px; padding: 2px 7px; }
    a.btn { color: #eee; text-decoration: none; border: 1px solid #4a433b; border-radius: 5px; background: #2a2622; }
    .grids { flex: 1; overflow: auto; padding: 12px 14px; }
    .src { margin-bottom: 18px; }
    .src h3 { margin: 0 0 8px; font-size: 14px; color: #f0b070; font-weight: 600; }
    .groups { display: flex; flex-wrap: wrap; gap: 14px; align-items: flex-start; }
    .grp-title { font-size: 12px; color: #8f887a; margin-bottom: 4px; }
    .grid { position: relative; background-color: #0b0b0e; border: 1px solid #3a3530;
      background-image: linear-gradient(#26231f 1px, transparent 1px), linear-gradient(90deg, #26231f 1px, transparent 1px); }
    .strip { display: flex; flex-wrap: wrap; gap: 4px; max-width: 420px; }
    .strip .it { position: relative; }
    .it { position: absolute; display: flex; align-items: center; justify-content: center; cursor: pointer;
      background: rgba(30, 28, 40, .55); border: 1px solid var(--q, #555); border-radius: 2px; }
    .it img { max-width: 100%; max-height: 100%; object-fit: contain; pointer-events: none; }
    .it .lbl { font-size: 9px; color: var(--q, #ccc); text-align: center; overflow: hidden; padding: 1px; pointer-events: none; }
    .it:hover { background: rgba(80, 70, 50, .6); }
    .it.sel { outline: 2px solid #ff8c2e; outline-offset: -2px; background: rgba(180, 86, 28, .45); }
    .it.listed { border: 2px solid #3fcf5a; background: rgba(30, 110, 50, .45); }
    .it.listed.reserved { border-color: #f0c060; background: rgba(120, 90, 20, .45); }
    .it .flag { position: absolute; top: 0; left: 0; right: 0; background: rgba(25, 125, 50, .95); color: #fff; font-size: 8.5px;
      font-weight: 800; letter-spacing: .2px; text-align: center; line-height: 12px; white-space: nowrap; overflow: hidden; pointer-events: none;
      text-shadow: 0 1px 1px rgba(0,0,0,.6); }
    .it.reserved .flag { background: rgba(175, 125, 15, .97); }
    .it .flag.narrow { font-size: 7px; letter-spacing: -.2px; line-height: 11px; }
    .it .flag.newf { background: rgba(40, 110, 220, .95); }
    .it.isnew { border: 2px solid #4a90ff; }
    .tag.new { background: #1f4fa8; color: #fff; font-weight: 700; margin-left: 0; }
    .it.ok { outline: 2px solid #3fcf5a; outline-offset: -2px; }
    .it.err { outline: 2px solid #ff5a50; outline-offset: -2px; }
    .it.dim { opacity: .18; }
    .side { width: 360px; border-left: 1px solid #2c2925; overflow: auto; padding: 10px 12px; background: #111114; }
    .side h3 { margin: 0 0 8px; font-size: 14px; color: #f0b070; }
    .card { border: 1px solid #2c2925; border-radius: 6px; padding: 7px 8px; margin-bottom: 7px; background: #17161a; }
    .card .top { display: flex; gap: 6px; align-items: flex-start; }
    .card .top .name { flex: 1; }
    .card input[type=text] { width: 100%; margin-top: 5px; }
    .card .x { padding: 0 7px; font-size: 14px; }
    .legend { color: #8f887a; font-size: 12px; margin-bottom: 10px; }
    .tip { position: fixed; z-index: 2147483647; pointer-events: none; max-width: 340px; background: rgba(8, 8, 10, .96);
      border: 1px solid #4a433b; border-radius: 4px; padding: 8px 10px; text-align: center; font-size: 12.5px; line-height: 1.4; display: none; }
    .tip .tn { font-weight: 700; font-size: 13.5px; }
    .tip .tb { color: #bdb5a4; }
    .tip .tm { color: #9a9282; font-size: 11.5px; }
    .tip .magic { color: #8080ff; } .tip .enchant { color: #e0a040; } .tip .corrupted { color: #ff5050; }
    .tip .loc { color: #8f887a; font-size: 11.5px; margin-top: 4px; }
    .tip .lst { color: #7ee08a; font-size: 11.5px; }
  `;

  let host = null;
  let root = null;
  let open = false;
  const ui = {};

  function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = Boolean(v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const child of children.flat()) {
      if (child === null || child === undefined || child === false) continue;
      el.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return el;
  }

  function ensureHost() {
    if (host && document.body.contains(host)) return;
    host = document.createElement('div');
    host.id = 'd2r-bulk-trade';
    root = host.attachShadow({ mode: 'open' });
    root.append(h('style', {}, CSS));
    ui.fab = h('button', { class: 'fab', onclick: openPanel }, t('fabBulk'));
    ui.overlay = h('div', { class: 'overlay', style: 'display:none', onclick: (e) => { if (e.target === ui.overlay && !state.running) closePanel(); } });
    root.append(ui.fab, ui.overlay);
    document.body.append(host);
  }

  function syncFab() {
    ensureHost();
    const onTrade = location.pathname.startsWith('/trade');
    ui.fab.style.display = onTrade && !open ? '' : 'none';
  }

  function openPanel() {
    open = true;
    ui.overlay.style.display = '';
    syncFab();
    // Reopening reuses data loaded in the last 3 minutes (the inventory is megabytes);
    // the Sync button always reloads.
    const stale = !state.rows.length || Date.now() - (state.loadedAt || 0) > 180000;
    if (stale && !state.loading && !state.running) loadEverything(); else render();
  }

  function closePanel() {
    open = false;
    ui.overlay.style.display = 'none';
    syncFab();
  }

  function sourceOptions() {
    const seen = new Map();
    for (const row of state.rows) if (!seen.has(row.sourceKey)) seen.set(row.sourceKey, row.sourceLabel);
    return [...seen];
  }

  function uniqueValues(field) {
    return [...new Set(state.rows.map(field))].filter(Boolean).sort();
  }

  function render() {
    if (!root) return;
    const s = state.settings;
    const f = state.filters;
    const busy = state.running || state.loading;
    const panel = h('div', { class: 'panel' });

    panel.append(h('header', {},
      h('h2', {}, t('bulkTitle'), h('span', { class: 'hint', style: 'margin-left:8px;font-weight:400' }, `v${extensionVersion()}`)),
      I18N ? I18N.switcher() : null,
      h('label', {}, t('ladder'),
        h('select', { disabled: busy, onchange: (e) => { state.ladderId = e.target.value; state.rows = []; loadEverything(); } },
          ...state.ladders.map((l) => h('option', { value: l.id, selected: l.id === state.ladderId }, l.name)),
          h('option', { value: '', selected: !state.ladderId }, t('nonLadderOpt')))),
      h('button', { class: 'primary', disabled: busy, onclick: syncTrades,
        title: t('syncTitle') },
      state.loading ? t('syncing') : t('syncBtn')),
      h('button', { class: 'close', title: t('close'), disabled: state.running, onclick: closePanel }, '×')
    ));

    panel.append(h('div', { class: 'bar' },
      h('label', { class: 'grow' }, t('priceAll'),
        h('input', { type: 'text', class: 'grow', maxlength: '500', placeholder: t('pricePh'), value: s.price,
          oninput: (e) => { s.price = e.target.value; saveSettings(); refreshPlaceholders(); } })),
      h('label', { class: 'grow' }, t('noteAll'),
        h('input', { type: 'text', class: 'grow', maxlength: '4000', placeholder: t('optional'), value: s.note,
          oninput: (e) => { s.note = e.target.value; saveSettings(); refreshPlaceholders(); } })),
      h('label', {}, h('input', { type: 'checkbox', checked: s.negotiable, onchange: (e) => { s.negotiable = e.target.checked; saveSettings(); } }), t('negotiable')),
      h('label', { title: t('fromSaveHint') }, t('game'),
        h('select', { onchange: (e) => { s.gameMode = e.target.value; saveSettings(); } },
          h('option', { value: '', selected: !s.gameMode }, '—'),
          h('option', { value: 'RotW', selected: s.gameMode === 'RotW' }, 'Reign of the Warlock'),
          h('option', { value: 'Expansion', selected: s.gameMode === 'Expansion' }, 'Expansion'))),
      h('label', { title: t('fromSaveHint') }, 'SC/HC',
        h('select', { onchange: (e) => { s.isHardcore = e.target.value; saveSettings(); } },
          h('option', { value: '', selected: s.isHardcore === '' }, '—'),
          h('option', { value: 'false', selected: s.isHardcore === 'false' }, 'Softcore'),
          h('option', { value: 'true', selected: s.isHardcore === 'true' }, 'Hardcore'))),
      h('label', { title: t('delayHint') }, t('delay'),
        h('input', { type: 'number', min: '0.5', step: '0.5', style: 'width:60px', value: s.delay,
          oninput: (e) => { s.delay = e.target.value; saveSettings(); } }))
    ));

    const setView = (view) => { s.view = view; saveSettings(); render(); };
    panel.append(h('div', { class: 'bar' },
      h('span', { class: 'seg' },
        h('button', { class: s.view === 'grid' ? 'on' : '', onclick: () => setView('grid') }, t('viewGrid')),
        h('button', { class: s.view === 'list' ? 'on' : '', onclick: () => setView('list') }, t('viewList'))),
      h('input', { type: 'text', class: 'grow', placeholder: t('searchPh'), value: f.search,
        oninput: (e) => { f.search = e.target.value; clearTimeout(ui.searchTimer); ui.searchTimer = setTimeout(renderList, 220); } }),
      h('select', { onchange: (e) => { f.source = e.target.value; renderList(); } },
        h('option', { value: '' }, t('allSources')),
        ...sourceOptions().map(([k, label]) => h('option', { value: k, selected: f.source === k }, label))),
      h('select', { onchange: (e) => { f.quality = e.target.value; renderList(); } },
        h('option', { value: '' }, t('anyQuality')),
        ...uniqueValues((r) => r.info.quality).map((q) => h('option', { value: q, selected: f.quality === q }, q))),
      h('select', { onchange: (e) => { f.location = e.target.value; renderList(); } },
        h('option', { value: '' }, t('anyPlace')),
        ...uniqueValues((r) => r.locId).map((q) => h('option', { value: q, selected: f.location === q }, locName(q)))),
      s.view === 'grid' ? null
        : h('label', {}, h('input', { type: 'checkbox', checked: f.hideListed, onchange: (e) => { f.hideListed = e.target.checked; renderList(); } }), t('hideListed')),
      h('label', {}, h('input', { type: 'checkbox', checked: f.identifiedOnly, onchange: (e) => { f.identifiedOnly = e.target.checked; renderList(); } }), t('identifiedOnly')),
      h('label', {}, h('input', { type: 'checkbox', checked: f.selectedOnly, onchange: (e) => { f.selectedOnly = e.target.checked; renderList(); } }), t('selectedOnly')),
      h('label', {}, h('input', { type: 'checkbox', checked: f.notInTradeOnly, onchange: (e) => { f.notInTradeOnly = e.target.checked; renderList(); } }), t('notInTradeOnly')),
      h('label', { title: t('newOnlyHint') },
        h('input', { type: 'checkbox', checked: f.newOnly, onchange: (e) => { f.newOnly = e.target.checked; renderList(); } }),
        t('newOnly', state.rows.filter((r) => r.isNew).length)),
      s.view === 'list' ? h('label', {}, t('sort'),
        h('select', { onchange: (e) => { s.sort = e.target.value; saveSettings(); renderList(); } },
          ...Object.entries(SORTS).map(([id, [label]]) => h('option', { value: id, selected: s.sort === id }, t(label))))) : null
    ));

    if (state.error) panel.append(h('div', { class: 'err' }, state.error));
    if (state.syncNotice && !state.error) {
      const n = state.syncNotice;
      panel.append(h('div', { class: 'notice' },
        h('span', {}, n.text),
        n.missing.length && window.__d2rTradeOpenMissing
          ? h('button', { style: 'margin-left:10px', onclick: () => { closePanel(); window.__d2rTradeOpenMissing(); } }, t('showMissing'))
          : null,
        h('button', { class: 'close', style: 'margin-left:auto', title: t('hide'), onclick: () => { state.syncNotice = null; render(); } }, '×')));
    }
    ui.main = h('div', { class: 'main' });
    if (s.view === 'grid') {
      ui.list = null;
      ui.grids = h('div', { class: 'grids' });
      ui.side = h('div', { class: 'side' });
      ui.main.append(ui.grids, ui.side);
    } else {
      ui.grids = ui.side = null;
      ui.list = h('div', { class: 'list' });
      ui.main.append(ui.list);
    }
    panel.append(ui.main);

    ui.count = h('span', { class: 'count' });
    ui.selectVisible = h('button', { disabled: busy, onclick: () => { for (const r of visibleRows()) if (r.status !== 'ok') r.selected = true; renderList(); } }, t('selectVisible'));
    ui.clear = h('button', { disabled: busy, onclick: () => { for (const r of state.rows) r.selected = false; renderList(); } }, t('clearSel'));
    ui.stop = h('button', { disabled: !state.running, onclick: () => { state.stopRequested = true; ui.stop.disabled = true; } }, t('stop'));
    ui.submit = h('button', { class: 'primary', onclick: submitSelected });
    panel.append(h('footer', {}, ui.count, ui.selectVisible, ui.clear, ui.stop, ui.submit));

    ui.tip = h('div', { class: 'tip' });
    ui.overlay.replaceChildren(panel, ui.tip);
    renderList();
  }

  // ---------- Tooltip ----------

  function showTip(row, event) {
    if (!ui.tip) return;
    const parts = tipParts(row.info, row.item);
    parts.push(h('div', { class: 'loc' }, `${row.sourceLabel} — ${row.location}`));
    parts.push(h('div', { class: 'loc', style: row.isNew ? 'color:#7fb0ff' : '' }, `${row.isNew ? 'NEW · ' : ''}${t('tipAppeared', seenLabel(row))}`));
    if (state.settings.view === 'grid') parts.push(h('div', { class: 'loc', style: 'color:#f0b070' }, t('pcHint')));
    const listing = state.listedKeys.get(itemSignature(row.item));
    if (listing) {
      parts.push(h('div', { class: 'lst', style: listing.status === 'Reserved' ? 'color:#f0c060' : '' },
        t(listing.status === 'Reserved' ? 'tipReserved' : 'tipListed', listing.price || t('noPrice'))
        + (listing.offerCount ? t('tipOffers', listing.offerCount) : '')));
    }
    ui.tip.replaceChildren(...parts);
    ui.tip.style.display = 'block';
    moveTip(event);
  }

  // The game-style item description: name, base, stats, sockets.
  function tipParts(info, item) {
    const color = QUALITY_COLORS[info.quality] || '#ddd';
    const parts = [h('div', { class: 'tn', style: `color:${color}` }, info.name)];
    if (info.name !== info.baseName) parts.push(h('div', { class: 'tb' }, info.baseName));
    parts.push(h('div', { class: 'tm' }, [info.quality, `ilvl ${item.itemLevel}`, info.requiredLevel ? t('reqLvl', info.requiredLevel) : null,
      item.quantity ? `x${item.quantity}` : null].filter(Boolean).join(' · ')));
    if (item.defense) parts.push(h('div', { class: 'tb' }, `Defense: ${item.defense}`));
    for (const l of info.lines) parts.push(h('div', { class: l.tone || 'magic' }, l.text));
    if (!info.identified) parts.push(h('div', { class: 'corrupted' }, 'Unidentified'));
    if (info.isEthereal || info.sockets) {
      parts.push(h('div', { class: 'tb' }, [info.isEthereal ? 'Ethereal' : null, info.sockets ? `Socketed (${info.sockets})` : null].filter(Boolean).join(', ')));
    }
    if (info.socketed.length) parts.push(h('div', { class: 'tm' }, t('socketedIn', info.socketed.join(', '))));
    return parts;
  }

  function moveTip(event, tip = ui.tip) {
    if (!tip || tip.style.display === 'none') return;
    const pad = 16;
    const rect = tip.getBoundingClientRect();
    let x = event.clientX + pad;
    let y = event.clientY + pad;
    if (x + rect.width > window.innerWidth - 4) x = event.clientX - rect.width - pad;
    if (y + rect.height > window.innerHeight - 4) y = Math.max(4, window.innerHeight - rect.height - 4);
    tip.style.left = `${Math.max(4, x)}px`;
    tip.style.top = `${y}px`;
  }

  function hideTip() {
    if (ui.tip) ui.tip.style.display = 'none';
  }

  function withTip(el, row) {
    el.addEventListener('mouseenter', (e) => showTip(row, e));
    el.addEventListener('mousemove', moveTip);
    el.addEventListener('mouseleave', hideTip);
    return el;
  }

  // ---------- Grid (inventory) view ----------

  const CELL = 34;

  function extensionVersion() {
    try { return chrome.runtime.getManifest().version; } catch { return 'test'; }
  }

  function listedSummary() {
    if (state.mineError) return t('summaryFailed', state.mineError);
    const open = state.openListings?.length ?? 0;
    const found = state.rows.filter((r) => listingOf(r)).length;
    const lost = state.unmatchedListings ?? [];
    let text = t('summary', open, found);
    if (lost.length) {
      text += t('summaryLost', lost.length)
        + lost.slice(0, 6).map((l) => l.itemName).join(', ') + (lost.length > 6 ? '…' : '');
    }
    return text;
  }

  function listingOf(row) {
    return state.listedKeys.get(itemSignature(row.item)) || null;
  }

  function toggleRow(row) {
    if (state.running || row.status === 'ok') return;
    row.selected = !row.selected;
    updateRow(row);
    renderSide();
    updateFooter();
  }

  function cellClass(row, visible) {
    return ['it',
      row.selected ? 'sel' : '',
      row.status === 'ok' ? 'ok' : row.status === 'error' ? 'err' : '',
      listingOf(row) ? (listingOf(row).status === 'Reserved' ? 'listed reserved' : 'listed') : (row.isNew ? 'isnew' : ''),
      visible ? '' : 'dim'].filter(Boolean).join(' ');
  }

  function tradeFlag(row) {
    const listing = listingOf(row);
    const wide = row.info.width > 1;
    if (!listing) return row.isNew ? h('div', { class: wide ? 'flag newf' : 'flag newf narrow' }, 'NEW') : null;
    const text = listing.status === 'Reserved' ? (wide ? 'PENDING' : 'PEND') : (wide ? 'IN TRADE' : 'TRADE');
    return h('div', { class: wide ? 'flag' : 'flag narrow' }, text);
  }

  function renderCell(row, visible, inGrid) {
    const info = row.info;
    const style = [`--q:${QUALITY_COLORS[info.quality] || '#6a6a6a'}`];
    const w = info.width * CELL - 2;
    const hgt = info.height * CELL - 2;
    if (inGrid) style.push(`left:${row.place.x * CELL + 1}px`, `top:${row.place.y * CELL + 1}px`);
    style.push(`width:${w}px`, `height:${hgt}px`);
    const el = h('div', { class: cellClass(row, visible), style: style.join(';'),
      onclick: () => { if (row.visible) toggleRow(row); },
      oncontextmenu: (e) => { e.preventDefault(); priceCheckRow(row); } },
      info.sprite ? h('img', { src: `/data/${info.sprite}`, alt: '', loading: 'lazy' }) : h('div', { class: 'lbl' }, info.name),
      tradeFlag(row));
    row.visible = visible;
    row.cell = el;
    return withTip(el, row);
  }

  function renderGrids() {
    const visible = new Set(visibleRows());
    const f = state.filters;
    const sources = new Map();
    for (const row of state.rows) {
      if (f.source && row.sourceKey !== f.source) continue;
      if (f.location && row.locId !== f.location) continue;
      if (!sources.has(row.sourceKey)) sources.set(row.sourceKey, { label: row.sourceLabel, groups: new Map() });
      const groups = sources.get(row.sourceKey).groups;
      if (!groups.has(row.place.groupKey)) groups.set(row.place.groupKey, { place: row.place, rows: [] });
      groups.get(row.place.groupKey).rows.push(row);
    }
    if (!sources.size) {
      ui.grids.replaceChildren(h('div', { class: 'empty' }, state.rows.length ? t('noMatch')
        : t('noItems')));
      return;
    }
    const order = (g) => { const i = GROUP_ORDER.indexOf(g.place.groupId); return i < 0 ? 100 : i; };
    const blocks = [h('div', { class: 'legend' },
      t('legendClick'),
      h('span', { style: 'color:#7ee08a;font-weight:600' }, 'IN TRADE'), t('legendTrade'),
      h('span', { style: 'color:#f0c060;font-weight:600' }, 'PENDING'), t('legendPending'),
      h('div', { class: 'hint', style: 'margin-top:4px' }, listedSummary()))];
    for (const { label, groups } of sources.values()) {
      const list = [...groups.values()].sort((a, b) => order(a) - order(b)
        || a.place.groupId.localeCompare(b.place.groupId, 'en', { numeric: true }));
      blocks.push(h('div', { class: 'src' }, h('h3', {}, label), h('div', { class: 'groups' }, list.map(({ place, rows }) => {
        if (!place.isGrid) {
          return h('div', {}, h('div', { class: 'grp-title' }, locName(place.groupId)),
            h('div', { class: 'strip' }, rows.map((r) => renderCell(r, visible.has(r), false))));
        }
        let cols = place.minSize[0];
        let rowsN = place.minSize[1];
        for (const r of rows) {
          cols = Math.max(cols, r.place.x + r.info.width);
          rowsN = Math.max(rowsN, r.place.y + r.info.height);
        }
        const grid = h('div', { class: 'grid', style: `width:${cols * CELL + 2}px;height:${rowsN * CELL + 2}px;background-size:${CELL}px ${CELL}px;background-position:1px 1px` },
          rows.map((r) => renderCell(r, visible.has(r), true)));
        return h('div', {}, h('div', { class: 'grp-title' }, locName(place.groupId)), grid);
      }))));
    }
    const scroll = ui.grids.scrollTop;
    ui.grids.replaceChildren(...blocks);
    ui.grids.scrollTop = scroll;
  }

  function renderCard(row) {
    const info = row.info;
    const lock = state.running || row.status === 'ok';
    const card = h('div', { class: 'card' },
      h('div', { class: 'top' },
        withTip(h('div', { class: 'name', style: `color:${QUALITY_COLORS[info.quality] || '#ddd'}` }, info.name,
          h('div', { class: 'meta' }, `${row.sourceLabel.split(' (')[0]} · ${row.location}`)), row),
        h('button', { class: 'x', title: t('pcBtn'), onclick: () => priceCheckRow(row) }, '🔍'),
        h('button', { class: 'x', title: t('removeSel'), disabled: lock, onclick: () => toggleRow(row) }, '×')),
      h('input', { type: 'text', maxlength: '500', value: row.price, disabled: lock, placeholder: state.settings.price ? t('pricePhAll', state.settings.price) : t('pricePhEmpty'),
        oninput: (e) => { row.price = e.target.value; } }),
      h('input', { type: 'text', maxlength: '4000', value: row.note, disabled: lock, placeholder: state.settings.note ? t('notePhAll', state.settings.note) : t('note'),
        oninput: (e) => { row.note = e.target.value; } }),
      rowStatus(row));
    row.card = card;
    return card;
  }

  function renderSide() {
    if (!ui.side) return;
    const rows = state.rows.filter((r) => r.selected || (r.status && r.status !== '') || r.message);
    const scroll = ui.side.scrollTop;
    ui.side.replaceChildren(h('h3', {}, t('selectedHead', state.rows.filter((r) => r.selected && r.status !== 'ok').length)),
      rows.length ? h('div', {}, rows.map(renderCard))
        : h('div', { class: 'hint' }, t('sideHint')));
    ui.side.scrollTop = scroll;
  }

  function rowStatus(row) {
    const cell = h('div', { class: `st ${row.status}` });
    if (row.status === 'ok') {
      cell.append('✓ ');
      cell.append(row.listingId ? h('a', { href: `/trade/${row.listingId}`, target: '_blank' }, t('listedOk')) : t('listedOk'));
    } else if (row.status === 'sending') cell.append(t('stSending'));
    else if (row.status === 'queued') cell.append(t('stQueued'));
    else if (row.status === 'error') cell.append('✗ ' + row.message);
    else if (row.message) cell.append(row.message);
    return cell;
  }

  function renderRow(row) {
    const info = row.info;
    const listed = state.listedKeys.has(itemSignature(row.item));
    const lockInputs = state.running || row.status === 'ok';
    const tr = h('tr', { class: [row.selected ? 'sel' : '', row.status === 'ok' ? 'done' : ''].join(' ') },
      h('td', {}, h('input', { type: 'checkbox', checked: row.selected, disabled: lockInputs,
        onchange: (e) => { row.selected = e.target.checked; tr.classList.toggle('sel', row.selected); updateFooter(); } })),
      h('td', {}, info.sprite ? h('img', { class: 'img', src: `/data/${info.sprite}`, alt: '', loading: 'lazy' }) : ''),
      withTip(h('td', {},
        h('div', { class: 'name', style: `color:${QUALITY_COLORS[info.quality] || '#ddd'}` }, info.name,
          listed ? h('span', { class: 'tag listed' }, t('tagListed')) : null,
          h('button', { class: 'x', style: 'margin-left:6px', title: t('pcBtn'), onclick: (e) => { e.stopPropagation(); priceCheckRow(row); } }, '🔍')),
        h('div', { class: 'meta' },
          [info.quality, info.name !== info.baseName ? info.baseName : null, `ilvl ${row.item.itemLevel}`,
            info.requiredLevel ? t('req', info.requiredLevel) : null,
            info.sockets ? t('sockN', info.sockets) : null, info.isEthereal ? 'eth' : null, info.isCorrupted ? 'corrupted' : null,
            row.item.quantity ? `x${row.item.quantity}` : null].filter(Boolean).join(' · ')),
        info.lines.length ? h('div', { class: 'meta', style: 'color:#8080ff' }, info.lines.slice(0, 3).map((l) => l.text).join(' · ') + (info.lines.length > 3 ? ' …' : '')) : null), row),
      h('td', {}, h('div', {}, row.sourceLabel), h('div', { class: 'meta' }, row.location)),
      h('td', { class: 'meta', style: 'white-space:nowrap' }, row.isNew ? h('span', { class: 'tag new' }, 'NEW') : null, ' ', seenLabel(row)),
      h('td', {}, h('input', { type: 'text', 'data-kind': 'price', maxlength: '500', value: row.price, disabled: lockInputs,
        placeholder: state.settings.price || t('price'),
        oninput: (e) => { row.price = e.target.value; if (e.target.value && !row.selected) { row.selected = true; tr.classList.add('sel'); tr.querySelector('input[type=checkbox]').checked = true; updateFooter(); } } })),
      h('td', {}, h('input', { type: 'text', 'data-kind': 'note', maxlength: '4000', value: row.note, disabled: lockInputs,
        placeholder: state.settings.note || t('note'), oninput: (e) => { row.note = e.target.value; } })),
      h('td', {}, rowStatus(row))
    );
    row.tr = tr;
    return tr;
  }

  function renderList() {
    hideTip();
    if (ui.grids) {
      if (state.loading && !state.rows.length) ui.grids.replaceChildren(h('div', { class: 'empty' }, t('loadingInv')));
      else renderGrids();
      renderSide();
      updateFooter();
      return;
    }
    if (!ui.list) return;
    if (state.loading && !state.rows.length) {
      ui.list.replaceChildren(h('div', { class: 'empty' }, t('loadingInv')));
    } else {
      const rows = visibleRows();
      const sorter = SORTS[state.settings.sort]?.[1];
      if (sorter && state.settings.sort !== 'place') rows.sort((a, b) => sorter(a, b) || 0);
      if (!rows.length) {
        ui.list.replaceChildren(h('div', { class: 'empty' }, state.rows.length
          ? t('noMatch')
          : t('noItems')));
      } else {
        const table = h('table', {},
          h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, ''), h('th', {}, t('colItem', rows.length)), h('th', {}, t('colWhere')), h('th', {}, t('colAppeared')),
            h('th', {}, t('colPrice')), h('th', {}, t('colNote')), h('th', {}, t('colStatus')))),
          h('tbody', {}, rows.map(renderRow)));
        ui.list.replaceChildren(table);
      }
    }
    updateFooter();
  }

  function updateRow(row) {
    if (row.tr && row.tr.isConnected) row.tr.replaceWith(renderRow(row));
    if (row.cell && row.cell.isConnected) row.cell.className = cellClass(row, row.visible);
    if (row.card && row.card.isConnected) row.card.replaceWith(renderCard(row));
    else if (ui.side && (row.selected || row.status)) renderSide();
  }

  function refreshPlaceholders() {
    if (ui.side) { renderSide(); return; }
    if (!ui.list) return;
    for (const input of ui.list.querySelectorAll('input[data-kind=price]')) input.placeholder = state.settings.price || t('price');
    for (const input of ui.list.querySelectorAll('input[data-kind=note]')) input.placeholder = state.settings.note || t('note');
  }

  function updateFooter() {
    if (!ui.count) return;
    const selected = state.rows.filter((r) => r.selected && r.status !== 'ok').length;
    const done = state.rows.filter((r) => r.status === 'ok').length;
    const failed = state.rows.filter((r) => r.status === 'error').length;
    const open = state.openListings?.length ?? 0;
    const found = state.listedKeys.size;
    ui.count.textContent = t('selectedN', selected) + (done ? t('footListed', done) : '') + (failed ? t('footErrors', failed) : '')
      + (state.mineError ? t('footMineFailed') : t('footMine', open, found));
    ui.count.title = state.rows.length ? listedSummary() : '';
    ui.submit.disabled = !selected || state.running || state.loading;
    ui.submit.textContent = state.running ? t('submitting') : t('submit', selected || '');
  }

  // The site is a single-page app, so the button follows URL changes.
  syncFab();
  let lastPath = location.pathname;
  setInterval(() => {
    if (location.pathname !== lastPath) { lastPath = location.pathname; syncFab(); }
    else if (!host || !document.body.contains(host)) syncFab();
  }, 1500);

  // ---------- Price check: who else sells the same item, and for what ----------
  // Uses the site's public marketplace search (GET /trades) with the item's name, quality,
  // ladder, game and side. Magic and rare items share a base name, so their stats are shown
  // to compare by eye.

  let meRequest = null;
  function whoAmI() {
    if (!meRequest) meRequest = api('/users/me').catch(() => { meRequest = null; return null; });
    return meRequest;
  }

  function agoText(value) {
    if (!value) return '';
    const date = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value}Z`);
    const s = Math.max(0, (Date.now() - date.getTime()) / 1000);
    if (Number.isNaN(s)) return '';
    if (s < 60) return t('justNow');
    if (s < 3600) return t('minAgo', Math.floor(s / 60));
    if (s < 86400) return t('hAgo', Math.floor(s / 3600));
    if (s < 86400 * 7) return t('dAgo', Math.floor(s / 86400));
    return date.toLocaleDateString(I18N?.locale() || 'en-GB', { day: 'numeric', month: 'short' });
  }

  // ctx: { name, quality, ladderId, ladderName, gameMode, isHardcore, tip, ownListingId }
  function openPriceCheck(rootNode, ctx) {
    const st = { sameQuality: Boolean(ctx.quality), loading: true, page: null, me: null, error: '' };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    const close = () => { back.remove(); window.removeEventListener('keydown', onKey, true); if (ctx.tip) ctx.tip.style.display = 'none'; };
    const back = h('div', { class: 'pc-back', onclick: (e) => { if (e.target === back) close(); } });
    window.addEventListener('keydown', onKey, true);
    rootNode.append(back);

    const listingRow = (l) => {
      let item = null;
      try { item = l.itemData ? JSON.parse(l.itemData) : null; } catch { item = null; }
      let info = null;
      try { info = item ? describe(item) : null; } catch { info = null; }
      const mine = (st.me && l.sellerId === st.me.id) || l.id === ctx.ownListingId;
      const quality = info?.quality || l.itemQuality;
      const meta = [quality, item ? `ilvl ${item.itemLevel}` : null, info?.isEthereal ? 'eth' : null,
        info?.sockets ? t('sockN', info.sockets) : null, l.isNegotiable ? t('negotiable') : null].filter(Boolean).join(' · ');
      const row = h('div', { class: `pc-row${mine ? ' mine' : ''}` },
        info?.sprite ? h('img', { class: 'img', src: `/data/${info.sprite}`, alt: '', loading: 'lazy' }) : h('div', { class: 'img' }),
        h('div', { class: 'pc-body' },
          h('div', {}, h('span', { class: 'name', style: `color:${QUALITY_COLORS[quality] || '#ddd'}` }, l.itemName),
            h('span', { class: 'meta' }, `  ${meta}`)),
          info?.lines?.length ? h('div', { class: 'pc-stats' }, info.lines.slice(0, 6).map((x) => x.text).join(' · ') + (info.lines.length > 6 ? ' …' : '')) : null,
          h('div', { class: 'meta' }, `${mine ? `${l.sellerDisplayName} (${t('pcYou')})` : l.sellerDisplayName} · ${agoText(l.lastBumpedAtUtc || l.createdAtUtc)}`
            + (l.offerCount ? ` · ${t('pcOffers', l.offerCount)}` : ''))),
        h('div', { class: 'pc-price' }, l.price || t('noPrice'),
          h('a', { class: 'btn', href: `/trade/${l.id}`, target: '_blank', title: t('pcOpen') }, '↗')));
      if (ctx.tip && info && item) {
        row.addEventListener('mouseenter', (e) => { ctx.tip.replaceChildren(...tipParts(info, item)); ctx.tip.style.display = 'block'; moveTip(e, ctx.tip); });
        row.addEventListener('mousemove', (e) => moveTip(e, ctx.tip));
        row.addEventListener('mouseleave', () => { ctx.tip.style.display = 'none'; });
      }
      return row;
    };

    const draw = () => {
      const filters = [ctx.ladderName || t('nonLadder'), ctx.gameMode, typeof ctx.isHardcore === 'boolean' ? (ctx.isHardcore ? 'Hardcore' : 'Softcore') : null]
        .filter(Boolean).join(' · ');
      let body;
      if (st.loading) body = h('div', { class: 'empty' }, t('pcLoading'));
      else if (st.error) body = h('div', { class: 'err' }, st.error);
      else {
        const wanted = ctx.name.toLowerCase();
        const items = [...(st.page?.items ?? [])].sort((a, b) =>
          (b.itemName?.toLowerCase() === wanted) - (a.itemName?.toLowerCase() === wanted));
        body = items.length ? h('div', {}, items.map(listingRow)) : h('div', { class: 'empty' }, t('pcNone'));
      }
      const total = st.page?.total ?? 0;
      const shown = st.page?.items?.length ?? 0;
      back.replaceChildren(h('div', { class: 'pc' },
        h('header', {},
          h('h2', {}, t('pcTitle', ctx.name)),
          h('button', { class: 'close', title: t('close'), onclick: close }, '×')),
        h('div', { class: 'bar' },
          h('span', { class: 'hint' }, filters),
          ctx.quality ? h('label', {}, h('input', { type: 'checkbox', checked: st.sameQuality,
            onchange: (e) => { st.sameQuality = e.target.checked; load(); } }), t('pcSameQuality', ctx.quality)) : null,
          !st.loading && !st.error ? h('span', { class: 'hint', style: 'margin-left:auto' }, t('pcFound', total, shown)) : null),
        ['Magic', 'Rare', 'Crafted'].includes(ctx.quality) ? h('div', { class: 'hint', style: 'padding:6px 14px 0' }, t('pcStatsNote')) : null,
        h('div', { class: 'pc-list' }, body)));
    };

    const load = async () => {
      st.loading = true;
      st.error = '';
      draw();
      const q = new URLSearchParams({ count: '40', status: 'Active', search: ctx.name });
      if (ctx.ladderId) q.set('ladderId', ctx.ladderId); else q.set('isLadder', 'false');
      if (ctx.gameMode) q.set('gameMode', ctx.gameMode);
      if (typeof ctx.isHardcore === 'boolean') q.set('isHardcore', String(ctx.isHardcore));
      if (st.sameQuality && ctx.quality) q.set('quality', ctx.quality);
      try {
        const [page, me] = await Promise.all([api(`/trades?${q}`), whoAmI()]);
        st.page = Array.isArray(page) ? { items: page, total: page.length } : page;
        st.me = me;
      } catch (error) { st.error = error.message || String(error); }
      st.loading = false;
      if (back.isConnected) draw();
    };
    load();
  }

  function priceCheckRow(row) {
    const s = state.settings;
    const ladder = state.ladders.find((l) => l.id === state.ladderId);
    openPriceCheck(root, {
      name: row.info.name,
      quality: row.info.quality,
      ladderId: state.ladderId || null,
      ladderName: ladder?.name || null,
      gameMode: row.gameMode || s.gameMode || null,
      isHardcore: row.isHardcore ?? (s.isHardcore === 'true' ? true : s.isHardcore === 'false' ? false : null),
      ownListingId: listingOf(row)?.id ?? null,
      tip: ui.tip
    });
  }

  // Lets the page (or a test harness) open the panel.
  window.__d2rBulkTradeOpen = openPanel;

  // The UI language changed (here or in another site tab): relabel and redraw.
  I18N?.onChange(() => {
    for (const row of state.rows) labelRow(row);
    if (ui.fab) ui.fab.textContent = t('fabBulk');
    if (open) render();
  });

  // Shared with trade.js (the trade window), which runs in the same content-script world.
  window.__d2rBT = { api, h, loadData, describe, tipParts, moveTip, itemSignature, isIdentified, matchListings, withItemData, applyCachedItemData, openPriceCheck, QUALITY_COLORS, CSS, API, TOKEN_KEY };
})();
