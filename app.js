(() => {
  'use strict';
  const APP_VERSION = 'v9.7'; // keep in sync with CACHE in sw.js (espanol-v9-7)
  const KEY = 'spanish-app-state-v1'; // unchanged since v1 — never rename
  const DAY = SRS.DAY;
  // v9.7: five stones per unit, in this order. `s` is the stone's storage slot: 0-3 are the original path.done[uid] booleans
  // (New words, Story, Practice, Unit test, unchanged since v6), 'w' is the new Word practice stone (S.wordPractice[uid]).
  const STONES = [
    { key: 'intro', s: 0, label: 'New words', icon: 'Aa' },
    { key: 'words', s: 'w', label: 'Word practice', icon: '⟳' },
    { key: 'story', s: 1, label: 'Story', icon: '❝' },
    { key: 'practice', s: 2, label: 'Practice', icon: '↻' },
    { key: 'test', s: 3, label: 'Unit test', icon: '✓' }
  ];
  const PASS = 0.8;
  const app = document.getElementById('app');
  let C, S, IDX;

  // ---------- state + migration ----------
  const defaults = () => ({ v: 1, schema: 5, placementDone: false, created: Date.now(), items: {}, pstats: {}, recent: {},
    settings: { newPerSession: 5, rate: 0.9, autoAdvance: false, sound: true, anim: true, goalMin: Daily.GOAL_MIN, voice: '', voice2: '', voiceMode: 'recorded' }, sessions: 0,
    path: { done: {}, tests: {}, testedOut: {} }, parked: {}, daily: {}, streak: Daily.seed(), parkedDefaults: {}, listenPauseUntil: 0, speakPauseUntil: 0, rulesSeen: {}, pace: {}, focusLog: [], wordPractice: {}, wpMigrated: 1 });
  function load() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(KEY)); } catch (e) { /* fresh */ }
    return raw && raw.v ? normalize(raw) : defaults();
  }
  // merge any older shape (v1–v3 had no path/parked/schema; v4 had no daily/streak) into the current one without touching SRS item states
  function normalize(raw) {
    const d = defaults();
    const s = Object.assign(d, raw, { settings: Object.assign(d.settings, raw.settings || {}) });
    s.items = raw.items || {}; s.pstats = raw.pstats || {}; s.recent = raw.recent || {};
    s.parked = raw.parked && typeof raw.parked === 'object' ? raw.parked : {};
    const hadPath = raw.path && raw.path.done;
    s.path = Object.assign({ done: {}, tests: {}, testedOut: {} }, raw.path || {});
    s.needsPathMigration = !hadPath;
    // v5 (schema 3): per-day practice history + streak. The 1090-day seed is applied only when no streak exists yet.
    s.daily = raw.daily && typeof raw.daily === 'object' ? raw.daily : {};
    s.streak = raw.streak && typeof raw.streak === 'object' && 'count' in raw.streak ? raw.streak : Daily.seed();
    if (!(s.settings.goalMin > 0)) s.settings.goalMin = Daily.GOAL_MIN;
    // v6 (schema 4): path order now comes from content.json (units keep their ids, so path.done / items need no rewrite);
    // parkedDefaults remembers which syllabus "start parked" words were already parked once, so an Unpark sticks.
    s.parkedDefaults = raw.parkedDefaults && typeof raw.parkedDefaults === 'object' ? raw.parkedDefaults : {};
    // v7: listenPauseUntil (ms timestamp, 0 = listening on) is an optional new field; older data simply gets 0. Schema stays 4.
    s.listenPauseUntil = +raw.listenPauseUntil || 0;
    // v8 (schema 5): speakPauseUntil ("Can't speak now", 0 = on) and settings.voice ('' = automatic best Spanish voice).
    // Both are optional additions; items, path, daily, streak, parked and every other field pass through untouched.
    s.speakPauseUntil = +raw.speakPauseUntil || 0;
    // v9.5: hidden = recently hidden words, newest first [{id, kind:'park'|'easy', at, word?, prev}] for Undo / Unhide. Optional; schema stays 5.
    s.hidden = Array.isArray(raw.hidden) ? raw.hidden.filter(h => h && typeof h.id === 'string' && (h.kind === 'park' || h.kind === 'easy')).slice(0, 30) : [];
    if (typeof s.settings.voice !== 'string') s.settings.voice = '';
    // v8.1: settings.voice2 = second story voice ('' = automatic, Paulina first). Optional; schema stays 5.
    if (typeof s.settings.voice2 !== 'string') s.settings.voice2 = '';
    // v9: settings.voiceMode = 'recorded' (natural pre-recorded voices, default) or 'device' (Web Speech voices above). Schema stays 5.
    if (s.settings.voiceMode !== 'device') s.settings.voiceMode = 'recorded';
    // v9.4: rulesSeen (pattern → when its rule card was shown) and pace (pattern → easy one-contrast drills left after the card).
    // Optional additions; schema stays 5. Patterns already studied still get their card once, the next time they come up.
    s.rulesSeen = raw.rulesSeen && typeof raw.rulesSeen === 'object' ? raw.rulesSeen : {};
    s.pace = raw.pace && typeof raw.pace === 'object' ? raw.pace : {};
    // v9.6: focusLog = the grammar pattern each practice / review session focused on, newest first (max 10), for rotation.
    // Optional addition; schema stays 5.
    s.focusLog = Array.isArray(raw.focusLog) ? raw.focusLog.filter(x => typeof x === 'string').slice(0, 10) : [];
    // v9.7: wordPractice = units whose new Word practice stone (between New words and Story) is done {uid: ms}. Optional; schema
    // stays 5 and path.done is untouched. Once, on upgrade: every unit already past New words gets it marked done, so nobody is
    // sent backward; a unit still on New words simply gets the new stone next.
    s.wordPractice = raw.wordPractice && typeof raw.wordPractice === 'object' ? raw.wordPractice : {};
    if (!raw.wpMigrated) { Object.entries(s.path.done || {}).forEach(([uid, d]) => { if (Array.isArray(d) && d[0] && !s.wordPractice[uid]) s.wordPractice[uid] = 1; }); }
    s.wpMigrated = 1;
    s.schema = 5;
    return s;
  }
  function applyStartParked() { // syllabus words parked by default (e.g. poesía); only words not yet studied, and only once each
    let changed = false;
    (C.startParked || []).forEach(w => {
      if (!IDX.words[w] || S.parkedDefaults[w]) return;
      S.parkedDefaults[w] = true; changed = true;
      if (!S.items[wid(w)] && !S.parked[w]) S.parked[w] = { at: Date.now(), auto: true };
    });
    // v9.2: words parked by long-press before they were course words ('g:' keys) park the course word once it exists
    C.units.forEach(u => u.words.forEach(w => {
      const base = strip(w.es.replace(/^(el|la|los|las) /, '').toLowerCase()), g = S.parked['g:' + base];
      if (g && !S.parked[w.id] && !g.applied) { S.parked[w.id] = { at: g.at, from: 'g:' + base }; g.applied = true; changed = true; }
    }));
    if (changed) save();
  }
  function migratePath() { // runs once content is loaded; derives path progress from existing SRS items
    if (!S.needsPathMigration) return;
    delete S.needsPathMigration;
    C.units.forEach(u => {
      const words = u.words.filter(w => !S.parked[w.id]);
      if (words.length && words.every(w => S.items[wid(w.id)])) { setStone(u.id, 0, true); setStone(u.id, 'w', true); }
    });
    if (S.placementSummary) applyPlacementToPath(S.placementSummary);
    save();
  }
  function applyPlacementToPath(sum) {
    const strong = new Set(sum.strong || []), known = new Set(sum.knownWords || []), tested = new Set(C.placement.words);
    C.units.forEach(u => {
      const testedHere = u.words.filter(w => tested.has(w.id));
      const out = u.focus.every(p => strong.has(p)) && testedHere.length > 0 && testedHere.every(w => known.has(w.id));
      if (out) { STONES.forEach(t => setStone(u.id, t.s, true)); S.path.testedOut[u.id] = true; }
    });
  }
  const save = () => localStorage.setItem(KEY, JSON.stringify(S));
  async function persist() { try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (e) { /* ignore */ } }

  // ---------- helpers ----------
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const endOfToday = () => { const d = new Date(); d.setHours(23, 59, 59, 999); return d.getTime(); };
  const wid = id => 'w:' + id, pid = id => 'p:' + id;
  const isParked = id => !!S.parked[id.startsWith('w:') ? id.slice(2) : id];
  const strip = s => Check.stripAcc(String(s).toLowerCase());

  function buildIndex() {
    IDX = { words: {}, wordOrder: [], patterns: C.patterns, sentByWord: {}, sentences: [], unitIdx: {}, forms: {} };
    C.units.forEach((u, ui) => {
      IDX.unitIdx[u.id] = ui;
      u.words.forEach(w => {
        IDX.words[w.id] = Object.assign({ unit: u.id, unitIdx: ui }, w); IDX.wordOrder.push(w.id);
        const base = w.es.replace(/^(el|la|los|las) /, '');
        [base, ...(w.esAlt || []).map(a => a.replace(/^(el|la|los|las) /, ''))].forEach(f => {
          const k = strip(f); IDX.forms[k] = w.id; IDX.forms[k + 's'] = w.id; IDX.forms[k + 'es'] = w.id;
          const first = k.split(' ')[0]; if (first.length > 3 && !IDX.forms[first]) IDX.forms[first] = w.id;
        });
      });
      u.sentences.forEach(s => { s.unit = u.id; IDX.sentences.push(s); (IDX.sentByWord[s.k] = IDX.sentByWord[s.k] || []).push(s); });
    });
    C.units.forEach(u => u.sentences.forEach(s => { const k = strip(s.f); if (!k.includes(' ')) IDX.forms[k] = IDX.forms[k] || s.k; }));
    IDX.section = C.sections.find(s => s.units) || null;
    IDX.glossFold = {}; Object.entries(C.glosses || {}).forEach(([k, v]) => { IDX.glossFold[strip(k)] = IDX.glossFold[strip(k)] || v; });
    // v9.6: other natural word orders (content.json "alts", from tools/gen_word_orders.py), keyed by the preferred text
    IDX.orders = new Map(); const addO = (t, a) => { if (t && a && a.length) IDX.orders.set(okey(t), a); };
    C.units.forEach(u => { u.sentences.forEach(s => addO(s.es, s.alts)); u.story.lines.forEach(l => addO(l.es, l.alts)); });
    Object.values(C.patterns).forEach(p => p.items.forEach(it => { const full = it.q.replace('___', it.o[0]).replace(/\s*\([^)]*\)\s*$/, ''), parts = full.split(' — '); addO(parts.length === 2 ? parts[1] : full, it.alts); }));
    IDX.sectionWords = (IDX.section ? IDX.section.units : C.units.map(u => u.id)).flatMap(uid => C.units[IDX.unitIdx[uid]].words.map(w => w.id));
  }
  const okey = t => Check.stripAcc(Check.clean(t));
  const ordersFor = t => (IDX.orders && IDX.orders.get(okey(t))) || [];
  // v9.6: "Also common: <preferred order>" when the learner's (valid) order differs from the course's
  const orderNote = ex => ex.res && ex.res.order && ex.res.result !== 'agree' ? `<div class="muted small spelled also-common">Also common: ${tokenize(ex.res.order)}</div>` : '';
  // wrap Spanish text: every word can be tapped for a hint (v8); tracked vocabulary words can also be long-pressed to park them.
  // Words new to the learner in this lesson get the "new" highlight.
  function tokenize(text) {
    let inParen = false;
    return text.split(/(\s+)/).map(tok => {
      if (/^\s+$/.test(tok)) return tok;
      const wasParen = inParen || tok.startsWith('('); if (tok.startsWith('(')) inParen = true; if (tok.includes(')')) inParen = false;
      const core = tok.replace(/^[¿¡“"(«—]+|[.,;:!?”"»)…—]+$/g, '');
      if (!core || !/\p{L}/u.test(core) || wasParen) return esc(tok); // blanks, numbers-only and English hints in parentheses stay plain
      const id = IDX.forms[strip(core)], isNew = id && run && run.newIds && run.newIds.has(id);
      const pre = esc(tok.slice(0, tok.indexOf(core))), post = esc(tok.slice(tok.indexOf(core) + core.length));
      return pre + `<span class="tok${id ? ' w' : ''}${isNew ? ' new' : ''}"${id ? ` data-w="${id}"` : ''} data-g="${esc(core)}">${esc(core)}</span>` + post;
    }).join('');
  }
  // v9: the Spanish word cores tokenize() makes tappable (tap = hear the word), for the audio generator
  function tokCores(text) {
    let inParen = false; const out = [];
    String(text).split(/\s+/).forEach(tok => {
      if (!tok) return;
      const wasParen = inParen || tok.startsWith('('); if (tok.startsWith('(')) inParen = true; if (tok.includes(')')) inParen = false;
      const core = tok.replace(/^[¿¡“"(«—]+|[.,;:!?”"»)…—]+$/g, '');
      if (core && /\p{L}/u.test(core) && !wasParen) out.push(core);
    });
    return out;
  }
  const VOICE_TEST = 'Hola, así sueno. ¿Se lo mando mañana?', VOICE2_TEST = '¡Hola! Yo soy la segunda voz de las historias.', RATE_TEST = 'Así suena ahora.';
  // v9: every Spanish string the app can speak. main = default voice; story = [unitId, speaker, text] in that speaker's voice;
  // second = the Settings "second voice" sample. tools/build_audio.py records these (content-hash names, only changed text is redone).
  function speakables() {
    const main = new Set(), story = [];
    const add = t => { t = String(t || '').trim(); if (t && /\p{L}/u.test(t)) main.add(t); };
    const toks = t => tokCores(t).forEach(add);
    C.units.forEach(u => {
      u.words.forEach(w => { add(w.es); toks(w.es); });
      u.sentences.forEach(x => { add(x.es); toks(x.es); });
      u.story.lines.forEach(l => { story.push([u.id, l.s || '', l.es.trim()]); toks(l.es); });
    });
    Object.values(C.patterns).forEach(p => p.items.forEach(it => { const full = it.q.replace('___', it.o[0]); add(full); add(full.replace(/\s*\([^)]*\)\s*$/, '')); toks(it.q); toks(full);
      const t = patternTarget(it); if (t) { add(t.es); if (t.ctxEs) add(t.ctxEs); } })); // v9.3: grammar tiles / say-it lines
    Object.values(C.patterns).forEach(p => p.rule && p.rule.ex.forEach(([es]) => { add(es.replace(/\s*→\s*/g, '. ')); toks(es.replace(/→/g, ' ')); })); // v9.4: rule card examples
    [VOICE_TEST, RATE_TEST].forEach(add);
    return { main: [...main], story, second: [VOICE2_TEST] };
  }
  // English hint for one Spanish word: a course word gives its own meaning, anything else comes from content.json glosses
  function gloss(core) {
    const id = IDX.forms[strip(core)];
    if (id) { const w = IDX.words[id]; return { es: w.es, en: w.en }; }
    const low = String(core).toLowerCase(), g = (C.glosses || {})[low] || IDX.glossFold[strip(low)];
    return g ? { es: low, en: g } : null;
  }
  // v9.2 fallback when no gloss: plural / gender endings, then the containing sentence's English (story lines, examples, feedback)
  function glossOrFallback(el) {
    const core = el.dataset.g; let g = gloss(core); if (g) return g;
    const low = String(core).toLowerCase();
    for (const f of [low.replace(/es$/, ''), low.replace(/s$/, ''), low.replace(/a$/, 'o'), low.replace(/as$/, 'os')]) if (f !== low && f.length > 1) { g = gloss(f); if (g) return { es: g.es, en: g.en }; }
    const host = el.closest('[data-en]'); if (host && host.dataset.en) return { es: low, en: 'Whole line: ' + host.dataset.en };
    return { es: low, en: '(no hint for this word yet)' };
  }
  const hintsOff = () => !!(run && run.mode === 'test'); // v9.2: no tap-to-translate in the unit test (4th stone)
  function showHint(el) {
    closeHint();
    const g = glossOrFallback(el); if (!g) return;
    const box = document.createElement('div'); box.className = 'hint-pop'; box.setAttribute('role', 'tooltip');
    box.innerHTML = `<div class="hint-en">${esc(g.en)}</div>${strip(g.es) !== strip(el.dataset.g) ? `<div class="hint-es muted small">${esc(g.es)}</div>` : ''}`;
    document.body.appendChild(box);
    const r = el.getBoundingClientRect(), b = box.getBoundingClientRect();
    box.style.left = Math.max(8, Math.min(window.innerWidth - b.width - 8, r.left + r.width / 2 - b.width / 2)) + 'px';
    const below = r.bottom + 8, above = r.top - b.height - 8, fitsBelow = below + b.height < window.innerHeight - 90; // keep clear of the footer
    box.style.top = (fitsBelow || above < 8 ? below : above) + window.scrollY + 'px'; box.classList.toggle('below', fitsBelow || above < 8);
    el.classList.add('hinted'); hintEl = el;
  }
  let hintEl = null;
  function closeHint() { document.querySelectorAll('.hint-pop').forEach(n => n.remove()); if (hintEl) hintEl.classList.remove('hinted'); hintEl = null; }
  function initHints() { // tap a word: hint popover + hear the word. Tap elsewhere closes it. Long-press still parks.
    document.addEventListener('click', e => {
      const t = e.target.closest && e.target.closest('.tok[data-g]');
      if (!t) { if (!(e.target.closest && e.target.closest('.hint-pop'))) closeHint(); return; }
      if (lp.fired) return;
      if (hintsOff() || t.closest('.tile, .opt, .nohint')) return; // tiles / answer buttons keep their own tap
      e.stopPropagation();
      if (hintEl === t) return closeHint();
      showHint(t); speak(t.dataset.g);
    }, true);
    ['scroll', 'resize'].forEach(ev => window.addEventListener(ev, closeHint, { passive: true }));
  }
  const newLabel = html => /class="tok[^"]*\bnew\b/.test(html) ? '<div class="newlabel"><span class="badge new">NEW</span> New word</div>' : '';
  const AVATAR = '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="23" fill="var(--accent-soft, #ccfbf1)"/><circle cx="24" cy="19" r="8" fill="var(--accent, #0f766e)"/><path d="M10 41c2-8 8-12 14-12s12 4 14 12" fill="var(--accent, #0f766e)"/></svg>';
  // speech-bubble prompt: avatar + bubble with a speaker button. Spanish gets tappable, dotted-underlined words.
  function bubble(text, lang, say) {
    const body = lang === 'es' ? tokenize(text) : esc(text);
    return `<div class="bubble-row"><div class="avatar">${AVATAR}</div><div class="bubble ${lang === 'es' ? 'es' : 'en'}">${say ? `<button class="icon speak bubble-spk" data-say="${esc(say)}" aria-label="Play">🔊</button>` : ''}<span class="btext" lang="${lang}">${body}</span></div></div>`;
  }
  const wordSpan = (id, text) => `<span class="w" data-w="${id}">${esc(text)}</span>`;

  // ---------- daily minutes (active practice time only) + streak ----------
  const todayKey = () => Daily.dayKey(Date.now());
  const goalMin = () => S.settings.goalMin || Daily.GOAL_MIN;
  const T = { lastTick: Date.now(), lastInput: 0, lastSave: 0, shownDay: null };
  const inSession = () => !!(run || story);
  function tick() { // credit time since the last tick when a lesson is open, the app is visible and there was input in the last 60 s
    const t = Date.now();
    if (S && inSession() && document.visibilityState !== 'hidden') {
      const added = Daily.accrue(S.daily, T.lastTick, t, T.lastInput);
      if (added) { checkGoal(); if (t - T.lastSave > 15000) { T.lastSave = t; save(); } }
    }
    T.lastTick = t;
    if (T.shownDay && T.shownDay !== todayKey()) updateDayBar(); // home left open across midnight
    if (S) updateLp();
  }
  function noteInput() { tick(); T.lastInput = Date.now(); }
  function sessionStart() { tick(); T.lastInput = T.lastTick = Date.now(); }
  function sessionDone() { // a lesson, story, practice, test, review or placement was completed
    tick();
    const k = todayKey(), e = S.daily[k] = S.daily[k] || { ms: 0, sessions: 0 };
    e.sessions = (e.sessions || 0) + 1;
    S.streak = Daily.complete(S.streak, k);
  }
  function checkGoal() {
    const k = todayKey(), e = S.daily[k];
    if (e && !e.goal && Daily.minutesOn(S.daily, k) >= goalMin()) { e.goal = true; e.goalAt = Date.now(); }
  }
  function dayBarHtml() {
    const k = todayKey(), m = Daily.minutesOn(S.daily, k), g = goalMin(), done = m >= g;
    const sk = Daily.current(S.streak, k);
    return `<div class="daybar ${done ? 'goal-done' : ''}" id="daybar">
      <div class="streak ${sk.doneToday ? 'lit' : ''}" id="streak" title="Day streak"><span class="flame" aria-hidden="true">🔥</span><b id="streak-n">${sk.count.toLocaleString('en-US')}</b></div>
      <div class="mbar" role="progressbar" aria-valuemin="0" aria-valuemax="${g}" aria-valuenow="${Math.min(m, g)}"><span style="width:${Math.min(100, 100 * m / g)}%"></span></div>
      <div class="mins" id="mins">${done ? '✓ ' : ''}${m} / ${g} min</div></div>`;
  }
  function updateDayBar() {
    const el = document.getElementById('daybar'); if (!el) { T.shownDay = null; return; }
    el.outerHTML = dayBarHtml(); T.shownDay = todayKey();
  }
  function celebrateGoal() { // once per day, the first time home is shown after reaching the goal
    const e = S.daily[todayKey()];
    if (!e || !e.goal || e.celebrated) return;
    e.celebrated = true; save();
    const el = document.getElementById('daybar');
    setTimeout(() => FX.goal(el), 250);
  }
  ['pointerdown', 'keydown', 'touchstart', 'wheel', 'input'].forEach(ev => document.addEventListener(ev, noteInput, { capture: true, passive: true }));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { tick(); if (S) save(); }
    else { T.lastTick = T.lastInput = Date.now(); if (!inSession()) updateDayBar(); }
  });
  window.addEventListener('pagehide', () => { tick(); if (S) save(); });
  setInterval(tick, 1000);

  // ---------- "Can't listen now" (10-minute pause on audio-only exercises) ----------
  function lpHtml() { // pills for both pauses: 🔇 listening, 🤐 speaking (v8). Tap a pill to turn that one back on early.
    const m = S ? Listen.minutesLeft(S.listenPauseUntil, Date.now()) : 0, k = S ? Listen.minutesLeft(S.speakPauseUntil, Date.now()) : 0;
    return (m ? `<button class="lp-ind" id="lpInd" type="button" title="Listening paused. Tap to turn it back on." aria-label="Listening paused, ${m} minutes left. Tap to turn listening back on.">🔇 <span id="lpMin">${m}</span> min</button>` : '')
      + (k ? `<button class="lp-ind sp-ind" id="spInd" type="button" title="Speaking paused. Tap to turn it back on." aria-label="Speaking paused, ${k} minutes left. Tap to turn speaking back on.">🤐 <span id="spMin">${k}</span> min</button>` : '')
      // v9.1: speaking drills switched off for this session (mic failed / timed out twice, or permission refused): same pill, tap to retry
      + (!k && speechBlocked && Speech.available(window) ? '<button class="lp-ind sp-ind" id="spOff" type="button" title="Speaking drills are off for now. Tap to turn them back on." aria-label="Speaking drills off. Tap to turn speaking back on.">🤐 off</button>' : '');
  }
  function bindLp() { const b = document.getElementById('lpInd'); if (b) b.onclick = resumeListening; const c = document.getElementById('spInd'); if (c) c.onclick = resumeSpeaking; const d = document.getElementById('spOff'); if (d) d.onclick = resumeSpeaking; }
  function updateLp() { // called every second: refresh minutes left, drop an indicator when its pause expires
    [['lpInd', 'lpMin', 'listenPauseUntil'], ['spInd', 'spMin', 'speakPauseUntil']].forEach(([bid, mid, f]) => {
      const b = document.getElementById(bid); if (!b) return;
      const m = Listen.minutesLeft(S[f], Date.now());
      if (!m) { b.remove(); S[f] = 0; save(); return; }
      const el = document.getElementById(mid); if (el && el.textContent !== String(m)) el.textContent = m;
    });
  }
  function cantListen(entry, btn) {
    if (!run || run.answered) return;
    hush();
    S.listenPauseUntil = Listen.start(Date.now()); save();
    FX.pause(btn);
    // same card, same item, nothing graded: rebuild it as a non-audio exercise (the paused flag makes makeExercise substitute)
    setTimeout(() => { if (!run || run.queue[run.i] !== entry) return; run.ex = makeExercise(entry); run.answered = false; renderExercise(entry, run.ex); toast('Listening off for 10 minutes'); }, 180);
  }
  // ---------- "Can't speak now" (v8): same 10-minute pause, for repeat-after-me drills ----------
  const speakPaused = () => S && Listen.paused(S.speakPauseUntil, Date.now());
  let speechBlocked = false; // recogniser missing, mic permission denied or service refused: no speaking drills this session
  try { speechBlocked = sessionStorage.getItem('speech-blocked') === '1'; } catch (e) { /* ignore */ }
  const speakOk = () => !speechBlocked && !speakPaused() && Speech.available(window);
  function blockSpeech() { speechBlocked = true; try { sessionStorage.setItem('speech-blocked', '1'); } catch (e) { /* ignore */ } }
  function unblockSpeech() { speechBlocked = false; micFails = 0; try { sessionStorage.removeItem('speech-blocked'); } catch (e) { /* ignore */ } }
  let micFails = 0; // v9.1: recogniser hung / timed out / threw this session; 2 → speaking drills off for the session
  function cantSpeak(entry, btn) {
    if (!run || run.answered) return;
    stopRec();
    S.speakPauseUntil = Listen.start(Date.now()); save();
    FX.pause(btn);
    setTimeout(() => { if (!run || run.queue[run.i] !== entry) return; run.ex = makeExercise(entry); run.answered = false; renderExercise(entry, run.ex); toast('Speaking off for 10 minutes'); }, 180);
  }
  function resumeSpeaking() {
    S.speakPauseUntil = 0; save(); unblockSpeech();
    ['spInd', 'spOff'].forEach(id => { const b = document.getElementById(id); if (b) b.remove(); });
    toast('Speaking is back on');
  }
  function resumeListening() {
    S.listenPauseUntil = 0; save();
    const b = document.getElementById('lpInd'); if (b) b.remove();
    toast('Listening is back on');
  }

  // ---------- speech ----------
  let voice = null, voice2 = null;
  // v8: Angélica (Enhanced/Premium) > other es-MX Enhanced/Premium > es-MX > es-US/419 > es-*, unless a voice is chosen in Settings.
  // iOS fills getVoices() late, so pick again on voiceschanged and on a few short retries.
  function pickVoice() {
    if (!('speechSynthesis' in window)) return;
    const all = speechSynthesis.getVoices();
    voice = Voice.choose(all, S && S.settings.voice) || null;
    voice2 = Voice.second(all, voice, S && S.settings.voice2) || null;
    if (story) story.cast = null; // re-cast on the next line if the voice list changed
    const el = document.getElementById('voiceSel'); // Settings opened before iOS listed its voices: refresh the picker once they arrive
    if (el && el.dataset.n === '0' && speechSynthesis.getVoices().some(Voice.isEs)) renderProgress();
  }
  function initVoices() {
    if (!('speechSynthesis' in window)) return;
    pickVoice();
    if (speechSynthesis.addEventListener) speechSynthesis.addEventListener('voiceschanged', pickVoice); else speechSynthesis.onvoiceschanged = pickVoice;
    let n = 0; const t = setInterval(() => { pickVoice(); if (++n >= 10 || (voice && speechSynthesis.getVoices().length)) clearInterval(t); }, 300);
  }
  const listenPaused = () => S && Listen.paused(S.listenPauseUntil, Date.now());
  const autoSpeak = (text, as) => { if (!listenPaused()) speak(text, false, as); }; // automatic playback; tapping a 🔊 still plays
  // story speakers (v8.1): narrator + first character = main voice, second = second voice, more = cycle voices + pitch
  function storyVoice(speaker) {
    if (!story) return null;
    if (!story.cast) story.cast = Voice.cast(story.u.story.lines.map(l => l.s), 'speechSynthesis' in window ? speechSynthesis.getVoices() : [], voice, voice2);
    const c = story.cast[speaker || ''] || story.cast[''] || {};
    return Object.assign({}, c, { rec: Rec.castFor(Rec.man, story.u.id, speaker) }); // v9: recorded voice for this speaker
  }
  // v9: recorded clips first (Settings › Voices = Natural), Web Speech for anything not recorded or if playback fails.
  // Recorded speed follows the speed slider (0.9 = as recorded); the slow-replay button plays recordings at 0.75×.
  const useRecorded = () => S.settings.voiceMode !== 'device' && !!Rec.man;
  const recRate = slow => slow ? 0.75 : Math.max(0.6, Math.min(1.3, (S.settings.rate || 0.9) / 0.9));
  function speak(text, slow, as) {
    if (useRecorded()) {
      const main = Rec.man.main, vid = (as && as.rec) || main;
      const path = Rec.lookup(Rec.man, text, vid) || (vid !== main ? Rec.lookup(Rec.man, text, main) : null);
      if (path) {
        if ('speechSynthesis' in window) try { speechSynthesis.cancel(); } catch (e) { /* ignore */ }
        Rec.play(path, recRate(slow)).catch(() => deviceSpeak(text, slow, as));
        return true;
      }
      if (window.__audioMiss) window.__audioMiss.push(text);
    }
    return deviceSpeak(text, slow, as);
  }
  function hush() { if (Rec.stop) Rec.stop(); if ('speechSynthesis' in window) try { speechSynthesis.cancel(); } catch (e) { /* ignore */ } } // v9: stop recorded + device audio
  function deviceSpeak(text, slow, as) {
    if (Rec.stop) Rec.stop();
    if (!('speechSynthesis' in window)) return false;
    speechSynthesis.cancel();
    if (!voice) pickVoice();
    const u = new SpeechSynthesisUtterance(text);
    const v = (as && as.voice) || voice;
    u.lang = v ? v.lang : 'es-MX'; if (v) u.voice = v;
    u.pitch = as && as.pitch ? as.pitch : 1;
    u.rate = (S.settings.rate || 0.9) * (slow ? 0.7 : 1);
    try { speechSynthesis.speak(u); } catch (e) { return false; } // never let audio break a lesson
    return true;
  }
  // v9: recorded clips one unit needs (words, sentences, story lines in their cast voices, tap-hint words, its grammar items)
  function unitAudio(u) {
    if (!Rec.man) return [];
    const out = new Set(), add = (t, v) => { const p = Rec.lookup(Rec.man, t, v); if (p) out.add(p); }, toks = t => tokCores(t).forEach(x => add(x));
    u.words.forEach(w => { add(w.es); toks(w.es); });
    u.sentences.forEach(x => { add(x.es); toks(x.es); });
    u.story.lines.forEach(l => { add(l.es, Rec.castFor(Rec.man, u.id, l.s)); toks(l.es); });
    u.focus.forEach(p => C.patterns[p].items.forEach(it => { const full = it.q.replace('___', it.o[0]); add(full); add(full.replace(/\s*\([^)]*\)\s*$/, '')); toks(it.q); toks(full); }));
    return [...out];
  }

  // ---------- scheduling glue ----------
  function grade(id, g) { S.items[id] = SRS.review(S.items[id] || SRS.newCard(), g, Date.now()); }
  function pstat(patternId, ok) { const p = S.pstats[patternId] = S.pstats[patternId] || { seen: 0, correct: 0 }; p.seen++; if (ok) p.correct++; }
  const validId = id => id.startsWith('w:') ? !!IDX.words[id.slice(2)] && !isParked(id) : !!IDX.patterns[id.slice(2)];
  function dueIds(now) {
    const eod = endOfToday();
    return Object.keys(S.items).filter(id => S.items[id].due <= eod && validId(id))
      .sort((a, b) => SRS.currentR(S.items[a], now) - SRS.currentR(S.items[b], now));
  }
  function patternItem(p) {
    const items = IDX.patterns[p].items; const rec = S.recent[p] = S.recent[p] || [];
    let pool = items.map((_, i) => i).filter(i => !rec.includes(i)); if (!pool.length) { rec.length = 0; pool = items.map((_, i) => i); }
    const i = pick(pool); rec.push(i); while (rec.length > Math.max(1, items.length - 2)) rec.shift();
    return i;
  }
  function easyItem(p) { // v9.4: an easy, one-contrast item (content.json "easy"), not one of the last few seen
    const items = IDX.patterns[p].items, rec = S.recent[p] = S.recent[p] || [];
    const easy = items.map((it, i) => it.easy ? i : -1).filter(i => i >= 0); if (!easy.length) return patternItem(p);
    const pool = easy.filter(i => !rec.includes(i)), i = pick(pool.length ? pool : easy); rec.push(i); while (rec.length > Math.max(1, items.length - 2)) rec.shift();
    return i;
  }
  const knownCard = c => c && (c.known || c.s >= 21);

  // ---------- path state ----------
  function stones(uid) { return S.path.done[uid] = S.path.done[uid] || [false, false, false, false]; }
  function setStone(uid, i, v) {
    if (i === 'w') { S.wordPractice = S.wordPractice || {}; if (v) S.wordPractice[uid] = S.wordPractice[uid] || Date.now(); else delete S.wordPractice[uid]; return; }
    stones(uid)[i] = v;
  }
  const stoneDone = (uid, i) => i === 'w' ? !!(S.wordPractice || {})[uid] : !!stones(uid)[i];
  const unitDone = uid => stones(uid)[3];
  function currentPos() { // first unit (in order) with an unfinished stone, stones in path order (New words, Word practice, …)
    for (const uid of IDX.section.units) { const t = STONES.find(x => !stoneDone(uid, x.s)); if (t) return { uid, stone: t.s }; }
    return null;
  }
  function stoneState(uid, i) {
    if (stoneDone(uid, i)) return 'done';
    const cur = currentPos();
    if (!cur) return 'done';
    const ui = IDX.section.units.indexOf(uid), ci = IDX.section.units.indexOf(cur.uid);
    const before = STONES.slice(0, STONES.findIndex(x => x.s === i));
    if (ui < ci) return before.every(x => stoneDone(uid, x.s)) ? 'open' : 'locked'; // earlier unit, skipped stone
    if (ui === ci && i === cur.stone) return 'current';
    return 'locked';
  }
  function unitsUpTo(uid) { const list = IDX.section.units; return list.slice(0, list.indexOf(uid) + 1).map(id => C.units[IDX.unitIdx[id]]); }
  function checkC2() { // parked words resume as new once the learner reaches a C2 section
    const cur = currentPos(); const sec = cur && C.sections.find(s => s.units && s.units.includes(cur.uid));
    if (sec && sec.cefr === 'C2' && Object.keys(S.parked).length) { Object.keys(S.parked).forEach(w => { delete S.items[wid(w)]; }); S.parked = {}; save(); }
  }

  // ---------- exercises ----------
  function makeExercise(entry) {
    if (entry.id.startsWith('p:')) {
      const p = entry.id.slice(2), pat = IDX.patterns[p];
      const pacedRun = run && run.mode !== 'placement' && run.mode !== 'test' && (S.pace[p] || 0) > 0 && entry.ex == null;
      const i = entry.itemIdx != null ? entry.itemIdx : pacedRun ? easyItem(p) : patternItem(p); const it = pat.items[i];
      const full = it.q.replace('___', it.o[0]), name = 'Grammar · ' + pat.name.replace(/\s*\(.*\)\s*$/, '');
      const reveal = { es: full, en: it.en, note: it.n }, speakAfter = full.replace(/\s*\([^)]*\)\s*$/, '');
      // v9.3: practice and review mix in spoken-style drills for grammar: build the reply from tiles or say it out loud.
      // Placement and the unit test stay choose-the-right-form so their scores mean the same thing as before.
      const base = { pk: p, item: it };
      // v9.4 pacing: right after a rule card, the next drills isolate the main contrast (answer vs. its first distractor) on easy items
      if (pacedRun || entry.ex === 'paced') return Object.assign({ kind: 'mc', paced: true, label: name + ' · one contrast', prompt: it.q, options: shuffle(it.o.slice(0, 2)), answer: it.o[0], reveal, speakAfter }, base);
      const t = patternTarget(it), plain = !run || run.mode === 'placement' || run.mode === 'test';
      let kind = entry.ex || (plain || !t ? 'mc' : (r => r < 0.3 ? 'ptiles' : r < 0.45 ? 'pspeak' : 'mc')(Math.random()));
      if (kind === 'pspeak' && (!t || !speakOk())) kind = t ? 'ptiles' : 'mc';
      if (kind === 'ptiles' && t) {
        const have = new Set(tileTokens(t.es).map(strip)); // distractors come from the wrong options: different pronouns / forms, never accent-only twins
        const ds = shuffle(noTwins([...new Set(it.o.slice(1).flatMap(tileTokens).filter(x => !have.has(strip(x))))], tileTokens(t.es), true)).slice(0, 2);
        return Object.assign({ kind: 'build', label: name + ' · build it', pk: p, item: it, tiles: shuffle(tileTokens(t.es).concat(ds)), answers: [t.es], orders: ordersFor(t.es), opts: { lang: 'es' }, reveal, speakAfter, pattern: true },
          t.ctxEs ? { bigEs: t.ctxEs, hintEn: 'Reply: ' + t.en } : { big: t.en });
      }
      if (kind === 'ptype') return Object.assign({ kind: 'type', label: name + ' · type it', clozeEs: it.q.replace('___', '_____'), sub: it.en, answers: [it.o[0]], opts: { lang: 'es' }, placeholder: 'Type the missing part', reveal, speakAfter, pattern: true }, base); // v9.6
      if (kind === 'pspeak' && t) return { pk: p, item: it, kind: 'speak', label: name + ' · say it', sayEs: t.es, hintEn: t.en, answers: [t.es], opts: { lang: 'es', sentence: true }, reveal, speakAfter, tries: 0, pattern: true };
      return Object.assign({ kind: 'mc', label: run && run.mode === 'placement' ? 'Grammar' : name, prompt: it.q, options: shuffle(it.o), answer: it.o[0], reveal, speakAfter }, base);
    }
    const w = IDX.words[entry.id.slice(2)], card = S.items[entry.id];
    const sents = IDX.sentByWord[w.id] || [];
    let type = entry.ex;
    if (!type) {
      const s = card ? card.s : 0;
      // v8 adds the word picker (pick / pickEn), flip cards and repeat-after-me (speak) to the review mix
      type = s < 3 ? pick(['es2en', 'cloze', 'listen', 'pick', 'pickEn', 'flip']) : s < 15 ? pick(['en2es', 'cloze', 'listen', 'es2en', 'flip', 'speak', 'pick']) : pick(['en2es', 'listen', 'cloze', 'flip', 'speak']);
      if (Listen.isAudio(type) && listenPaused()) type = s < 3 ? pick(['es2en', 'cloze', 'pickEn']) : pick(['en2es', 'cloze', 'es2en', 'flip']);
      type = withTiles(w.id, type); // practice and review: about 1 in 4 becomes a tile drill
    }
    const inTest = run && run.mode === 'test'; // test vocab items stay word-level: a skipped speaking item becomes a flip card
    if (Listen.isSpeak(type) && !speakOk()) type = inTest ? 'flip' : Listen.substituteSpeak(sents.some(x => tileTokens(x.es).length <= 10)); // can't speak now / no recogniser
    if (type === 'speak') {
      const short = sents.filter(x => tileTokens(x.es).length >= 3 && tileTokens(x.es).length <= 9);
      const sent = entry.sent || (short.length ? pick(short) : null);
      if (sent) return { kind: 'speak', label: 'Repeat after me', sayEs: sent.es, answers: [sent.es], opts: { lang: 'es', sentence: true }, reveal: { es: sent.es, en: sent.en }, speakAfter: sent.es, tries: 0 };
      type = inTest ? 'flip' : 'build';
    }
    if (type === 'pickListen' && (listenPaused() || !w)) type = 'pickEn';
    if (type === 'pickListen') return pickExercise(w, 'listen');
    if (type === 'pick' || type === 'pickEn') return pickExercise(w, type === 'pickEn');
    if ((type === 'build' || type === 'buildEn') && sents.length) {
      const short = sents.filter(x => x.es.split(' ').length <= 10);
      const sent = entry.sent || pick(short.length ? short : sents);
      return type === 'buildEn' ? tileExercise(sent.en, 'en', IDX.sentences.filter(x => x !== sent).map(x => x.en), { label: 'Build the sentence in English', bigEs: sent.es, reveal: { es: sent.es, en: sent.en }, speakAfter: sent.es })
        : tileExercise(sent.es, 'es', IDX.sentences.filter(x => x !== sent).map(x => x.es), { label: 'Build the sentence in Spanish', big: sent.en, reveal: { es: sent.es, en: sent.en }, speakAfter: sent.es });
    }
    if (type === 'build' || type === 'buildEn') type = 'en2es';
    if (Listen.isAudio(type) && listenPaused()) type = Listen.substitute(type, sents.length > 0); // "Can't listen now" is on
    if ((type === 'cloze' || type === 'listenS') && !sents.length) type = 'en2es';
    const sent = sents.length ? pick(sents) : null;
    const esAns = [w.es].concat(w.esAlt || []);
    switch (type) {
      case 'es2en': return { kind: 'type', label: 'Translate to English', big: w.es, bubbleEs: w.es, bigW: w.id, speakNow: w.es, answers: w.accept, opts: { lang: 'en', typo: true }, placeholder: 'English', reveal: { es: w.es, en: w.en, note: w.note, ex: sent } };
      // en2es / flip / cloze accept real synonyms (reparar for arreglar) with a note; dictation, speaking and tiles never do
      case 'en2es': return { kind: 'type', label: 'Translate to Spanish', big: w.en, bigW: w.id, answers: esAns, alts: w.alt || [], opts: { lang: 'es' }, placeholder: 'Español', reveal: { es: w.es, en: w.en, note: w.note, ex: sent }, speakAfter: w.es };
      case 'flip': return { kind: 'type', flip: true, label: 'Type in Spanish', big: w.en, answers: esAns, alts: w.alt || [], opts: { lang: 'es' }, placeholder: 'Type in Spanish', reveal: { es: w.es, en: w.en, note: w.note, ex: sent }, speakAfter: w.es, back: w.es };
      case 'cloze': {
        const blank = sent.es.replace(sent.f, '_____');
        return { kind: 'type', label: 'Fill in the missing word', clozeEs: blank, sub: sent.en + (sent.h ? ` · (${sent.h})` : ` · (${w.en})`), answers: [sent.f], alts: sent.alt || [], opts: { lang: 'es' }, placeholder: 'Español', reveal: { es: sent.es, en: sent.en, note: w.note }, speakAfter: sent.es };
      }
      default: {
        const useSentence = sent && (card && card.s >= 3 || type === 'listenS');
        const text = useSentence ? sent.es : w.es;
        return { kind: 'type', audio: true, label: useSentence ? 'Listen and type the sentence' : 'Listen and type the word', listen: text, answers: [text], opts: { lang: 'es', sentence: useSentence }, placeholder: 'Escribe lo que oyes', reveal: useSentence ? { es: sent.es, en: sent.en } : { es: w.es, en: w.en, note: w.note } };
      }
    }
  }

  // v9.3: the spoken part of a grammar item: the reply after " — " (with the question as context) or the whole short line
  function patternTarget(it) {
    const paren = (it.q.match(/\(([^)]*)\)\s*$/) || [])[1];
    const full = it.q.replace('___', it.o[0]).replace(/\s*\([^)]*\)\s*$/, ''), es = full.split(' — '), en = it.en.split(' — ');
    const t = es.length === 2 ? { es: es[1], ctxEs: es[0], en: en[1] || it.en } : { es: full, en: it.en + (paren ? ` (${paren})` : '') };
    return tileTokens(t.es).length <= 10 ? t : null;
  }
  // ---------- v8 word picker: one word, three big stacked choices; distractors from this section's vocabulary ----------
  function pickExercise(w, reverse) {
    const core = x => strip(x.es.replace(/^(el|la|los|las) /, ''));
    const pool = IDX.sectionWords.map(id => IDX.words[id]).filter(x => x.id !== w.id && !S.parked[x.id] && core(x) !== core(w) && x.en !== w.en && !genderTwin(core(x), core(w)));
    // prefer the same unit, then the same kind of word (noun with article vs. verb / adjective) so the choice is not given away
    const kind = x => /^(el|la|los|las) /.test(x.es) ? 'n' : /(ar|er|ir|se)$/.test(x.es) ? 'v' : 'o';
    const rank = x => (x.unit === w.unit ? 0 : 2) + (kind(x) === kind(w) ? 0 : 1) + Math.random() * 1.5;
    const ds = pool.sort((a, b) => rank(a) - rank(b)).slice(0, 2);
    const text = x => reverse ? x.en : x.es;
    const options = shuffle([w].concat(ds).map(text));
    if (reverse === 'listen') return { kind: 'mc', pick: true, listenPick: true, audio: true, listen: w.es, label: 'Listen and pick the meaning', options: shuffle([w].concat(ds).map(x => x.en)), answer: w.en, reveal: { es: w.es, en: w.en, note: w.note }, speakAfter: w.es }; // v9.7
    return reverse
      ? { kind: 'mc', pick: true, label: 'Select the correct meaning', bubbleEs: w.es, speakNow: w.es, options, answer: w.en, reveal: { es: w.es, en: w.en, note: w.note }, speakAfter: w.es }
      : { kind: 'mc', pick: true, label: 'Select the correct translation', bubbleEn: w.en, options, answer: w.es, reveal: { es: w.es, en: w.en, note: w.note }, speakAfter: w.es };
  }

  // ---------- tile-order drills (word bank with 2 distractors) ----------
  const tileTokens = text => text.replace(/[¿?¡!.,;:“”"]/g, '').split(/\s+/).filter(Boolean);
  // v9.5: a decoy must change the meaning, never just the gender / number (la for lo, lista for listo, abogada for abogado)
  const gKey = x => { const c = Check.agreeKey(Check.clean(x)); return strip(c).replace(/(os|as|o|a)$/, ''); };
  const genderTwin = (a, b) => strip(a) !== strip(b) && gKey(a) === gKey(b);
  const agreeTwin = (a, b) => strip(a) !== strip(b) && strip(Check.agreeKey(Check.clean(a))) === strip(Check.agreeKey(Check.clean(b)));
  const noTwins = (decoys, tokens, strict) => decoys.filter(d => !tokens.some(t => (strict ? agreeTwin : genderTwin)(d, t)));
  function tileExercise(target, lang, otherTexts, extra) {
    const tokens = tileTokens(target), lower = new Set(tokens.map(strip)); // v9.3: accent-insensitive, so no está/esta twins
    const others = shuffle(otherTexts).slice(0, 4).flatMap(tileTokens);
    const distract = shuffle(noTwins([...new Set(others.filter(t => t.length > 2 && !lower.has(strip(t))))], lang === 'es' ? tokens : [])).slice(0, 2);
    return Object.assign({ kind: 'build', tiles: shuffle(tokens.concat(distract)), answers: [target], orders: lang === 'es' ? ordersFor(target) : [], opts: { lang } }, extra);
  }
  const TILE_SHARE = 0.25; // about 1 in 4 word items with a short example sentence becomes a tile drill
  function withTiles(wordId, type) {
    const ss = IDX.sentByWord[wordId] || [];
    if (!ss.some(x => x.es.split(' ').length <= 10) || Math.random() >= TILE_SHARE) return type;
    return Math.random() < 0.6 ? 'build' : 'buildEn'; // more Spanish-target builds than English-target
  }
  // bind a word bank: #tiles (bank) and #line (answer). The bank never moves: #line reserves 3 rows (see .answer-line).
  function mountTiles(ex, isLocked) {
    const line = document.getElementById('line'), tiles = document.getElementById('tiles'); ex.order = [];
    // reserve at least as many rows as the bank itself needs (the answer can't take more), so long sentences don't shift it either
    // (+1 spare row once the bank wraps to 3+ rows, since an answer in another order can pack worse than the bank does,
    // but only while the bank still fits above the footer; otherwise the bank would start out hidden on small phones)
    const bankRows = new Set([...tiles.children].map(t => t.offsetTop)).size;
    const reserve = n => { line.style.minHeight = n > 3 ? `calc(${n} * var(--tile-h) + ${n - 1} * var(--tile-gap) + 16px)` : ''; };
    reserve(bankRows);
    if (bankRows >= 3) {
      const ft = document.querySelector('footer'), limit = ft ? ft.getBoundingClientRect().top : innerHeight;
      const room = limit - tiles.getBoundingClientRect().bottom, rowH = tiles.firstElementChild ? tiles.firstElementChild.offsetHeight + 8 : 60;
      if (room >= rowH) reserve(bankRows + 1);
    }
    // v9.2: Duolingo-style glide (FLIP, transform only, ~240 ms ease-out). ex.order is the only state and is updated before any
    // animation, so rapid taps mid-flight can't lose or duplicate tiles; the DOM is re-synced from it on every tap. Bank tiles
    // never move or leave the bank (a tile out of it is a grey placeholder), so the bank never reflows.
    const bankEl = k => tiles.querySelector(`.tile[data-k="${k}"]`);
    const lineEls = new Map(), ghosts = new Map(); // k → tile in the answer line; k → copy flying back to its placeholder
    const D = 240, EASE = 'cubic-bezier(.2,.8,.3,1)';
    const motion = () => S.settings.anim !== false && !!Element.prototype.animate && !(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
    const glide = (el, from) => {
      if (el.getAnimations) el.getAnimations().forEach(a => a.cancel());
      const to = el.getBoundingClientRect(), dx = from.left - to.left, dy = from.top - to.top;
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) el.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'none' }], { duration: D, easing: EASE });
    };
    const sync = (k, adding) => {
      const anim = motion(), first = new Map();
      if (anim) lineEls.forEach((el, j) => first.set(j, el.getBoundingClientRect())); // FIRST (mid-flight positions included)
      let src = null;
      if (anim && k != null) src = adding ? (ghosts.has(k) ? ghosts.get(k).getBoundingClientRect() : bankEl(k).getBoundingClientRect()) : lineEls.has(k) ? lineEls.get(k).getBoundingClientRect() : null;
      if (ghosts.has(k)) { ghosts.get(k).remove(); ghosts.delete(k); } // tapped again while flying home
      [...lineEls.keys()].forEach(j => { if (!ex.order.includes(j)) { lineEls.get(j).remove(); lineEls.delete(j); } });
      ex.order.forEach(j => {
        let el = lineEls.get(j);
        if (!el) { el = document.createElement('button'); el.className = 'tile in'; el.type = 'button'; el.dataset.k = j; el.textContent = ex.tiles[j]; const b = bankEl(j); if (b && b.dataset.lp != null) el.dataset.lp = b.dataset.lp; lineEls.set(j, el); }
        if (line.lastElementChild !== el || el.parentNode !== line) line.appendChild(el);
      });
      tiles.querySelectorAll('.tile').forEach(t => { const j = +t.dataset.k; t.classList.toggle('used', ex.order.includes(j)); t.classList.toggle('landing', ghosts.has(j)); });
      if (!anim) return;
      lineEls.forEach((el, j) => { const f = j === k && adding ? src : first.get(j); if (f) glide(el, f); }); // LAST → INVERT → PLAY
      if (!adding && src) { // a copy flies from the answer line back to its exact placeholder
        const home = bankEl(k), to = home.getBoundingClientRect(), gh = home.cloneNode(true);
        gh.className = 'tile tile-ghost'; gh.removeAttribute('data-lp'); gh.removeAttribute('data-k'); gh.setAttribute('aria-hidden', 'true'); gh.tabIndex = -1;
        Object.assign(gh.style, { left: to.left + 'px', top: to.top + 'px', width: to.width + 'px', height: to.height + 'px' });
        document.body.appendChild(gh); ghosts.set(k, gh); home.classList.add('landing');
        const a = gh.animate([{ transform: `translate(${src.left - to.left}px,${src.top - to.top}px)` }, { transform: 'none' }], { duration: D, easing: EASE });
        a.onfinish = () => { if (ghosts.get(k) === gh) { ghosts.delete(k); home.classList.remove('landing'); } gh.remove(); };
      }
    };
    tiles.onclick = e => { const t = e.target.closest('.tile'); if (!t || isLocked() || ex.order.includes(+t.dataset.k)) return; ex.order.push(+t.dataset.k); sync(+t.dataset.k, true); };
    line.onclick = e => { const t = e.target.closest('.tile'); if (!t || isLocked() || !ex.order.includes(+t.dataset.k)) return; ex.order = ex.order.filter(k => k !== +t.dataset.k); sync(+t.dataset.k, false); };
    const read = () => { if (!ex.order.length) return null; const v = ex.order.map(k => ex.tiles[k]).join(' '); const full = Check.checkOrder(v, ex.answers, { lang: ex.opts.lang, typo: false }, ex.orders), res = full.result; return { v, res, full, ok: res === 'exact' || res === 'accent' || res === 'agree' }; }; // v9.6: other valid word orders count // v9.5: agreement slips count
    // v9.5 voice build: clear the answer, then glide the matched tiles in one after another (same FLIP glide as a tap)
    let placeT = [];
    read.place = ks => {
      placeT.forEach(clearTimeout); placeT = [];
      if (isLocked()) return;
      [...ex.order].reverse().forEach(k => { ex.order = ex.order.filter(j => j !== k); sync(k, false); });
      ks.forEach((k, n) => placeT.push(setTimeout(() => { if (isLocked() || ex.order.includes(k)) return; ex.order.push(k); sync(k, true); }, 60 + n * 90)));
    };
    return read;
  }
  const tilesHtml = ex => `<div class="answer-line" id="line"></div><div class="tiles" id="tiles">${ex.tiles.map((t, k) => `<button class="tile" data-k="${k}"${ex.opts.lang === 'es' ? ` data-lp="${esc(t)}"` : ''}>${esc(t)}</button>`).join('')}</div>`;

  // ---------- fast double-tap guard (Continue / Check / Next never fire twice for one double tap) ----------
  let lastStep = 0;
  const guardMs = () => (navigator.webdriver && !window.__forceTapGuard) ? 0 : 450; // automation clicks are deliberate
  function stepOk() { const t = performance.now(); if (t - lastStep < guardMs()) return false; lastStep = t; return true; }
  const step = fn => (...a) => { if (stepOk()) fn(...a); };

  // ---------- runner (placement, review, and the intro/practice/test stones share this) ----------
  let run = null;
  // words new to the learner (no card yet, or seen only once) get the purple "new" highlight in prompts during this run
  function newIdsFor(queue) { const ids = new Set(); queue.forEach(e => { if (e.id && e.id.startsWith('w:')) { const c = S.items[e.id]; if (!c || ((c.reps || 0) < 2 && !c.known)) ids.add(e.id.slice(2)); } }); return ids; }
  // v9.5: a session is a fixed set of N drills. A miss never adds drills: the same item goes to the back of the line (fresh
  // shuffle) and the session ends once every drill has been answered right once. The bar = drills right / N. The v9.4 rule-card
  // pacing (3 drills of a new pattern in a row) is planned here, when the session is built, so it is part of N from the start.
  const isDrill = e => !!(e && e.id && !e.theme && !e.intro);
  let keySeq = 0;
  function planRun(queue, mode) {
    if (mode !== 'placement' && mode !== 'test') {
      const seen = new Set();
      for (let k = 0; k < queue.length; k++) {
        const e = queue[k]; if (!isDrill(e) || !e.id.startsWith('p:') || e.focus) continue; // v9.6 focus drills already open with 2 contrasts
        const pk = e.id.slice(2); if (seen.has(pk)) continue; seen.add(pk);
        if (S.rulesSeen[pk] || !IDX.patterns[pk] || !IDX.patterns[pk].rule) continue;
        let n = 0; while (k + n < queue.length && queue[k + n].id === e.id && !queue[k + n].intro) n++;
        for (; n < 3; n++) queue.splice(k + n, 0, { id: e.id, practice: true, paced: true });
      }
    }
    queue.forEach(e => { if (isDrill(e) && !e.key) e.key = ++keySeq; });
    return queue;
  }
  function runCounts() {
    if (!run) return { done: 0, n: 0 };
    const keys = new Set(); let done = 0;
    run.queue.forEach(e => { if (!isDrill(e)) return; if (!e.key) e.key = ++keySeq; if (keys.has(e.key)) return;
      if (run.done.has(e.key) || run.mode === 'placement' || !isParked(e.id)) { keys.add(e.key); if (run.done.has(e.key)) done++; } });
    return { done, n: keys.size };
  }
  const runFrac = () => { const c = runCounts(); return c.n ? c.done / c.n : 0; };
  // the missed drill goes to the back: same item (same word / same grammar sentence), new shuffle, practice only for SRS
  function cycleBack(entry, ex) {
    const copy = Object.assign({}, entry, { retry: (entry.retry || 0) + 1, practice: true });
    delete copy.ok;
    if (ex && ex.item && entry.id.startsWith('p:')) { const ix = IDX.patterns[entry.id.slice(2)].items.indexOf(ex.item); if (ix >= 0) copy.itemIdx = ix; }
    run.queue.push(copy);
  }
  function startRun(queue, mode, meta) { sessionStart(); run = Object.assign({ queue: planRun(queue, mode), i: 0, mode, results: [], firstDone: {}, score: 0, total: 0, misses: [], done: new Set() }, meta || {}); run.newIds = mode === 'placement' ? new Set() : newIdsFor(queue);
    const f = queue.find(e => e.focus); // v9.6: the session's one grammar pattern
    try { window.scrollTo(0, 0); } catch (e) {}
    if (f) { run.focus = f.id.slice(2); run.focusCard = !S.rulesSeen[run.focus]; S.focusLog = [run.focus].concat((S.focusLog || []).filter(x => x !== run.focus)).slice(0, 10); save(); }
    nextCard(); }
  function nextCard() {
    while (run.i < run.queue.length && run.queue[run.i].id && run.queue[run.i].id.startsWith('w:') && isParked(run.queue[run.i].id) && run.mode !== 'placement') run.i++;
    if (run.i >= run.queue.length) return finishRun();
    const entry = run.queue[run.i];
    if (entry.theme) return renderTheme(entry);
    if (entry.intro) return renderIntro(entry);
    const show = () => { run.ex = makeExercise(entry); run.answered = false; renderExercise(entry, run.ex); };
    if (entry.id.startsWith('p:') && ruleOk() && !S.rulesSeen[entry.id.slice(2)] && IDX.patterns[entry.id.slice(2)].rule) return renderRuleStep(entry.id.slice(2), run.i, show);
    show();
  }
  function finishRun() {
    sessionDone();
    if (run.mode === 'placement') return finishPlacement();
    if (run.mode === 'review') return finishReview();
    if (run.mode === 'test') return finishTest();
    const { uid, stone } = run; setStone(uid, stone, true); S.lastStudy = Date.now(); save(); run = null;
    renderHome({ justDone: { uid, stone } });
  }
  function progressBar() { const pct = run.barPct || 0, rc = runCounts(); return `<div class="topbar"><button class="icon" id="quit" aria-label="Close">✕</button><div class="bar"><span style="width:${pct}%"></span></div>${lpHtml()}<span class="count" title="Drills right / drills in this session">${rc.done}/${rc.n}</span></div>`; }
  function setBar(frac) {
    const pct = Math.max(0, Math.min(100, 100 * frac)); if (run) run.barPct = pct;
    const el = app.querySelector('.bar span'); if (!el) return; void el.offsetWidth; el.style.width = pct + '%';
  }
  function bindQuit(onQuit) { bindLp(); document.getElementById('quit').onclick = () => { if (run && run.mode === 'placement' && !confirm('Leave placement? Progress on it will be lost.')) return; hush(); stopRec(); closeHint(); tick(); save(); run = null; story = null; (onQuit || renderHome)(); }; }

  // ---------- v9.4 grammar teaching layer: rule cards, the 📘 Rule button, "why" after every grammar answer ----------
  const ruleOk = () => !!run && run.mode !== 'placement' && run.mode !== 'test'; // no teaching inside placement or the unit test
  function ruleCardHtml(pk) {
    const p = IDX.patterns[pk], r = p && p.rule; if (!r) return p ? `<p>${esc(p.explain)}</p>` : '';
    const say = es => es.replace(/\s*→\s*/g, '. ');
    return `<div class="rule-card" data-p="${esc(pk)}"><div class="rule-title">📘 ${esc(r.title)}</div><p class="rule-text">${esc(r.rule)}</p>
      <div class="rule-formula">${r.formula.map(f => `<div>${esc(f)}</div>`).join('')}</div>
      <div class="rule-ex">${r.ex.map(([es, en]) => `<div class="example" data-en="${esc(en)}"><div>${tokenize(es)} <button class="icon speak" data-say="${esc(say(es))}" aria-label="Play">🔊</button></div><div class="muted">${esc(en)}</div></div>`).join('')}</div>
      ${r.trap ? `<p class="rule-trap"><b>Watch out:</b> ${esc(r.trap)}</p>` : ''}</div>`;
  }
  // first exposure: the card, then (on Continue) at least three drills of this pattern in a row, the first two easy one-contrast ones
  function startPacing(pk, from) {
    S.rulesSeen[pk] = Date.now(); S.pace[pk] = 2; save();
    const q = run.queue, id = pid(pk); let n = 0;
    while (from + n < q.length && q[from + n].id === id && !q[from + n].intro) n++;
    for (; n < 3; n++) q.splice(from + n, 0, { id, practice: true, paced: true });
  }
  function renderRuleStep(pk, from, after) {
    const p = IDX.patterns[pk];
    app.innerHTML = progressBar() + `<main class="card rule-step">${run.focus === pk ? focusHead(pk, false) : ''}<div class="label"><span class="badge new">NEW</span> Grammar rule · ${esc(p.name.replace(/\s*\(.*\)\s*$/, ''))}</div>${ruleCardHtml(pk)}</main><footer><button class="btn primary" id="go">Continue</button></footer>`;
    bindQuit(); bindSpeak(); setBar(runFrac()); try { window.scrollTo(0, 0); } catch (e) {} // v9.6: a rule card always opens at its top
    run.answered = false; run.ruleStep = pk; // (debug surface: __app.entry reports rule: true while the card is up)
    document.getElementById('go').onclick = step(() => { run.ruleStep = null; if (run.focus === pk) run.focusShown = true; startPacing(pk, from); after(); });
  }
  // v9.6: "Today's grammar" header at the start of a focus session (with the one-line reminder when the card was seen before)
  function focusHead(pk, remind) {
    const p = IDX.patterns[pk], r = p.rule || {}, title = r.title || p.name;
    return `<div class="focus-head" data-focus="${esc(pk)}"><div class="focus-title"><span>Today’s grammar: <b>${esc(title)}</b></span>${p.rule ? `<button class="rule-btn" type="button" data-rule="${esc(pk)}">📘 Rule</button>` : ''}</div>${remind && (r.line || r.rule) ? `<div class="focus-line">${esc(r.line || r.rule)}</div>` : ''}</div>`;
  }
  function openRule(pk) {
    closeRule(); closeHint();
    const m = document.createElement('div'); m.className = 'rule-modal'; m.id = 'ruleModal'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true');
    m.innerHTML = `<div class="rule-sheet">${ruleCardHtml(pk)}<button class="btn primary" id="ruleClose" type="button">Got it</button></div>`;
    document.body.appendChild(m);
    m.querySelectorAll('.speak').forEach(b => b.onclick = e => { e.preventDefault(); e.stopPropagation(); speak(b.dataset.say); });
    m.onclick = e => { if (e.target === m || e.target.id === 'ruleClose') closeRule(); };
  }
  function closeRule() { const m = document.getElementById('ruleModal'); if (m) m.remove(); }
  document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('[data-rule]'); if (b) { e.preventDefault(); openRule(b.dataset.rule); } });
  // which wrong option did they give? (an answer button, or a tiles / spoken reply built with that option)
  function wrongFor(it, given) {
    const c = x => Check.stripAcc(Check.clean(x)); if (!it.w || !given) return null;
    for (const o of it.o.slice(1)) {
      const full = it.q.replace('___', o).replace(/\s*\([^)]*\)\s*$/, ''), parts = full.split(' — ');
      if (c(o) === c(given) || c(full) === c(given) || (parts.length === 2 && c(parts[1]) === c(given))) return it.w[o] ? [o, it.w[o]] : null;
    }
    return null;
  }
  function whyHtml(it, pk, ok, given) {
    if (!it || !it.n) return '';
    const wr = ok ? null : wrongFor(it, given), hasRule = pk && IDX.patterns[pk] && IDX.patterns[pk].rule;
    return `<div class="why"><b>Why:</b> ${esc(it.n)}</div>${wr ? `<div class="why-wrong"><b>Not “${esc(wr[0])}”:</b> ${esc(wr[1])}</div>` : ''}${hasRule ? `<button class="rule-link" type="button" data-rule="${esc(pk)}">📘 Rule</button>` : ''}`;
  }

  function renderTheme(entry) {
    const u = C.units[IDX.unitIdx[run.uid]];
    const fresh = u.words.filter(w => !S.parked[w.id] && !knownCard(S.items[wid(w.id)]));
    const known = u.words.filter(w => !S.parked[w.id] && knownCard(S.items[wid(w.id)]));
    const parked = u.words.filter(w => S.parked[w.id]);
    app.innerHTML = progressBar() + `<main class="card"><div class="label">Unit ${IDX.section.units.indexOf(u.id) + 1} · ${esc(IDX.section.cefr)}${u.ta ? ' · <span class="badge ta">Tres Aguas</span>' : ''}</div>
      <h1>${esc(u.title)}</h1><p class="muted">${esc(u.titleEn)}</p>${u.note ? `<p class="muted small">${esc(u.note)}</p>` : ''}
      <h3>New in this unit</h3><ul class="list">${fresh.map(w => `<li><span><span class="badge new">NEW</span> ${wordSpan(w.id, w.es)}</span><span class="muted">${esc(w.en)}</span></li>`).join('') || '<li class="muted">Nothing new — you already know these.</li>'}</ul>
      ${known.length ? `<p class="muted small">Already known: ${known.map(w => wordSpan(w.id, w.es)).join(', ')}</p>` : ''}
      ${parked.length ? `<p class="muted small">Parked: ${parked.map(w => wordSpan(w.id, w.es)).join(', ')}</p>` : ''}
      <p class="muted small">This stone is just the new words: meet each one, then drill them. Grammar (${u.focus.map(p => esc(C.patterns[p].name.replace(/\s*\(.*\)\s*$/, ''))).join(' · ')}) comes later, in Practice.</p>
      <p class="muted small">Tip: press and hold any word to mark it “Not a priority”.</p></main>
      <footer><button class="btn primary" id="go">Start</button></footer>`;
    bindQuit(); setBar(runFrac());
    document.getElementById('go').onclick = step(() => { run.i++; nextCard(); });
  }
  function renderIntro(entry) {
    if (entry.id.startsWith('p:')) return renderRuleStep(entry.id.slice(2), run.i + 1, () => { run.i++; nextCard(); });
    let body;
    if (entry.id.startsWith('w:')) {
      const w = IDX.words[entry.id.slice(2)]; const ex = (IDX.sentByWord[w.id] || [])[0];
      body = `<div class="label"><span class="badge new">NEW</span> New word · ${esc(C.units[w.unitIdx].title)}</div>
        <div class="big">${wordSpan(w.id, w.es)} <button class="icon speak" data-say="${esc(w.es)}">🔊</button></div>
        <div class="en">${esc(w.en)}</div>${w.note ? `<p class="note">${esc(w.note)}</p>` : ''}
        ${ex ? `<div class="example" data-en="${esc(ex.en)}"><div>${tokenize(ex.es)} <button class="icon speak" data-say="${esc(ex.es)}">🔊</button></div><div class="muted">${esc(ex.en)}</div></div>` : ''}
        <div class="row"><button class="btn secondary" id="known">I already know this</button></div>`;
    } else {
      const p = IDX.patterns[entry.id.slice(2)];
      body = `<div class="label"><span class="badge new">NEW</span> Grammar pattern</div><div class="title">${esc(p.name)}</div><p>${esc(p.explain)}</p>`;
    }
    app.innerHTML = progressBar() + `<main class="card">${body}</main><footer><button class="btn primary" id="go">Continue</button></footer>`;
    bindQuit(); bindSpeak(); setBar(runFrac());
    if (entry.id.startsWith('w:')) autoSpeak(IDX.words[entry.id.slice(2)].es);
    const known = document.getElementById('known');
    if (known) known.onclick = () => {
      const prev = S.items[entry.id], removed = run.queue.filter((e, k) => k > run.i && e.id === entry.id);
      S.items[entry.id] = SRS.markKnown(S.items[entry.id], Date.now(), 120);
      run.queue = run.queue.filter((e, k) => k <= run.i || e.id !== entry.id); run.i++;
      hideEasy(entry.id, prev, removed); nextCard();
    };
    document.getElementById('go').onclick = step(() => { run.i++; nextCard(); });
  }

  function renderExercise(entry, ex) {
    closeHint(); document.querySelectorAll('.tile-ghost').forEach(n => n.remove());
    let prompt = '';
    if (ex.listenPick) prompt = `<div class="listen"><button class="btn play" id="play">🔊 Play</button><button class="btn secondary" id="slow">🐢 Slow</button></div>`;
    else if (ex.kind === 'mc' && ex.pick) prompt = ex.bubbleEs ? bubble(ex.bubbleEs, 'es', ex.speakNow) : bubble(ex.bubbleEn, 'en');
    else if (ex.kind === 'mc') prompt = `<div class="prompt">${tokenize(ex.prompt).replace('___', '<span class="blank">___</span>')}</div>`;
    else if (ex.kind === 'speak') prompt = bubble(ex.sayEs, 'es', ex.sayEs);
    else if (ex.kind === 'build') prompt = ex.bigEs ? bubble(ex.bigEs, 'es', ex.bigEs) : bubble(ex.big, 'en');
    else if (ex.listen) prompt = `<div class="listen"><button class="btn play" id="play">🔊 Play</button><button class="btn secondary" id="slow">🐢 Slow</button></div>`;
    else if (ex.clozeEs) prompt = `<div class="prompt">${tokenize(ex.clozeEs).replace('_____', '<span class="blank">_____</span>')}</div><div class="muted sub">${esc(ex.sub)}</div>`;
    else if (ex.flip) prompt = `<div class="flipstack"><div class="flip" id="flipCard"><div class="face front"><div class="flip-en">${esc(ex.big)}</div></div><div class="face back"><div class="flip-es">${tokenize(ex.back)}</div><button class="icon speak" data-say="${esc(ex.back)}" aria-label="Play">🔊</button></div></div></div>`;
    else if (ex.bubbleEs) prompt = bubble(ex.bubbleEs, 'es', ex.speakNow);
    else prompt = `<div class="big">${ex.bigW ? wordSpan(ex.bigW, ex.big) : esc(ex.big)}${ex.speakNow ? ` <button class="icon speak" data-say="${esc(ex.speakNow)}">🔊</button>` : ''}</div>`;
    if (ex.hintEn && (ex.kind === 'build' || ex.kind === 'speak')) prompt += `<p class="muted sub pat-en">${esc(ex.hintEn)}</p>`;
    let input;
    const optEs = ex.kind === 'mc' && (!ex.pick || !!ex.bubbleEn); // grammar options and "select the translation" options are Spanish
    if (ex.kind === 'mc') input = `<div class="options${ex.pick ? ' stack' : ''}">${ex.options.map((o, k) => `<button class="opt${ex.pick ? ' big-opt' : ''}" data-k="${k}"${optEs ? ` data-lp="${esc(o)}"` : ''}>${esc(o)}</button>`).join('')}</div>`;
    else if (ex.kind === 'build') input = tilesHtml(ex);
    else if (ex.kind === 'speak') input = `<div class="mic-wrap"><button class="mic" id="mic" type="button" aria-label="Tap and say the sentence"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-2.1A7 7 0 0 0 19 12z" fill="currentColor"/></svg><span class="mic-label">Tap to speak</span></button><div class="heard muted" id="heard" aria-live="polite"></div></div>`;
    // v9.2: a wrapping, self-growing textarea (2 → ~6 lines, then scrolls) instead of a one-line input; Return still checks
    else input = `<form id="f" autocomplete="off"><textarea id="ans" class="ans" rows="2" lang="${ex.opts.lang}" placeholder="${esc(ex.placeholder)}" autocapitalize="off" autocorrect="off" autocomplete="off" spellcheck="false" enterkeyhint="done"></textarea></form>`;
    const cant = ex.audio ? '<button class="cant-listen" id="cantListen" type="button">🔇 No puedo escuchar ahora <span class="muted">· Can’t listen now</span></button>'
      : ex.kind === 'speak' ? '<button class="cant-listen" id="cantSpeak" type="button">🤐 No puedo hablar ahora <span class="muted">· Can’t speak now</span></button>' : '';
    const fh = run.focus && ex.pk === run.focus && !run.focusShown ? focusHead(ex.pk, !run.focusCard) : ''; if (fh) run.focusShown = true; // v9.6 header (has its own 📘)
    const ruleBtn = !fh && ex.pk && ruleOk() && IDX.patterns[ex.pk].rule ? `<button class="rule-btn" id="ruleBtn" type="button" data-rule="${esc(ex.pk)}">📘 Rule</button>` : ''; // v9.4
    const label = `<div class="label${ruleBtn ? ' with-rule' : ''}"><span>${run.mode === 'test' ? 'Test · ' : ''}${esc(ex.label)}</span>${ruleBtn}</div>`;
    const vm = ex.kind === 'mc' || ex.kind === 'speak' ? '' : vmicHtml(); // v9.5: say it instead of typing / tapping tiles
    const foot = ex.kind === 'mc' ? '' : ex.flip ? `<button class="btn secondary" id="skip" aria-label="Flip the card to see the answer">↻ Flip</button>${vm}<button class="btn primary" id="check">Check</button>`
      : ex.kind === 'speak' ? '<button class="btn secondary" id="skip">I don\'t know</button>' : `<button class="btn secondary" id="skip">I don\'t know</button>${vm}<button class="btn primary" id="check">Check</button>`;
    app.innerHTML = progressBar() + `<main class="card ex-${ex.kind}${ex.flip ? ' ex-flip' : ''}${hintsOff() ? ' hints-off' : ''}">${fh}${newLabel(prompt)}${label}${prompt}${input}${vm ? '<div class="vheard muted small" id="vheard" aria-live="polite"></div>' : ''}${cant}<div id="fb"></div></main><footer${vm ? ' class="has-vmic"' : ''}>${foot}</footer>`;
    bindQuit(); bindSpeak(); setBar(runFrac());
    if (ex.audio) document.getElementById('cantListen').onclick = e => cantListen(entry, e.currentTarget);
    if (ex.listen) {
      document.getElementById('play').onclick = () => speak(ex.listen);
      document.getElementById('slow').onclick = () => speak(ex.listen, true);
      speak(ex.listen);
    }
    if (ex.kind === 'mc') {
      if (ex.speakNow) autoSpeak(ex.speakNow);
      app.querySelectorAll('.opt').forEach(b => b.onclick = () => {
        if (run.answered) return;
        const ok = ex.options[+b.dataset.k] === ex.answer;
        app.querySelectorAll('.opt').forEach(x => { if (ex.options[+x.dataset.k] === ex.answer) x.classList.add('right'); });
        if (!ok) b.classList.add('wrong');
        answer(entry, ex, ok ? 'exact' : 'wrong', ok ? ex.answer : b.textContent);
      });
      return;
    }
    if (ex.kind === 'build') {
      const read = mountTiles(ex, () => run.answered);
      if (ex.bigEs) autoSpeak(ex.bigEs);
      voiceTiles(ex, read, () => run.answered);
      const doCheck = () => { stopRec(); const r = read(); if (!r) return; ex.res = r.full; answer(entry, ex, r.ok ? (r.res === 'agree' ? 'agree' : 'exact') : 'wrong', r.v); };
      document.getElementById('check').onclick = () => run.answered ? advance() : doCheck();
      document.getElementById('skip').onclick = () => { if (!run.answered) { stopRec(); answer(entry, ex, 'wrong', ''); } };
      return;
    }
    if (ex.kind === 'speak') {
      autoSpeak(ex.sayEs);
      document.getElementById('cantSpeak').onclick = e => cantSpeak(entry, e.currentTarget);
      document.getElementById('skip').onclick = () => { if (!run.answered) { stopRec(); answer(entry, ex, 'wrong', ''); } };
      mountMic(ex.sayEs, {
        locked: () => run.answered,
        done: (r) => { ex.heard = r.heard; answer(entry, ex, r.result, r.heard); },
        retry: (r) => { ex.tries++; return ex.tries < 2; }, // two tries, then it is graded
        blocked: () => { blockSpeech(); if (!run || run.queue[run.i] !== entry || run.answered) return; run.ex = makeExercise(entry); renderExercise(entry, run.ex); }
      });
      return;
    }
    const inp = document.getElementById('ans'); setTimeout(() => inp.focus(), 50);
    mountAnswerBox(inp, () => { if (run.answered) return advance(); doCheck(); });
    voiceType(inp, ex.opts.lang, () => run.answered);
    const doCheck = () => { stopRec(); const v = inp.value.replace(/[\r\n]+/g, ' '); if (!v.trim()) return; let r = ex.alts ? Check.checkAlt(v, ex.answers, ex.opts, ex.alts) : Check.check(v, ex.answers, ex.opts); if (r.result === 'wrong' && ex.orders && ex.orders.length) r = Check.checkOrder(v, ex.answers, ex.opts, ex.orders); ex.matched = r.result === 'alt' ? null : r.answer; ex.res = r; answer(entry, ex, r.result, v); };
    document.getElementById('f').onsubmit = e => { e.preventDefault(); if (run.answered) return advance(); doCheck(); };
    document.getElementById('check').onclick = () => run.answered ? advance() : doCheck();
    document.getElementById('skip').onclick = () => {
      if (run.answered) return;
      stopRec();
      if (ex.flip) { flipCard(true); ex.flipped = true; } // turning the card over shows the answer: graded as a miss
      answer(entry, ex, 'wrong', '');
    };
  }
  // v9.2: answer textarea: no newlines (Return submits, pasted line breaks become spaces), grows with its content
  const oneLine = v => v.replace(/[ \t]*[\r\n]+[ \t]*/g, ' ');
  function growBox(inp) {
    const cs = getComputedStyle(inp), max = parseFloat(cs.maxHeight) || 220, bd = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
    inp.style.height = 'auto'; const h = inp.scrollHeight + bd;
    inp.style.height = Math.min(h, max) + 'px'; inp.style.overflowY = h > max + 1 ? 'auto' : 'hidden';
  }
  function mountAnswerBox(inp, submit) {
    inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); submit(); } });
    inp.addEventListener('input', () => {
      if (/[\r\n]/.test(inp.value)) { const p = inp.selectionStart, before = oneLine(inp.value.slice(0, p)).length; inp.value = oneLine(inp.value); try { inp.setSelectionRange(before, before); } catch (e) { /* ignore */ } }
      growBox(inp);
    });
    inp.addEventListener('focus', () => setTimeout(keepFooterVisible, 350));
    growBox(inp);
  }
  // iOS: the keyboard covers the bottom of the layout viewport. Lift the footer (Check) by exactly the part the visible area
  // (visualViewport) doesn't show, and keep the answer box above it.
  function keepFooterVisible() {
    const vv = window.visualViewport, f = app.querySelector('footer'); if (!vv || !f) return;
    f.style.transform = '';
    const visBottom = vv.offsetTop + vv.height, over = Math.round(f.getBoundingClientRect().bottom - visBottom);
    if (over > 1 && window.innerHeight - visBottom > 80) { // keyboard is up
      f.style.transform = `translateY(${-over}px)`;
      const a = document.getElementById('ans'); if (a) { const top = f.getBoundingClientRect().top, ar = a.getBoundingClientRect(); if (ar.bottom > top - 8) window.scrollBy(0, ar.bottom - top + 16); }
    }
  }
  if (window.visualViewport) { window.visualViewport.addEventListener('resize', keepFooterVisible); window.visualViewport.addEventListener('scroll', keepFooterVisible); }
  function flipCard(on) { const c = document.getElementById('flipCard'); if (c) c.classList.toggle('flipped', on); }

  // ---------- v8 repeat-after-me: microphone + SpeechRecognition (es-MX) ----------
  // v9.1 hardening (iOS Home Screen apps): webkitSpeechRecognition there can hang without ever firing onresult/onend/onerror,
  // start() can throw, and starting it while the v9 <audio> element or speechSynthesis still holds the audio session can stall.
  // So: release all audio first, try/catch start(), a watchdog (8 s with no result, 12 s hard cap, 1.5 s after a stop tap),
  // every handler ignores a stale recogniser, and the UI always comes back. Skip / Can't speak now are never disabled or covered.
  // Two hangs/failures in a session switch speaking drills off for the session (toast + 🤐 pill to turn them back on).
  const MIC_IDLE = 8000, MIC_CAP = 12000, MIC_STOP = 1500;
  const micTimes = () => window.__micTimes || [MIC_IDLE, MIC_CAP, MIC_STOP]; // tests may shorten these
  let rec = null, recT = [];
  const clearRecTimers = () => { recT.forEach(clearTimeout); recT = []; };
  function stopRec() {
    clearRecTimers();
    if (rec) { const r = rec; rec = null; r.onresult = r.onerror = r.onend = r.onnomatch = r.onspeechend = r.onaudiostart = null; try { r.abort(); } catch (e) { /* ignore */ } }
    document.querySelectorAll('.vmic.on').forEach(b => { b.classList.remove('on'); b.setAttribute('aria-pressed', 'false'); const l = b.querySelector('.vmic-label'); if (l) l.textContent = 'Say it'; });
    document.querySelectorAll('.mic.on').forEach(b => { b.classList.remove('on'); b.setAttribute('aria-pressed', 'false'); const l = b.querySelector('.mic-label'); if (l) l.textContent = 'Tap to speak'; });
  }
  function releaseAudio() { // free the audio session before the mic takes it (pause + drop the clip, cancel device speech)
    if (Rec.release) Rec.release(); else if (Rec.stop) Rec.stop();
    if ('speechSynthesis' in window) try { speechSynthesis.cancel(); } catch (e) { /* ignore */ }
  }
  function mountMic(target, h) {
    const mic = document.getElementById('mic'), heard = document.getElementById('heard');
    const setState = (on, msg) => { mic.classList.toggle('on', on); mic.setAttribute('aria-pressed', on ? 'true' : 'false'); mic.querySelector('.mic-label').textContent = on ? 'Listening… tap to stop' : 'Tap to speak'; if (msg != null) heard.innerHTML = msg; };
    const AGAIN = 'I didn’t hear anything. Tap the mic and try again.';
    // the recogniser hung, timed out or threw: recover the card; the second time this session, turn speaking drills off
    const failed = (r, why) => {
      if (r && rec !== r) return; stopRec(); micFails++;
      if (micFails >= 2) { toast('Mic isn’t responding, so speaking drills are off for now'); return h.blocked(why || 'timeout'); }
      setState(false, 'The mic didn’t respond. Tap it to try again, or use Skip.');
    };
    mic.onclick = () => {
      if (h.locked()) return;
      if (rec) { // tap to stop: grade what was heard; if iOS never answers the stop, give the card back anyway
        const r = rec; try { r.stop(); } catch (e) { return failed(r, 'stop-failed'); }
        mic.querySelector('.mic-label').textContent = 'Checking…';
        recT.push(setTimeout(() => { if (rec === r) { stopRec(); setState(false, AGAIN); } }, micTimes()[2]));
        return;
      }
      const Ctor = Speech.ctor(window);
      if (!Ctor) return h.blocked('unavailable');
      releaseAudio();
      let r;
      try { r = new Ctor(); } catch (e) { return h.blocked('unavailable'); }
      rec = r;
      try { r.lang = 'es-MX'; r.interimResults = false; r.maxAlternatives = 5; r.continuous = false; } catch (e) { /* optional on some engines */ }
      let got = false;
      const live = () => rec === r;
      r.onresult = e => {
        if (!live()) return;
        let alts = [];
        try { const res = e.results[e.results.length - 1]; if (res && res.isFinal === false) return; for (let k = 0; k < res.length; k++) alts.push(res[k].transcript); } catch (err) { alts = []; }
        got = true; stopRec(); setState(false); micFails = 0;
        const g = Speech.grade(alts, target);
        if (g.result !== 'wrong') return h.done(g);
        if (!alts.length) return setState(false, AGAIN);
        if (h.retry(g)) { setState(false, `Heard: “${esc(g.heard)}”. <b>Try again.</b>`); FX.miss([mic]); return; }
        h.done(g);
      };
      r.onnomatch = () => { if (!live()) return; stopRec(); setState(false, 'I couldn’t make that out. Tap the mic and try again.'); };
      r.onerror = e => {
        if (!live()) return;
        const err = e && e.error; stopRec(); setState(false);
        if (Speech.isBlocking(err)) { toast(err === 'not-allowed' || err === 'service-not-allowed' ? 'Mic not allowed, so speaking drills are off for now' : 'Mic unavailable, so speaking drills are off for now'); return h.blocked(err); }
        if (err === 'aborted') return setState(false, '');
        setState(false, err === 'no-speech' ? AGAIN : 'Something went wrong with the mic. Tap it to try again, or use Skip.');
      };
      r.onend = () => { if (!live()) return; stopRec(); setState(false, got ? null : AGAIN); };
      try { r.start(); } catch (e) { rec = null; return failed(null, 'start-failed'); }
      setState(true, '');
      // watchdog: nothing within 8 s (no result / end / error) or 12 s in total → abort and give the card back
      let last = performance.now();
      ['onaudiostart', 'onsoundstart', 'onspeechstart'].forEach(k => { try { r[k] = () => { last = performance.now(); }; } catch (e) { /* ignore */ } });
      const [tIdle, tCap] = micTimes();
      const idle = () => { if (!live()) return; if (performance.now() - last >= tIdle - 50) return failed(r, 'timeout'); recT.push(setTimeout(idle, tIdle - (performance.now() - last))); };
      recT.push(setTimeout(idle, tIdle), setTimeout(() => failed(r, 'timeout'), tCap));
    };
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && rec) stopRec(); });

  // ---------- v9.5 voice input: say the answer instead of typing it or tapping tiles ----------
  // A 🎤 "Say it" button next to Check on every typed-answer card (dictation, flip, translate) and tile builder, in every
  // lesson type including the unit test. Typed cards fill the box live (interim results) and stay editable; tile builders
  // map the words onto the bank in spoken order. Nothing is ever submitted: he still taps Check. Same v9.1 hardening as
  // repeat-after-me (release audio, try/catch start, 8 s idle / 12 s cap watchdog, 1.5 s after a stop tap); a refused or
  // missing recogniser hides the button with a short note, and the 🤐 pause hides it too (speakOk()).
  const MIC_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-2.1A7 7 0 0 0 19 12z" fill="currentColor"/></svg>';
  const vmicHtml = () => speakOk() ? `<button class="vmic" id="vmic" type="button" aria-label="Say it instead of typing" aria-pressed="false">${MIC_SVG}<span class="vmic-label">Say it</span></button>` : '';
  function mountVoice(lang, h) {
    const btn = document.getElementById('vmic'); if (!btn) return;
    const note = html => { const n = document.getElementById('vheard'); if (n) n.innerHTML = html || ''; };
    const setOn = on => { btn.classList.toggle('on', on); btn.setAttribute('aria-pressed', on ? 'true' : 'false'); const l = btn.querySelector('.vmic-label'); if (l) l.textContent = on ? 'Stop' : 'Say it'; };
    const AGAIN = 'I didn’t hear anything. Tap 🎤 and try again, or type it.';
    const off = why => { // refused / unavailable / hung twice: no more voice input this session, but the card keeps working
      blockSpeech(); stopRec(); document.querySelectorAll('.vmic').forEach(b => b.remove());
      document.querySelectorAll('footer.has-vmic').forEach(f => f.classList.remove('has-vmic'));
      note(why === 'not-allowed' || why === 'service-not-allowed' ? 'Mic not allowed, so type it instead.' : 'Voice input isn’t available right now, so type it instead.');
    };
    btn.onclick = e => {
      e.preventDefault();
      if (h.locked()) return;
      if (rec) { // tap to stop: use what was heard; if iOS never answers the stop, finish anyway
        const r = rec; try { r.stop(); } catch (err) { stopRec(); return h.text ? h.done(h.text) : note(AGAIN); }
        recT.push(setTimeout(() => { if (rec === r) { stopRec(); if (h.text) h.done(h.text); else note(AGAIN); } }, micTimes()[2]));
        return;
      }
      const Ctor = Speech.ctor(window);
      if (!Ctor) return off('unavailable');
      releaseAudio();
      let r; try { r = new Ctor(); } catch (err) { return off('unavailable'); }
      rec = r; h.text = ''; let delivered = false;
      try { r.lang = lang === 'en' ? 'en-US' : 'es-MX'; r.interimResults = true; r.maxAlternatives = 1; r.continuous = false; } catch (err) { /* optional */ }
      const live = () => rec === r;
      let last = performance.now();
      const deliver = () => { if (delivered) return; delivered = true; if (h.text) h.done(h.text); else note(AGAIN); };
      r.onresult = ev => {
        if (!live()) return; last = performance.now();
        let txt = '', fin = true;
        try { for (let k = 0; k < ev.results.length; k++) { txt += (k ? ' ' : '') + ev.results[k][0].transcript; if (ev.results[k].isFinal === false) fin = false; } } catch (err) { return; }
        h.text = txt.replace(/\s+/g, ' ').trim(); micFails = 0;
        if (h.interim) h.interim(h.text);
        if (fin) { stopRec(); setOn(false); deliver(); }
      };
      r.onnomatch = () => { if (!live()) return; stopRec(); setOn(false); deliver(); };
      r.onerror = ev => {
        if (!live()) return;
        const err = ev && ev.error; stopRec(); setOn(false);
        if (Speech.isBlocking(err)) return off(err);
        if (err === 'aborted') return;
        if (h.text) return deliver();
        note(err === 'no-speech' ? AGAIN : 'Something went wrong with the mic. Tap 🎤 to try again, or type it.');
      };
      r.onend = () => { if (!live()) return; stopRec(); setOn(false); deliver(); };
      const failed = () => { if (!live()) return; stopRec(); setOn(false); micFails++; if (h.text) return deliver(); if (micFails >= 2) return off('timeout'); note('The mic didn’t respond. Tap 🎤 to try again, or type it.'); };
      try { r.start(); } catch (err) { rec = null; micFails++; return micFails >= 2 ? off('start-failed') : note('The mic didn’t start. Tap 🎤 to try again, or type it.'); }
      setOn(true); note('<span class="vlisten">Listening… say the sentence, then tap Stop or just pause</span>');
      ['onaudiostart', 'onsoundstart', 'onspeechstart'].forEach(k => { try { r[k] = () => { last = performance.now(); }; } catch (err) { /* ignore */ } });
      const [tIdle, tCap] = micTimes();
      const idle = () => { if (!live()) return; if (performance.now() - last >= tIdle - 50) return failed(); recT.push(setTimeout(idle, tIdle - (performance.now() - last))); };
      recT.push(setTimeout(idle, tIdle), setTimeout(failed, tCap));
    };
  }
  function voiceType(inp, lang, locked) { // the words appear in the box as he speaks; he can edit them before Check
    if (!document.getElementById('vmic')) return;
    let base = '', lastVoice = '';
    const put = t => { inp.value = oneLine(base + t); growBox(inp); };
    // a second try replaces the first one (unless he edited it); text he typed himself stays and the speech is added after it
    const start = () => { if (h.started) return; h.started = true; const v = inp.value.trim(); base = v && v !== lastVoice ? v + ' ' : ''; };
    const h = { locked, text: '',
      interim: t => { start(); put(t); },
      done: t => { start(); put(t); lastVoice = inp.value.trim(); h.started = false; const n = document.getElementById('vheard'); if (n) n.innerHTML = 'Edit it if needed, then tap <b>Check</b>.'; } };
    document.getElementById('vmic').addEventListener('pointerdown', () => { h.started = false; }, true);
    mountVoice(lang, h);
  }
  function voiceTiles(ex, read, locked) { // the heard words go onto the matching tiles in spoken order; the rest is left to tap
    if (!document.getElementById('vmic')) return;
    const show = (m, final) => {
      const n = document.getElementById('vheard'); if (!n) return;
      setTimeout(() => { if (n.isConnected && n.innerHTML) n.scrollIntoView({ block: 'nearest' }); }, final ? 450 : 0);
      n.innerHTML = m.words.length ? `Heard: “${m.words.map(x => x.ok ? esc(x.w) : `<span class="vmiss" title="No tile for this word">${esc(x.w)}</span>`).join(' ')}”${final && m.unmatched.length ? ' · tap tiles to fix the rest' : ''}` : '';
    };
    const h = { locked, text: '',
      interim: t => show(Speech.mapToTiles(t, ex.tiles, ex.opts.lang), false),
      done: t => { const m = Speech.mapToTiles(t, ex.tiles, ex.opts.lang); ex.voiceHeard = t; show(m, true); read.place(m.order); } };
    mountVoice(ex.opts.lang, h);
  }

  function answer(entry, ex, result, given) {
    run.answered = true; lastStep = performance.now();
    closeUndo(); // v9.5: the next answer retires the Undo snackbar (Progress → Recently hidden still has it)
    const ok = result !== 'wrong';
    // a one-letter slip, a real synonym (v8 'alt') and (v9.3) any accent / ñ / ü difference count as a normal correct answer;
    // only "close" speech is Hard
    const g = result === 'exact' || result === 'accent' || result === 'typo' || result === 'alt' || result === 'agree' ? 3 : ok ? 2 : 1;
    const isPattern = entry.id.startsWith('p:');
    if (isPattern && ex.paced && run.mode !== 'placement') S.pace[ex.pk] = Math.max(0, (S.pace[ex.pk] || 0) - 1); // v9.4 pacing
    const graded = run.mode !== 'placement' && !entry.practice && !run.firstDone[entry.id];
    if (!entry.key) entry.key = ++keySeq;
    if (ok || run.mode === 'placement') run.done.add(entry.key);
    if (run.mode === 'placement') run.results.push({ id: entry.id, ok });
    else {
      if (graded) { run.firstDone[entry.id] = true; run.prev = S.items[entry.id] ? Object.assign({}, S.items[entry.id]) : undefined; grade(entry.id, g); }
      if (isPattern) pstat(entry.id.slice(2), ok);
      if (run.mode === 'test' && !entry.retry) { run.total++; if (ok) run.score++; else run.misses.push(ex.kind === 'mc' ? ex.reveal.es : (ex.reveal.es || ex.answers[0])); entry.ok = ok; } // first attempts only
      if (!ok) cycleBack(entry, ex); // v9.5: no extra drills, the same one comes back at the end
      save();
    }
    const fb = document.getElementById('fb');
    const correctForm = ex.kind === 'mc' ? ex.answer : (ex.matched || ex.answers[0]);
    const ansEs = ex.kind === 'mc' ? (!ex.pick || !!ex.bubbleEn) : !!(ex.opts && ex.opts.lang === 'es'); // v9.2: Spanish answers get tap hints + long-press
    const cf = ansEs ? tokenize(correctForm) : esc(correctForm);
    const head = result === 'alt' ? `<div class="ok">✓ Correct</div><p class="alt-note"><span aria-hidden="true">ℹ️</span> ${esc((ex.res.note || '').replace(/^Correct! /, ''))}${strip(ex.res.answer) !== strip(given) ? ` <span class="muted">Course word: <b>${esc(ex.res.answer)}</b></span>` : ''}</p>`
      : result === 'close' ? `<div class="ok warn">✓ Close. Full line: <b>${esc(ex.answers[0])}</b>${ex.heard ? `<div class="muted small">Heard: “${esc(ex.heard)}”</div>` : ''}</div>`
      : result === 'exact' ? `<div class="ok">✓ Correct</div>${orderNote(ex)}${alsoWritten(ex, correctForm, given)}`
      : result === 'accent' ? `<div class="ok">✓ Correct</div>${ex.res && ex.res.order ? orderNote(ex) : `<div class="muted small spelled">Spelled: ${cf}</div>`}${alsoWritten(ex, correctForm, given)}`
      : result === 'agree' ? `<div class="ok">✓ Correct</div><div class="muted small spelled natural">Natural: ${cf}</div>${alsoWritten(ex, correctForm, given)}`
      : result === 'typo' ? `<div class="ok typo">✓ Correct, watch the spelling: <b class="fixed">${Check.markFixes(correctForm, ex.res)}</b></div>${alsoWritten(ex, correctForm, given)}`
      : ex.flipped ? `<div class="bad">↻ Flipped: <b>${cf}</b></div>`
      : `<div class="bad">✗ ${ex.kind === 'mc' ? 'Answer' : 'Correct answer'}: <b>${cf}</b>${ex.kind === 'speak' && ex.heard ? `<div class="muted small">Heard: “${esc(ex.heard)}”</div>` : ''}</div>`;
    const rv = ex.reveal || {};
    let more = '';
    if (rv.es && rv.es !== correctForm) more += `<div class="rv-es"${rv.en ? ` data-en="${esc(rv.en)}"` : ''}>${tokenize(rv.es)} <button class="icon speak" data-say="${esc(ex.speakAfter || rv.es)}">🔊</button></div>`;
    else if (ex.speakAfter || rv.es) more += `<div><button class="icon speak" data-say="${esc(ex.speakAfter || rv.es)}">🔊</button></div>`;
    if (rv.en) more += `<div class="muted">${esc(rv.en)}</div>`;
    if (isPattern && ex.item) more += whyHtml(ex.item, ex.pk, ok, given); // v9.4: why, right or wrong, + why their pick was wrong
    else if (rv.note && !ok) more += `<p class="note">${esc(rv.note)}</p>`;
    if (rv.ex && !ok) more += `<div class="example" data-en="${esc(rv.ex.en)}"><div>${tokenize(rv.ex.es)}</div><div class="muted">${esc(rv.ex.en)}</div></div>`;
    fb.innerHTML = `<div class="feedback ${ok ? 'good' : 'miss'}">${head}${more}</div>`;
    bindSpeak();
    if (ex.kind === 'build') setTimeout(() => { try { fb.scrollIntoView({ block: 'nearest', behavior: S.settings.anim === false ? 'auto' : 'smooth' }); } catch (e) {} }, 40); // v9.6: the verdict + note is in view under a tall word bank
    const inp = document.getElementById('ans'); if (inp) inp.readOnly = true;
    setBar(runFrac()); { const c = document.querySelector('.topbar .count'), rc = runCounts(); if (c) c.textContent = `${rc.done}/${rc.n}`; }
    const chosen = ex.kind === 'mc' ? app.querySelector(ok ? '.opt.right' : '.opt.wrong') : ex.kind === 'build' ? document.getElementById('line') : ex.kind === 'speak' ? document.getElementById('mic') : inp;
    if (ex.flip) flipCard(true); // the card turns over after Check too, so the Spanish is on the card
    if (ex.kind === 'speak') { const m = document.getElementById('mic'); if (m) m.disabled = true; }
    if (ok) FX.correct([chosen, fb.querySelector('.feedback')]); else FX.miss([chosen]);
    const footer = app.querySelector('footer');
    const extra = [];
    if (!ok && ex.kind === 'type' && given && run.mode !== 'placement') extra.push('<button class="btn secondary" id="override">I was right</button>');
    if (ok && run.mode !== 'placement' && !entry.practice) extra.push('<button class="btn secondary" id="easy">Too easy · hide for months</button>');
    footer.innerHTML = extra.join('') + '<button class="btn primary" id="next">Continue</button>';
    document.getElementById('next').onclick = advance;
    const ov = document.getElementById('override');
    if (ov) ov.onclick = () => {
      if (graded) { if (run.prev) S.items[entry.id] = run.prev; else delete S.items[entry.id]; grade(entry.id, 3); }
      if (run.mode === 'test' && !entry.retry && !entry.ok) { run.score++; entry.ok = true; run.misses.pop(); }
      run.done.add(entry.key); run.queue = run.queue.filter((e, k) => k <= run.i || !(e.key === entry.key && e.retry)); save(); advance(); // v9.5: drop its retry
    };
    const ez = document.getElementById('easy');
    if (ez) ez.onclick = () => { if (performance.now() - lastStep < guardMs()) return; const prev = S.items[entry.id]; S.items[entry.id] = SRS.markKnown(S.items[entry.id], Date.now(), 120); hideEasy(entry.id, prev, []); advance(); };
    if (ok && (result === 'exact' || result === 'accent' || result === 'agree') && S.settings.autoAdvance && run.mode !== 'placement') run.timer = setTimeout(advance, ex.res && ex.res.numbers ? 1800 : 900);
    else setTimeout(() => document.getElementById('next') && document.getElementById('next').focus(), 30);
  }
  function advance() { if (!run || !stepOk()) return; clearTimeout(run.timer); stopRec(); closeHint(); run.i++; nextCard(); }
  // ---------- stone builders ----------
  function introQueue(u) {
    const q = [{ theme: true, id: '' }];
    const fresh = u.words.filter(w => !S.parked[w.id] && !knownCard(S.items[wid(w.id)]));
    // first check right after each new word: the 3-choice picker (alternating directions)
    fresh.forEach((w, k) => { q.push({ id: wid(w.id), intro: true }); q.push({ id: wid(w.id), ex: k % 2 ? 'pick' : 'pickEn' }); });
    // v9.7: no grammar in this stone (rule cards and pattern drills moved to Practice). After the intros, 12-18 drills on the
    // new words only: every new word comes back at least 3 more times, each time in a different format, recognition first
    // (picker, listen-and-pick), then short production (tiles, flip, translate), then sentence level (say it, tiles, cloze).
    const ws = fresh.length ? fresh : u.words.filter(w => !S.parked[w.id]);
    q.push(...wordDrills(ws, Math.min(18, Math.max(12, 3 * ws.length)), true));
    return q;
  }
  const WD_ROUNDS = [['pickListen', 'pickEn', 'pick'], ['build', 'flip', 'es2en', 'buildEn'], ['speak', 'build', 'cloze', 'en2es', 'listen']];
  const shortSent = id => (IDX.sentByWord[id] || []).some(x => x.es.split(' ').length <= 10);
  const hasSent = id => (IDX.sentByWord[id] || []).length > 0;
  function fmtOk(f, id) { return (f === 'build' || f === 'buildEn') ? shortSent(id) : (f === 'cloze' || f === 'listenS' || f === 'speak') ? hasSent(id) : true; }
  // n drills over the words ws in rounds (each word once per round, different format each time, never the same word twice in a row)
  function wordDrills(ws, n, rounds) {
    const out = [], used = {};
    for (let r = 0; out.length < n && ws.length; r++) {
      let order = shuffle(ws.slice());
      for (let t = 0; t < 10 && out.length && order.length > 1 && order[0].id === out[out.length - 1].id.slice(2); t++) order = shuffle(order);
      const R = rounds ? WD_ROUNDS[Math.min(r, WD_ROUNDS.length - 1)] : WP_FMTS, off = Math.floor(Math.random() * R.length);
      for (const [j, w] of order.entries()) {
        if (out.length >= n) break;
        // formats rotate across the words of a round, so every format of the round shows up
        const fmts = R.slice((off + j) % R.length).concat(R.slice(0, (off + j) % R.length)).concat(rounds ? shuffle(WD_ROUNDS.flat()) : []);
        const f = fmts.find(x => fmtOk(x, w.id) && !(used[w.id] || []).includes(x)) || fmts.find(x => fmtOk(x, w.id)) || 'en2es';
        (used[w.id] = used[w.id] || []).push(f);
        out.push({ id: wid(w.id), ex: f, words: true });
      }
    }
    return out;
  }
  // v9.7 Word practice stone: 14 drills, ~65% this unit's words and ~35% earlier words (due today and weak ones first),
  // mostly sentence level. No grammar-focus drills.
  const WP_FMTS = ['build', 'cloze', 'listenS', 'speak', 'en2es', 'buildEn', 'listen', 'flip'];
  const WP_N = 14;
  function wordPracticeQueue(u, n) {
    n = n || WP_N; const now = Date.now(), eod = endOfToday();
    const cur = u.words.filter(w => !S.parked[w.id]);
    const old = [];
    unitsUpTo(u.id).slice(0, -1).forEach(x => x.words.forEach(w => { if (!S.parked[w.id] && S.items[wid(w.id)]) old.push(w); }));
    const score = w => { const c = S.items[wid(w.id)]; return (c.due <= eod ? 0 : 2) + ((c.lapses || 0) > 0 || c.s < 7 ? 0 : 1) + SRS.currentR(c, now) * 0.5 + Math.random() * 0.4; };
    old.sort((a, b) => score(a) - score(b));
    const nOld = Math.min(old.length, n - Math.round(n * 0.65));
    const a = wordDrills(cur, n - nOld, false), b = wordDrills(old.slice(0, nOld), nOld, false);
    // spread the earlier words evenly through the run
    const q = a.slice(), step = (q.length + 1) / (b.length + 1);
    b.forEach((e, k) => q.splice(Math.round(step * (k + 1)) + k, 0, e));
    return q;
  }
  // ---------- v9.6 grammar focus: one pattern per practice / review session, about 8 drills on it ----------
  const FOCUS_N = 8;
  // how shaky a pattern is: FSRS lapse rate, or the miss rate once it has a few answers (whichever is higher)
  function patWeak(pk) {
    const c = S.items[pid(pk)], st = S.pstats[pk];
    const lr = c ? (c.lapses || 0) / Math.max(1, c.reps || 0) : 0, mr = st && st.seen >= 3 ? 1 - st.correct / st.seen : 0;
    return Math.max(lr, mr);
  }
  // order: this unit's patterns first, then due today, then weakest; never the same as last session unless clearly weakest
  function chooseFocus(cands, first) {
    const eod = endOfToday(), last = (S.focusLog || [])[0];
    const due = pk => { const c = S.items[pid(pk)]; return c && c.due <= eod ? 0 : 1; };
    const unseen = pk => S.items[pid(pk)] ? 1 : 0; // v9.7: a pattern not introduced yet goes first (within its tier)
    const ranked = [...new Set(cands)].filter(pk => IDX.patterns[pk]).map(pk => ({ pk, t: first.includes(pk) ? 0 : 1, n: unseen(pk), d: due(pk), w: patWeak(pk), r: Math.random() }))
      .sort((a, b) => a.t - b.t || a.n - b.n || a.d - b.d || b.w - a.w || a.r - b.r);
    if (!ranked.length) return null;
    let top = ranked[0];
    if (top.pk === last && ranked.length > 1) {
      const other = Math.max(...ranked.slice(1).map(x => x.w));
      if (!(top.w >= 0.34 && top.w - other >= 0.2)) top = ranked[1]; // rotate
    }
    return top.pk;
  }
  // 2 easy one-contrast drills first (they count toward the 8), then mixed formats. Items are spread out; a pattern with
  // fewer items than drills reuses an item in a different format rather than pulling in another pattern.
  function focusDrills(pk, n) {
    n = n || FOCUS_N;
    const items = IDX.patterns[pk].items, id = pid(pk), out = [];
    const easy = shuffle(items.map((it, i) => it.easy ? i : -1).filter(i => i >= 0));
    const lead = easy.slice(0, 2); for (const i of shuffle(items.map((_, i) => i))) if (lead.length < 2 && !lead.includes(i)) lead.push(i);
    lead.forEach(i => out.push({ id, itemIdx: i, ex: 'paced', practice: true, focus: true }));
    const order = shuffle(items.map((_, i) => i).filter(i => !lead.includes(i)));
    const fmts = shuffle(['mc', 'ptiles', 'ptype', 'pspeak', 'mc', 'ptiles']);
    const used = {}; lead.forEach(i => { used[i] = ['paced']; });
    for (let k = 0; out.length < n; k++) {
      const i = order.length ? order[k % order.length] : lead[k % lead.length];
      const it = items[i], tOk = !!patternTarget(it);
      let opts = [fmts[k % fmts.length]].concat(['mc', 'ptype', 'ptiles', 'pspeak']).filter(f => tOk || (f !== 'ptiles' && f !== 'pspeak'));
      const f = opts.find(x => !(used[i] || []).includes(x)) || opts[0];
      (used[i] = used[i] || []).push(f);
      out.push({ id, itemIdx: i, ex: f, focus: true });
    }
    return out;
  }
  // grammar block first (4 in a row so the rule sinks in), then grammar and vocab alternate
  function weave(g, v) {
    const q = g.slice(0, 4), rg = g.slice(4), rv = v.slice();
    while (rg.length || rv.length) { if (rv.length) q.push(rv.shift()); if (rg.length) q.push(rg.shift()); }
    return q;
  }
  function practiceQueue(u, n) {
    n = n || 14; const now = Date.now();
    const units = unitsUpTo(u.id);
    const pool = [], pats = [];
    // v9.7: grammar is introduced here now (not in New words), so every pattern of the units reached is a candidate
    units.forEach(x => { x.words.forEach(w => { if (!S.parked[w.id] && S.items[wid(w.id)]) pool.push(wid(w.id)); }); x.focus.forEach(p => pats.push(p)); });
    const eod = endOfToday();
    const score = id => { const c = S.items[id]; const due = c.due <= eod ? 0 : 1; const weak = (c.lapses || 0) > 0 || c.s < 7 ? 0 : 1; return due * 2 + weak + SRS.currentR(c, now) * 0.5 + Math.random() * 0.4; };
    const ranked0 = pool.sort((a, b) => score(a) - score(b));
    // v9.7: the vocab half favours this unit's words (up to 4 of the ~6), then the most due / weak from anywhere
    const mine = new Set(u.words.map(w => wid(w.id)));
    const ranked = ranked0.filter(id => mine.has(id)).slice(0, 4); ranked0.forEach(id => { if (!ranked.includes(id)) ranked.push(id); });
    // fresh sentences: words lean on cloze / sentence listening; flip cards, repeat-after-me and the picker join the mix
    const vocab = id => ({ id, ex: withTiles(id.slice(2), pick(['cloze', 'listenS', 'en2es', 'cloze', 'flip', 'speak', 'cloze', 'pickEn'])) });
    const fk = chooseFocus(pats, u.focus);
    if (!fk) return shuffle(ranked.slice(0, n)).map(vocab);
    const g = focusDrills(fk, Math.min(FOCUS_N, n));
    return weave(g, shuffle(ranked.slice(0, Math.max(0, n - g.length))).map(vocab));
  }
  function testQueue(u) {
    const units = unitsUpTo(u.id).reverse(); // most recent first
    const vocab = [];
    for (const x of units) for (const w of shuffle(x.words)) { if (vocab.length >= 12) break; if (!S.parked[w.id]) vocab.push(w.id); }
    // early in a section there may be fewer than 12 words: reuse them in a different exercise direction
    const uniq = vocab.slice(); for (let k = 0; vocab.length < 12 && uniq.length; k++) vocab.push(uniq[k % uniq.length]);
    const types = ['flip', 'cloze', 'pick', 'listen', 'en2es', 'speak'];
    const seenType = {};
    const q = vocab.map((w, k) => { let t = types[k % types.length]; if (seenType[w] === t) t = types[(k + 1) % types.length]; seenType[w] = t; return { id: wid(w), ex: t }; });
    const sentPool = [];
    for (const x of units) for (const s of shuffle(x.sentences)) if (!S.parked[s.k] && s.es.split(' ').length <= 10) sentPool.push(s);
    const sents = []; for (const s of sentPool) { if (sents.length >= 3) break; if (!sents.some(t => t.k === s.k)) sents.push(s); }
    sents.forEach(s => q.push({ id: wid(s.k), ex: 'build', sent: s }));
    let v = shuffle(q.slice(0, vocab.length));
    for (let tries = 0; tries < 20 && v.some((e, k) => k && v[k - 1].id === e.id); tries++) v = shuffle(v);
    return v.concat(q.slice(vocab.length));
  }
  function openStone(uid, i) {
    persist();
    const u = C.units[IDX.unitIdx[uid]];
    if (useRecorded()) Rec.prefetch(unitAudio(u)).catch(() => {}); // v9: this unit's recordings, cached for offline
    if (i === 1) return startStory(u);
    const meta = { uid, stone: i };
    if (i === 0) return startRun(introQueue(u), 'intro', meta);
    if (i === 'w') return startRun(wordPracticeQueue(u), 'words', meta);
    if (i === 2) return startRun(practiceQueue(u), 'practice', meta);
    return startRun(testQueue(u), 'test', meta);
  }
  function finishTest() {
    const { uid, score, total, misses } = run; const pct = total ? score / total : 0; const passed = pct >= PASS;
    const t = S.path.tests[uid] = S.path.tests[uid] || { best: 0, attempts: 0 };
    t.attempts++; t.best = Math.max(t.best, score); t.total = total; t.last = Date.now();
    if (passed) setStone(uid, 3, true);
    save(); run = null;
    const u = C.units[IDX.unitIdx[uid]];
    app.innerHTML = `<main class="card"><div class="label">Unit test · ${esc(u.title)}</div>
      <h1>${score} / ${total}</h1><p>${passed ? 'Passed — the next unit is open.' : `You need ${Math.ceil(PASS * total)} to pass. Your misses are already scheduled for review.`}</p>
      ${misses.length ? `<h3>Missed</h3><ul class="list">${misses.map(m => `<li>${tokenize(m)}</li>`).join('')}</ul>` : ''}</main>
      <footer>${passed ? '' : '<button class="btn secondary" id="retry">Retry test</button>'}<button class="btn primary" id="home">Back to path</button></footer>`;
    if (passed) FX.complete(); else FX.miss([]);
    document.getElementById('home').onclick = () => renderHome(passed ? { justDone: { uid, stone: 3 } } : {});
    const r = document.getElementById('retry'); if (r) r.onclick = () => openStone(uid, 3);
  }

  // ---------- story stone ----------
  let story = null;
  function startStory(u) { sessionStart(); story = { u, shown: 1, answered: {}, showEn: false, tile: pickStoryTile(u.story) }; story.say = pickStorySay(u.story, story.tile); renderStory(true); }
  function pickStorySay(st, tile) { // v8: one "say this line" moment per story, on a short line in the first half (only when speaking is possible)
    if (!speakOk()) return null;
    const ok = st.lines.map((l, k) => ({ l, k })).filter(({ l, k }) => k >= 1 && k < Math.max(2, Math.floor(st.lines.length / 2)) && (!tile || tile.after !== k) && tileTokens(l.es).length >= 3 && tileTokens(l.es).length <= 9);
    const c = ok.length ? pick(ok) : null; return c ? { after: c.k, done: false } : null;
  }
  function mountStorySay() {
    const st = story.u.story, line = st.lines[story.say.after];
    const box = document.getElementById('ssay');
    box.innerHTML = `<div class="label">Your turn · say the line</div><div class="muted small">${esc(line.en)}</div><div class="mic-wrap"><button class="mic" id="mic" type="button" aria-label="Tap and say the line"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-2.1A7 7 0 0 0 19 12z" fill="currentColor"/></svg><span class="mic-label">Tap to speak</span></button><div class="heard muted" id="heard" aria-live="polite"></div></div>
      <button class="cant-listen" id="cantSpeak" type="button">🤐 No puedo hablar ahora <span class="muted">· Can’t speak now</span></button><div id="fb"></div>`;
    setTimeout(() => box.scrollIntoView({ block: 'end', behavior: S.settings.anim === false ? 'auto' : 'smooth' }), 60);
    const foot = app.querySelector('footer'); foot.innerHTML = '<button class="btn secondary" id="skip">Skip</button>';
    const finish = () => { story.say.done = true; storyNext(); };
    const show = r => {
      story.say.checked = true; lastStep = performance.now(); const ok = r && r.result !== 'wrong';
      document.getElementById('fb').innerHTML = `<div class="feedback ${ok ? 'good' : 'miss'}">${ok ? (r.result === 'close' ? '<div class="ok warn">✓ Close</div>' : '<div class="ok">✓ Correct</div>') : `<div class="bad">✗ The line: <b>${esc(line.es)}</b></div>`}${r && r.heard ? `<div class="muted small">Heard: “${esc(r.heard)}”</div>` : ''}</div>`;
      const m = document.getElementById('mic'); if (ok) FX.correct([m]); else FX.miss([m]); m.disabled = true;
      foot.innerHTML = '<button class="btn primary" id="next">Continue</button>'; document.getElementById('next').onclick = step(finish);
    };
    mountMic(line.es, { locked: () => !!story.say.checked, done: show, retry: () => { story.say.tries = (story.say.tries || 0) + 1; return story.say.tries < 2; },
      blocked: () => { blockSpeech(); story.say.done = true; renderStory(false); } }); // silently skip
    document.getElementById('cantSpeak').onclick = e => { stopRec(); S.speakPauseUntil = Listen.start(Date.now()); save(); FX.pause(e.currentTarget); story.say.done = true; setTimeout(() => { renderStory(false); toast('Speaking off for 10 minutes'); }, 180); };
    document.getElementById('skip').onclick = step(() => { if (story.say.checked) return; stopRec(); finish(); });
  }
  function pickStoryTile(st) { // one "rebuild this line" tile drill per story, on a short line in the second half
    const ok = st.lines.map((l, k) => ({ l, k })).filter(({ l, k }) => k >= Math.floor(st.lines.length / 2) && k < st.lines.length - 1 && tileTokens(l.es).length >= 4 && tileTokens(l.es).length <= 10);
    const c = ok.length ? pick(ok) : null; return c ? { after: c.k, done: false } : null;
  }
  function mountStoryTile() {
    const st = story.u.story, line = st.lines[story.tile.after];
    const ex = story.tile.ex = story.tile.ex || tileExercise(line.es, 'es', st.lines.filter(l => l !== line).map(l => l.es), { label: 'Rebuild the line in Spanish', big: line.en });
    const vm = vmicHtml();
    const box = document.getElementById('stile'); box.innerHTML = `<div class="label">${esc(ex.label)}</div><div class="prompt en-prompt">${esc(ex.big)}</div>${tilesHtml(ex)}${vm ? '<div class="vheard muted small" id="vheard" aria-live="polite"></div>' : ''}<div id="fb"></div>`;
    const read = mountTiles(ex, () => story.tile.checked);
    setTimeout(() => box.scrollIntoView({ block: 'end', behavior: S.settings.anim === false ? 'auto' : 'smooth' }), 60); // bring the word bank into view
    const foot = app.querySelector('footer'); foot.innerHTML = `<button class="btn secondary" id="skip">Skip</button>${vm}<button class="btn primary" id="check">Check</button>`;
    foot.classList.toggle('has-vmic', !!vm); voiceTiles(ex, read, () => story.tile.checked);
    const finish = () => { story.tile.done = true; storyNext(); };
    const grade = (r) => {
      story.tile.checked = true; lastStep = performance.now();
      const ok = r && r.ok; story.tile.retry = !ok; // v9.5: a missed rebuild comes back at the end
      document.getElementById('fb').innerHTML = `<div class="feedback ${ok ? 'good' : 'miss'}">${ok ? `<div class="ok">✓ Correct</div>${orderNote({ res: r.full })}` : `<div class="bad">✗ Correct answer: <b>${esc(line.es)}</b></div>`}</div>`;
      if (ok) FX.correct([document.getElementById('line')]); else FX.miss([document.getElementById('line')]);
      if (ok) autoSpeak(line.es, storyVoice(line.s));
      document.getElementById('fb').scrollIntoView({ block: 'nearest' });
      foot.innerHTML = '<button class="btn primary" id="next">Continue</button>'; document.getElementById('next').onclick = step(finish);
    };
    document.getElementById('check').onclick = step(() => { if (story.tile.checked) return; stopRec(); const r = read(); if (r) grade(r); });
    document.getElementById('skip').onclick = step(() => { if (!story.tile.checked) { stopRec(); grade(null); } });
  }
  function renderStory(speakLast) {
    document.querySelectorAll(".tile-ghost").forEach(n => n.remove());
    const { u } = story, st = u.story, lines = st.lines.slice(0, story.shown);
    // v9.5: a missed question comes back after the last line (fresh shuffle) until it's answered right; no extra questions
    const atEnd = story.shown >= st.lines.length, missQ = story.missQ || [];
    const firstQ = st.qs.find(q => q.after === story.shown - 1 && story.answered[st.qs.indexOf(q)] == null); // == null: not tried yet
    const retryQi = !firstQ && atEnd && missQ.length ? missQ[0] : null;
    const pendingQ = firstQ || (retryQi != null ? st.qs[retryQi] : null);
    const tileDue = !pendingQ && story.tile && !story.tile.done && (story.tile.after === story.shown - 1 || (story.tile.again && atEnd));
    const sayDue = !pendingQ && !tileDue && story.say && !story.say.done && story.say.after === story.shown - 1 && speakOk();
    const done = story.shown >= st.lines.length && !pendingQ && !tileDue && !sayDue && !(story.tile && story.tile.retry);
    const frac = (story.shown + Object.values(story.answered).filter(Boolean).length + (story.tile && story.tile.done && !story.tile.retry ? 1 : 0)) / (st.lines.length + st.qs.length + (story.tile ? 1 : 0));
    app.innerHTML = `<div class="topbar"><button class="icon" id="quit" aria-label="Close">✕</button><div class="bar"><span style="width:${story.bar || 0}%"></span></div>${lpHtml()}<button class="icon small-btn" id="en" aria-pressed="${story.showEn}">EN</button></div>
      <main class="card story ${story.entered ? 'no-enter' : ''}"><div class="label">Story · ${esc(u.title)}</div><h1>${esc(st.title)}</h1>
      ${lines.map((l, k) => `<div class="sline ${k === lines.length - 1 ? 'fresh' : ''} ${tileDue && k === story.tile.after ? 'veil' : ''}" data-k="${k}">${l.s ? `<div class="speaker">${esc(l.s)}</div>` : ''}<div class="ses" data-en="${esc(l.en)}"><button class="icon speak" data-say="${esc(l.es)}" data-spk="${esc(l.s || '')}">🔊</button> <span>${tokenize(l.es)}</span></div><div class="sen muted ${story.showEn ? '' : 'hidden'}">${esc(l.en)}</div></div>`).join('')}
      ${pendingQ ? `<div class="squestion${retryQi != null ? ' sq-retry' : ''}">${retryQi != null ? '<div class="label">Try this one again</div>' : ''}<div class="prompt">${esc(pendingQ.q)}</div><div class="options">${shuffle(pendingQ.o).map(o => `<button class="opt" data-o="${esc(o)}">${esc(o)}</button>`).join('')}</div><div id="fb"></div></div>` : ''}
      ${tileDue ? '<div class="squestion stile" id="stile"></div>' : ''}
      ${sayDue ? '<div class="squestion ssay" id="ssay"></div>' : ''}
      </main><footer>${pendingQ || tileDue || sayDue ? '' : `<button class="btn primary" id="next">${done ? 'Finish story' : 'Continue'}</button>`}</footer>`;
    story.entered = true; bindQuit(); bindSpeak();
    const bar = app.querySelector('.bar span'); void bar.offsetWidth; story.bar = 100 * frac; bar.style.width = story.bar + '%';
    document.getElementById('en').onclick = () => { story.showEn = !story.showEn; renderStory(false); };
    app.querySelectorAll('.sline .ses span').forEach(sp => sp.onclick = e => { if (!e.target.closest('[data-w]') || !lp.fired) { const l = st.lines[+sp.closest('.sline').dataset.k]; speak(l.es, false, storyVoice(l.s)); } });
    const last = app.querySelector('.sline.fresh'); if (last) last.scrollIntoView({ block: 'nearest', behavior: S.settings.anim === false ? 'auto' : 'smooth' });
    if (speakLast && lines.length) autoSpeak(lines[lines.length - 1].es, storyVoice(lines[lines.length - 1].s));
    if (pendingQ) {
      const qi = st.qs.indexOf(pendingQ);
      const isRetry = retryQi != null; let taken = false;
      app.querySelectorAll('.squestion .opt').forEach(b => b.onclick = () => {
        if (taken || (!isRetry && story.answered[qi] != null)) return; taken = true;
        const ok = b.dataset.o === pendingQ.o[0]; story.answered[qi] = ok;
        story.missQ = (story.missQ || []).filter(x => x !== qi); if (!ok) story.missQ.push(qi); // to the back of the line
        app.querySelectorAll('.squestion .opt').forEach(x => { if (x.dataset.o === pendingQ.o[0]) x.classList.add('right'); });
        if (!ok) b.classList.add('wrong');
        const target = pendingQ.p ? pid(pendingQ.p) : pendingQ.k && !S.parked[pendingQ.k] && S.items[wid(pendingQ.k)] ? wid(pendingQ.k) : null;
        if (target && !story['g' + target]) { story['g' + target] = 1; grade(target, ok ? 3 : 1); }
        if (pendingQ.p && !isRetry) pstat(pendingQ.p, ok); // stats and SRS count the first try only
        save();
        if (pendingQ.n) b.closest('.squestion').insertAdjacentHTML('beforeend', `<div class="sq-why">${whyHtml(pendingQ, pendingQ.p, ok, b.dataset.o)}</div>`); // v9.4
        if (ok) FX.correct([b]); else FX.miss([b]);
        lastStep = performance.now();
        app.querySelector('footer').innerHTML = '<button class="btn primary" id="next">Continue</button>';
        document.getElementById('next').onclick = step(storyNext);
      });
    } else if (tileDue) mountStoryTile();
    else if (sayDue) mountStorySay();
    else document.getElementById('next').onclick = step(storyNext);
  }
  function storyNext() {
    const st = story.u.story;
    const pendingQ = st.qs.find(q => q.after === story.shown - 1 && story.answered[st.qs.indexOf(q)] == null);
    if (pendingQ) return renderStory(false);
    if (story.tile && !story.tile.done && (story.tile.after === story.shown - 1 || (story.tile.again && story.shown >= st.lines.length))) return renderStory(false);
    if (story.shown >= st.lines.length && story.missQ && story.missQ.length) return renderStory(false); // v9.5 retries before finishing
    if (story.shown >= st.lines.length && story.tile && story.tile.retry) { story.tile = { after: story.tile.after, done: false, again: true }; return renderStory(false); }
    if (story.say && !story.say.done && story.say.after === story.shown - 1 && speakOk()) return renderStory(false);
    if (story.shown >= st.lines.length) { sessionDone(); const uid = story.u.id; setStone(uid, 1, true); save(); story = null; return renderHome({ justDone: { uid, stone: 1 } }); }
    story.shown++; renderStory(true);
  }

  // ---------- placement ----------
  function placementQueue() {
    const pats = Object.keys(C.patterns), n = C.placement.patternItemsEach || 2;
    const mc = [];
    for (let k = 0; k < n; k++) pats.forEach(p => mc.push({ id: pid(p), itemIdx: k }));
    const words = C.placement.words.map(w => ({ id: wid(w), ex: 'es2en' }));
    const out = []; let wi = 0;
    mc.forEach((e, k) => { out.push(e); if (k % 3 === 2 && wi < words.length) out.push(words[wi++]); });
    while (wi < words.length) out.push(words[wi++]);
    return out;
  }
  function renderPlacementIntro() {
    app.innerHTML = `<main class="card intro"><h1>Placement</h1>
      <p>${placementQueue().length} quick items, about 6 minutes. Units whose grammar and words you already handle are marked done on the path; what you miss becomes review.</p>
      <p class="muted">Accents are optional when typing — you'll be shown the correct form. Tap “I don't know” instead of guessing.</p></main>
      <footer><button class="btn primary" id="go">Start placement</button></footer>`;
    document.getElementById('go').onclick = () => { persist(); startRun(placementQueue(), 'placement'); };
  }
  function finishPlacement() {
    const now = Date.now(), byId = {};
    run.results.forEach(r => { (byId[r.id] = byId[r.id] || []).push(r.ok); });
    const summary = { strong: [], partial: [], weak: [], knownWords: [], newWords: [] };
    Object.entries(byId).forEach(([id, oks]) => {
      const right = oks.filter(Boolean).length;
      if (id.startsWith('p:')) {
        const p = id.slice(2); oks.forEach(ok => pstat(p, ok)); S.recent[p] = [0, 1];
        if (right === oks.length) { S.items[id] = SRS.markKnown(S.items[id], now, 45); summary.strong.push(p); }
        else if (right > 0) { S.items[id] = SRS.review(SRS.newCard(), 2, now); S.items[id].due = now; summary.partial.push(p); }
        else { S.items[id] = SRS.review(SRS.newCard(), 1, now); S.items[id].due = now; summary.weak.push(p); }
      } else if (right) { S.items[id] = SRS.markKnown(S.items[id], now, 60); summary.knownWords.push(id.slice(2)); }
      else summary.newWords.push(id.slice(2));
    });
    S.placementDone = true; S.placementSummary = summary; applyPlacementToPath(summary); save();
    const out = Object.keys(S.path.testedOut).map(u => C.units[IDX.unitIdx[u]].title);
    const li = arr => arr.map(p => `<li>${esc(IDX.patterns[p].name)}</li>`).join('') || '<li class="muted">—</li>';
    app.innerHTML = `<main class="card"><h1>Placement results</h1>
      <h3>Needs work (due today)</h3><ul>${li(summary.weak)}</ul>
      <h3>Shaky (due today)</h3><ul>${li(summary.partial)}</ul>
      <h3>Solid (pushed out ~6 weeks)</h3><ul>${li(summary.strong)}</ul>
      <p class="muted">Units marked done: ${out.length ? esc(out.join(', ')) : 'none — you start at Unit 1 of B1'}. Words already known: ${summary.knownWords.length} of ${C.placement.words.length} tested.</p></main>
      <footer><button class="btn primary" id="go">Go to the path</button></footer>`;
    run = null;
    document.getElementById('go').onclick = () => renderHome();
  }

  // ---------- review (spaced repetition outside the path) ----------
  function reviewQueue() { // v9.6: words that are due, plus ~8 drills on ONE due grammar pattern (the other due patterns wait their turn)
    const due = dueIds(Date.now()), pats = due.filter(id => id.startsWith('p:')).map(id => id.slice(2)), words = due.filter(id => id.startsWith('w:'));
    const cur = currentPos(), first = cur ? C.units[IDX.unitIdx[cur.uid]].focus : [];
    // v9.7: grammar is now introduced in Practice, one pattern per session. With no pattern due, review teaches a pattern
    // still waiting from a unit whose Practice stone is already done (units with 2-3 patterns catch up this way).
    const waiting = pats.length || !words.length ? [] : IDX.section.units.filter(uid => stones(uid)[2]).flatMap(uid => C.units[IDX.unitIdx[uid]].focus).filter(p => IDX.patterns[p] && !S.items[pid(p)]);
    const fk = pats.length ? chooseFocus(pats, first) : waiting.length ? chooseFocus(waiting, first) : null;
    if (!fk) return words.slice(0, 60).map(id => ({ id }));
    return weave(focusDrills(fk), words.slice(0, 60 - FOCUS_N).map(id => ({ id })));
  }
  function startReview() { persist(); const q = reviewQueue(); if (!q.length) return renderHome(); startRun(q, 'review'); }
  function finishReview() {
    S.sessions = (S.sessions || 0) + 1; S.lastSession = Date.now(); save();
    setTimeout(() => FX.complete(), 0);
    const tomorrow = endOfToday() + DAY;
    const dueTomorrow = Object.keys(S.items).filter(id => validId(id) && S.items[id].due <= tomorrow).length;
    run = null;
    app.innerHTML = `<main class="card"><h1>Done for now</h1><p>Due by end of tomorrow: <b>${dueTomorrow}</b>.</p></main>
      <footer><button class="btn secondary" id="prog">Progress</button><button class="btn primary" id="home">Path</button></footer>`;
    document.getElementById('home').onclick = () => renderHome();
    document.getElementById('prog').onclick = renderProgress;
  }

  // ---------- path (home) ----------
  function stats() {
    const now = Date.now(), ids = Object.keys(S.items).filter(validId);
    const words = ids.filter(i => i.startsWith('w:'));
    const mastered = ids.filter(i => S.items[i].s >= 21).length;
    const due = dueIds(now).length;
    const weak = Object.keys(C.patterns).map(p => {
      const c = S.items[pid(p)], st = S.pstats[p] || { seen: 0, correct: 0 };
      return { p, acc: st.seen ? st.correct / st.seen : null, s: c ? c.s : 0, introduced: !!c };
    }).filter(x => x.introduced && (x.s < 21 || (x.acc != null && x.acc < 0.8))).sort((a, b) => (a.acc ?? 1) - (b.acc ?? 1) || a.s - b.s);
    return { words: words.length, mastered, due, weak };
  }
  function renderHome(opts) {
    opts = opts || {};
    if (pendingReload) return reloadForUpdate();
    if (!S.placementDone) return renderPlacementIntro();
    checkC2();
    const st = stats(), sec = IDX.section, cur = currentPos();
    const doneUnits = sec.units.filter(unitDone).length;
    const offs = [0, 1, 0, -1, 0];
    const sectionHtml = s => {
      if (s.placeholder === 'before') return `<div class="section-card skipped"><span class="cefr">${esc(s.cefr)}</span><div><b>${esc(s.title)}</b><div class="muted small">Skipped — below your level</div></div></div>`;
      if (s.placeholder === 'after') return `<div class="section-card locked"><span class="cefr">${esc(s.cefr)}</span><div><b>${esc(s.title)}</b><div class="muted small">Not written yet</div></div></div>`;
      return `<div class="section-card current"><span class="cefr">${esc(s.cefr)}</span><div><b>${esc(s.title)}</b><div class="muted small">${esc(s.desc || '')}</div><div class="muted small">${doneUnits}/${s.units.length} units done</div></div></div>
        ${s.units.map((uid, n) => {
          const u = C.units[IDX.unitIdx[uid]];
          return `<div class="unit ${unitDone(uid) ? 'udone' : ''}${u.ta ? ' ta' : ''}" id="unit-${uid}"><div class="unit-head"><div class="label">Unit ${n + 1}${u.ta ? ' · <span class="badge ta">Tres Aguas</span>' : ''}${S.path.testedOut[uid] ? ' · tested out' : ''}</div><div class="utitle">${esc(u.title)}</div><div class="muted small">${esc(u.titleEn)} · ${u.focus.map(p => esc(C.patterns[p].name.replace(/\s*\(.*\)\s*$/, ''))).join(' · ')}</div></div>
            <div class="stones">${STONES.map((stn, i) => { const state = stoneState(uid, stn.s); const jd = opts.justDone && opts.justDone.uid === uid && opts.justDone.stone === stn.s;
              return `<div class="stone-wrap" style="--off:${offs[i]}"><button class="stone ${state}${jd ? ' just-done' : ''}" data-u="${uid}" data-s="${stn.s}" aria-label="${esc(stn.label)}">${state === 'done' ? '✓' : state === 'locked' ? '🔒' : stn.icon}</button><span class="stone-label">${esc(stn.label)}${stn.s === 3 && S.path.tests[uid] ? ` · ${S.path.tests[uid].best}/${S.path.tests[uid].total || 15}` : ''}</span></div>`; }).join('')}</div></div>`;
        }).join('')}`;
    };
    app.innerHTML = `<div class="home-head"><div class="topbar home-top"><div class="title">Español <span class="muted small">${APP_VERSION}</span></div><span class="row-inline">${lpHtml()}<button class="btn secondary slim" id="prog">Progress</button></span></div>${dayBarHtml()}</div>
      <main class="card path">
      <button class="btn ${st.due ? 'primary' : 'secondary'} review-btn" id="review" ${st.due ? '' : 'disabled'}>${st.due ? `Review · ${st.due} due` : 'No reviews due'}</button>
      ${st.weak.length ? `<p class="muted small center">Weak: ${st.weak.slice(0, 3).map(w => esc(C.patterns[w.p].name.replace(/\s*\(.*\)\s*$/, ''))).join(' · ')}</p>` : ''}
      ${C.sections.map(sectionHtml).join('')}
      ${!cur ? '<p class="center muted">Section complete. More sections are coming.</p>' : ''}
      <p class="muted small version">${APP_VERSION}</p></main><div id="toast" class="toast"></div>`;
    document.getElementById('prog').onclick = renderProgress; bindLp();
    document.getElementById('review').onclick = startReview;
    app.querySelectorAll('.stone').forEach(b => b.onclick = () => {
      const uid = b.dataset.u, i = b.dataset.s === 'w' ? 'w' : +b.dataset.s, state = stoneState(uid, i);
      if (state === 'locked') return toast('Finish the stone before this one first.');
      openStone(uid, i);
    });
    const focus = opts.justDone ? app.querySelector('.stone.just-done') : app.querySelector('.stone.current');
    if (focus) focus.scrollIntoView({ block: 'center' });
    if (opts.justDone) { const el = app.querySelector('.stone.just-done'); FX.stone(el); }
    T.shownDay = todayKey(); celebrateGoal();
  }
  function agoText(t) { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; }
  function toast(msg) { let t = document.getElementById('toast'); if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t); } t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 1800); }

  // ---------- progress ----------
  function fmtDue(c) { const d = Math.round((c.due - Date.now()) / DAY); return d <= 0 ? 'due' : d === 1 ? '1 day' : d < 60 ? d + ' days' : Math.round(d / 30) + ' mo'; }
  function renderProgress() {
    const st = stats();
    const units = IDX.section.units.map(uid => {
      const u = C.units[IDX.unitIdx[uid]]; const n = STONES.filter(t => stoneDone(uid, t.s)).length;
      return `<li class="col"><div class="rowline"><span>${esc(u.title)} <span class="muted">· ${esc(u.titleEn)}</span></span><span>${n}/${STONES.length}</span></div><div class="small">${u.words.map(w => `<span class="chip ${S.parked[w.id] ? 'parked' : S.items[wid(w.id)] ? 'learned' : ''}" data-w="${w.id}">${esc(w.es)}</span>`).join(' ')}</div></li>`;
    }).join('');
    const patterns = Object.keys(C.patterns).map(p => {
      const c = S.items[pid(p)], ps = S.pstats[p];
      return `<li><span>${esc(C.patterns[p].name)}</span><span class="muted">${c ? (ps && ps.seen ? Math.round(100 * ps.correct / ps.seen) + '% · ' : '') + fmtDue(c) : 'not started'}</span></li>`;
    }).join('');
    const weak = st.weak.map(w => `<li><span>${esc(C.patterns[w.p].name)}</span><span class="muted">${w.acc != null ? Math.round(w.acc * 100) + '%' : ''}</span></li>`).join('') || '<li class="muted">None right now</li>';
    const parked = Object.keys(S.parked).filter(w => IDX.words[w] || (w.startsWith('g:') && !S.parked[w].applied)).map(w => { const i = wordInfo(w); return `<li><span>${IDX.words[w] ? wordSpan(w, i.es) : `<span class="w" data-lp="${esc(i.es)}">${esc(i.es)}</span>`} <span class="muted">· ${esc(i.en)}</span></span><button class="btn secondary slim unpark" data-id="${esc(w)}">Unpark</button></li>`; }).join('') || '<li class="muted">None. Press and hold any word to park it.</li>';
    const rh = (S.hidden || []).filter(stillHidden).slice(0, 8); // v9.5 Recently hidden, newest first
    const recent = rh.map((h, k) => `<li><span>${h.id.startsWith('p:') ? esc(hiddenLabel(h.id)) : IDX.words[h.id.replace(/^w:/, '')] ? wordSpan(h.id.replace(/^w:/, ''), hiddenLabel(h.id)) : `<span class="w" data-lp="${esc(hiddenLabel(h.id))}">${esc(hiddenLabel(h.id))}</span>`} <span class="muted small">· ${h.kind === 'park' ? 'not a priority' : 'hidden for months'} · ${agoText(h.at)}</span></span><button class="btn secondary slim unhide" data-k="${k}">Unhide</button></li>`);
    app.innerHTML = `<div class="topbar"><button class="icon" id="back" aria-label="Back">←</button><div class="title">Progress</div></div>
      <main class="card">
      <div class="today"><div><b>${st.words}</b><span>words learned</span></div><div><b>${st.mastered}</b><span>long-term</span></div><div><b>${st.due}</b><span>due today</span></div></div>
      <h3>Weak patterns</h3><ul class="list">${weak}</ul>
      <h3>Units · ${esc(IDX.section.cefr)}</h3><ul class="list">${units}</ul>
      <h3>Parked words</h3>${recent.length ? `<p class="muted small recent-head"><b>Recently hidden</b> · newest first, one tap brings it back</p><ul class="list" id="recent-hidden">${recent.join('')}</ul>` : ''}<p class="muted small">Not a priority — skipped in lessons, practice, tests and reviews until you reach C2.</p><ul class="list" id="parked">${parked}</ul>
      <h3>📘 Grammar rules</h3><p class="muted small">Tap one to read its rule card again.</p><ul class="list rules-list">${Object.keys(C.patterns).filter(p => C.patterns[p].rule).map(p => `<li><button class="linklike" type="button" data-rule="${esc(p)}">${esc(C.patterns[p].rule.title)}</button></li>`).join('')}</ul>
      <h3>Grammar patterns</h3><ul class="list">${patterns}</ul>
      <h3>Settings</h3>
      <label class="set">New words per unit intro <span class="muted small">4–5 per unit</span></label>
      <label class="set">Speech speed <input id="rate" type="range" min="0.6" max="1.2" step="0.05" value="${S.settings.rate}"></label>
      <label class="set">Sound effects <input id="snd" type="checkbox" ${S.settings.sound !== false ? 'checked' : ''}></label>
      <label class="set">Animations <input id="anim" type="checkbox" ${S.settings.anim !== false ? 'checked' : ''}></label>
      <label class="set">Auto-continue on correct <input id="auto" type="checkbox" ${S.settings.autoAdvance ? 'checked' : ''}></label>
      <div class="set">Edit streak <span class="row-inline"><input id="streakIn" type="number" inputmode="numeric" min="0" step="1" value="${Daily.current(S.streak, todayKey()).count}"><button class="btn secondary slim" id="streakSave">Save</button></span></div>
      <p class="muted small">Use this only to correct the number. Today counts once you finish a lesson.</p>
      ${voiceSettingsHtml()}
      <h3>Backup</h3>
      <div class="row wrap"><button class="btn secondary" id="exp">Export progress</button><button class="btn secondary" id="copy">Copy to clipboard</button><label class="btn secondary">Import file<input id="imp" type="file" accept="application/json,.json" hidden></label></div>
      <textarea id="paste" placeholder="…or paste a backup here and tap Import pasted" rows="2"></textarea>
      <div class="row wrap"><button class="btn secondary" id="impPaste">Import pasted</button><button class="btn secondary" id="replace">Retake placement</button><button class="btn danger" id="reset">Reset everything</button></div>
      <p class="muted small">App ${APP_VERSION} · Content v${C.version} · ${C.units.length} units · ${IDX.wordOrder.length} words · ${Object.keys(C.patterns).length} patterns</p>
      </main><div id="toast" class="toast"></div>`;
    bindSpeak(); bindVoiceSettings();
    document.getElementById('back').onclick = () => renderHome();
    app.querySelectorAll('.unpark').forEach(b => b.onclick = () => { unpark(b.dataset.id); renderProgress(); });
    app.querySelectorAll('.unhide').forEach(b => b.onclick = () => { const h = rh[+b.dataset.k]; if (h) { undoHide(h); renderProgress(); toast(`${hiddenLabel(h.id)} is back in rotation`); } });
    document.getElementById('rate').onchange = e => { S.settings.rate = +e.target.value; save(); speak(RATE_TEST); };
    document.getElementById('snd').onchange = e => { S.settings.sound = e.target.checked; save(); if (e.target.checked) FX.sounds.correct(); };
    document.getElementById('anim').onchange = e => { S.settings.anim = e.target.checked; save(); FX.applyClasses(); };
    document.getElementById('auto').onchange = e => { S.settings.autoAdvance = e.target.checked; save(); };
    document.getElementById('streakSave').onclick = () => {
      const n = parseInt(document.getElementById('streakIn').value, 10); if (!(n >= 0)) return toast('Enter a whole number');
      const k = todayKey(); S.streak = Daily.edit(S.streak, n, k, !!(S.daily[k] && S.daily[k].sessions)); save(); toast(`Streak set to ${n.toLocaleString('en-US')}`);
    };
    const json = () => JSON.stringify(Object.assign({ exportedAt: new Date().toISOString(), app: 'spanish-app', appVersion: APP_VERSION }, S), null, 1);
    document.getElementById('exp').onclick = () => {
      const blob = new Blob([json()], { type: 'application/json' }); const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'spanish-progress-' + new Date().toISOString().slice(0, 10) + '.json'; document.body.appendChild(a); a.click(); a.remove();
    };
    document.getElementById('copy').onclick = async () => { try { await navigator.clipboard.writeText(json()); alert('Backup copied. Paste it into Notes or email it to yourself.'); } catch (e) { document.getElementById('paste').value = json(); alert('Copy blocked — the backup is in the box below; select all and copy.'); } };
    document.getElementById('imp').onchange = e => { const f = e.target.files[0]; if (f) f.text().then(importBackup); };
    document.getElementById('impPaste').onclick = () => importBackup(document.getElementById('paste').value);
    document.getElementById('replace').onclick = () => { if (confirm('Retake placement? Learned words and path progress are kept; grammar patterns get re-rated.')) { S.placementDone = false; save(); renderHome(); } };
    document.getElementById('reset').onclick = () => { if (confirm('Erase all progress on this phone? Export first if you want a backup.')) { S = defaults(); save(); renderHome(); } };
  }
  // v9: Voices = Natural (recorded, default) or Device. Device pickers (v8/v8.1) choose the Web Speech voices, which also cover
  // anything not recorded. "Automatic" = best installed (Angélica if exposed, then Mónica, then Paulina); saved by voiceURI.
  const REC_NAMES = { dalia: 'Dalia', jorge: 'Jorge', paloma: 'Paloma', alonso: 'Alonso', salome: 'Salomé', gonzalo: 'Gonzalo' };
  function voiceSettingsHtml() {
    const all = 'speechSynthesis' in window ? speechSynthesis.getVoices() : [];
    const vs = Voice.spanish(all), auto = Voice.best(all), auto2 = Voice.second(all, voice, '');
    const cur = S.settings.voice || '', rec = S.settings.voiceMode !== 'device';
    const chars = Rec.man ? [...new Set(Object.values(Rec.man.cast || {}).flatMap(c => Object.entries(c).filter(([k]) => k).map(([, v]) => v)))].map(v => REC_NAMES[v] || v) : [];
    return `<div class="set voice-set"><label for="voiceMode">Voices</label><span class="row-inline"><select id="voiceMode">
      <option value="recorded" ${rec ? 'selected' : ''}>Natural voices (recorded)</option><option value="device" ${rec ? '' : 'selected'}>Device voices</option>
      </select><button class="btn secondary slim" id="recTest" type="button">Test</button></span></div>
      <p class="muted small" id="recInfo">${rec ? (Rec.man ? `Dalia (Mexico) reads words, drills and story narration; story characters: ${esc(chars.join(', '))}. Anything not recorded uses the device voice below. <span id="recCached"></span>` : 'Recorded audio hasn’t loaded yet (open once online); using device voices for now.') : 'Using your iPhone’s voices for everything.'}</p>
      <div class="set voice-set"><label for="voiceSel">${rec ? 'Device voice' : 'Voice'}</label><span class="row-inline"><select id="voiceSel" data-n="${vs.length}">
      <option value="" ${cur ? '' : 'selected'}>Automatic${auto ? ' · ' + esc(auto.name) : ''}</option>
      ${vs.map(v => `<option data-v="1" value="${esc(Voice.key(v))}" ${cur === Voice.key(v) ? 'selected' : ''}>${esc(v.name)} (${esc(v.lang)})${Voice.quality(v) ? ' ★' : ''}</option>`).join('')}
      </select><button class="btn secondary slim" id="voiceTest" type="button">Test</button></span></div>
      <div class="set voice-set"><label for="voice2Sel">Second voice <span class="muted small">stories</span></label><span class="row-inline"><select id="voice2Sel">
      <option value="" ${S.settings.voice2 ? '' : 'selected'}>Automatic${auto2 ? ' · ' + esc(auto2.name) : ''}</option>
      ${vs.filter(v => !voice || Voice.key(v) !== Voice.key(voice)).map(v => `<option value="${esc(Voice.key(v))}" ${S.settings.voice2 === Voice.key(v) ? 'selected' : ''}>${esc(v.name)} (${esc(v.lang)})${Voice.quality(v) ? ' ★' : ''}</option>`).join('')}
      </select><button class="btn secondary slim" id="voice2Test" type="button">Test</button></span></div>
      <p class="muted small">Device voice now: <b id="voiceNow">${voice ? esc(voice.name + ' (' + voice.lang + ')') : 'default Spanish'}</b>${vs.length ? '' : ' · no Spanish voices listed yet'}. ${voice2 ? ` Second story voice: <b id="voice2Now">${esc(voice2.name)}</b>.` : vs.length ? ' Only one Spanish voice, so story characters differ by pitch.' : ''} On iPhone, add voices in Settings › Accessibility › Spoken Content › Voices › Spanish.</p>`;
  }
  function bindVoiceSettings() {
    const sel = document.getElementById('voiceSel'); if (!sel) return;
    const mode = document.getElementById('voiceMode');
    if (mode) mode.onchange = () => { S.settings.voiceMode = mode.value === 'device' ? 'device' : 'recorded'; save(); if (useRecorded()) Rec.prefetch(offlineAudio()).catch(() => {}); renderProgress(); speak(VOICE_TEST); };
    let recT = 0; document.getElementById('recTest').onclick = () => (recT++ % 2 && Rec.man) ? speak(VOICE2_TEST, false, { rec: Rec.man.second }) : speak(VOICE_TEST); // alternates Dalia / Jorge
    const cached = document.getElementById('recCached');
    if (cached && Rec.man) { const need = offlineAudio(); Rec.cachedCount().then(n => { cached.textContent = `Saved for offline: ${Math.min(n, need.length)} of ${need.length} clips for your current units.`; }).catch(() => {}); }
    sel.onchange = () => { S.settings.voice = sel.value; save(); pickVoice(); if (Voice.key(voice2) === Voice.key(voice)) { S.settings.voice2 = ''; save(); pickVoice(); } const n = document.getElementById('voiceNow'); if (n) n.textContent = voice ? voice.name + ' (' + voice.lang + ')' : 'default Spanish'; deviceSpeak(VOICE_TEST); };
    document.getElementById('voiceTest').onclick = () => deviceSpeak(VOICE_TEST);
    const s2 = document.getElementById('voice2Sel'), say2 = () => deviceSpeak(VOICE2_TEST, false, { voice: voice2 || voice, pitch: voice2 ? 1 : 1.1 });
    if (s2) { s2.onchange = () => { S.settings.voice2 = s2.value; save(); pickVoice(); const n = document.getElementById('voice2Now'); if (n && voice2) n.textContent = voice2.name; say2(); };
      document.getElementById('voice2Test').onclick = say2; }
  }
  function importBackup(txt, silent) {
    try {
      const d = JSON.parse(txt); if (!d || !d.v || !d.items) throw new Error('not a backup');
      if (!silent && !confirm('Replace current progress with this backup?')) return false;
      delete d.exportedAt; delete d.app; delete d.appVersion;
      S = normalize(d); migratePath(); applyStartParked(); save(); FX.applyClasses();
      if (!silent) { renderProgress(); alert('Imported.'); }
      return true;
    } catch (e) { if (!silent) alert('Could not import: ' + e.message); return false; }
  }
  function bindSpeak() { app.querySelectorAll('.speak').forEach(b => b.onclick = e => { e.preventDefault(); speak(b.dataset.say, false, b.dataset.spk != null ? storyVoice(b.dataset.spk) : null); }); }

  // v9.5: Undo after hiding a word (Not a priority, Too easy · hide for months, I already know this). A snackbar with a big
  // Undo button sits just above the footer buttons (never over them) for 7 s; Undo restores the word's SRS state, its parked
  // entry (g:<word> too) and any cards the hide took out of the current lesson. Progress keeps a "Recently hidden" list.
  let lastHide = null;
  const UNDO_MS = 7000;
  function hiddenLabel(id) { if (id.startsWith('p:')) { const p = C.patterns[id.slice(2)]; return p ? p.name : id.slice(2); } const k = id.startsWith('w:') ? id.slice(2) : id; return wordInfo(k).es || k; }
  function logHide(rec) { S.hidden = [rec].concat((S.hidden || []).filter(h => !(h.id === rec.id && h.kind === rec.kind))).slice(0, 30); save(); }
  function hideEasy(id, prev, removed) {
    const rec = { id, kind: 'easy', at: S.items[id].last, prev: prev ? Object.assign({}, prev) : null };
    logHide(rec); lastHide = { rec, run, removed: removed || [] };
    undoToast(`${hiddenLabel(id)} hidden for months`, () => undoHide(rec));
  }
  function hidePark(key, word, removed) {
    const rec = { id: key, kind: 'park', at: S.parked[key].at, word: word || undefined, prev: S.items[wid(key)] ? Object.assign({}, S.items[wid(key)]) : null };
    logHide(rec); lastHide = { rec, run, removed: removed || [] };
  }
  function stillHidden(h) {
    if (h.kind === 'park') return !!S.parked[h.id] && !S.parked[h.id].applied;
    const it = S.items[h.id]; return !!(it && it.known && it.last === h.at);
  }
  // restore exactly what was there before the hide; if the card was reviewed since, just make it due now
  function undoHide(rec) {
    if (rec.kind === 'park') {
      delete S.parked[rec.id];
      const iid = wid(rec.id); if (rec.prev) S.items[iid] = Object.assign({}, rec.prev);
    } else if (stillHidden(rec)) { if (rec.prev) S.items[rec.id] = Object.assign({}, rec.prev); else delete S.items[rec.id]; }
    else if (S.items[rec.id]) { S.items[rec.id].due = Date.now(); delete S.items[rec.id].known; }
    S.hidden = (S.hidden || []).filter(h => !(h.id === rec.id && h.kind === rec.kind));
    if (lastHide && lastHide.rec === rec && lastHide.run && lastHide.run === run && lastHide.removed.length) {
      run.queue.splice(run.i + 1, 0, ...lastHide.removed.map(e => Object.assign({}, e)));
    }
    if (lastHide && lastHide.rec === rec) lastHide = null;
    save();
  }
  function refreshAfterHide() {
    if (app.querySelector('#parked')) renderProgress();
    else if (!run && !story) renderHome();
    else if (story) renderStory(false);
    else if (run && run.queue[run.i] && run.queue[run.i].theme) renderTheme(run.queue[run.i]);
  }
  function undoToast(msg, onUndo) {
    closeUndo();
    const t = document.createElement('div'); t.id = 'undo-toast'; t.className = 'undo-toast'; t.setAttribute('role', 'status');
    t.innerHTML = `<span class="undo-msg"></span><button class="undo-btn" type="button">Undo</button>`;
    t.querySelector('.undo-msg').textContent = msg;
    document.body.appendChild(t); placeUndo(t);
    t.querySelector('.undo-btn').onclick = e => { e.stopPropagation(); closeUndo(); onUndo(); refreshAfterHide(); toast('Restored'); };
    requestAnimationFrame(() => t.classList.add('show'));
    t._h = setTimeout(closeUndo, UNDO_MS);
  }
  // keep the snackbar just above whatever footer is on screen (the footer re-renders between cards)
  function placeUndo(t) {
    t = t || document.getElementById('undo-toast'); if (!t) return;
    const f = app.querySelector('footer'), r = f && f.getBoundingClientRect(), vh = window.innerHeight;
    const above = r && r.height && r.top < vh ? vh - r.top : 0;
    t.style.bottom = above ? `${Math.round(above + 10)}px` : 'calc(env(safe-area-inset-bottom, 0px) + 16px)';
  }
  function closeUndo() { const t = document.getElementById('undo-toast'); if (t) { clearTimeout(t._h); t.remove(); } }
  if (typeof MutationObserver !== 'undefined') new MutationObserver(() => placeUndo()).observe(app, { childList: true, subtree: true });
  window.addEventListener('resize', () => placeUndo());
  // v9.5 "Also written: 150": the answer wrote the number another way (digits vs words) and both count
  function alsoWritten(ex, correctForm, given) {
    if (!ex.res || !ex.res.numbers) return '';
    const g = Check.stripAcc(String(given || '').toLowerCase());
    const spans = Check.numberSpans(correctForm).filter(sp => !g.includes(Check.stripAcc(sp.toLowerCase())));
    return spans.length ? `<div class="muted small spelled also-written">Also written: ${esc(spans.join(', '))}</div>` : '';
  }

  // ---------- parking ("Not a priority") via long-press ----------
  function park(w) {
    S.parked[w] = { at: Date.now() }; save();
    const removed = [];
    if (run && run.mode !== 'placement') {
      const curId = run.queue[run.i] && run.queue[run.i].id;
      run.queue.forEach((e, k) => { if (k > run.i && e.id === wid(w)) removed.push(e); });
      run.queue = run.queue.filter((e, k) => k <= run.i || e.id !== wid(w));
      if (curId === wid(w) && !run.answered) { removed.unshift(Object.assign({}, run.queue[run.i])); hidePark(w, null, removed); run.i++; nextCard(); return; }
    }
    hidePark(w, null, removed);
  }
  function unpark(w) { delete S.parked[w]; S.hidden = (S.hidden || []).filter(h => !(h.kind === 'park' && h.id === w)); save(); }
  const lp = { timer: null, fired: false, x: 0, y: 0 };
  // v9.2: a word that isn't a course word yet is parked as 'g:<word>' (same parked list; if a later unit teaches it, it starts parked)
  function wordInfo(id, word) {
    if (IDX.words[id]) return IDX.words[id];
    const k = id.slice(2), p = S.parked[id], es = (p && p.word) || word || k, g = gloss(es);
    return { id, es, en: g ? g.en : '', loose: true };
  }
  function openWordMenu(id, x, y, word) {
    closeWordMenu();
    const w = wordInfo(id, word); if (!w || !w.es) return;
    const parked = !!S.parked[id];
    const easyRec = !parked && (S.hidden || []).find(h => h.kind === 'easy' && h.id === wid(id) && stillHidden(h)); // v9.5
    const m = document.createElement('div'); m.className = 'wmenu-backdrop';
    m.innerHTML = `<div class="wmenu" role="menu"><div class="wmenu-word">${esc(w.es)}</div><div class="muted small">${esc(w.en)}</div>
      ${easyRec ? '<button class="btn primary" id="wm-unhide">Unhide (was hidden for months)</button>' : ''}
      <button class="btn ${parked || easyRec ? 'secondary' : 'primary'}" id="wm-act">${parked ? 'Unhide (bring back)' : 'Not a priority'}</button>
      ${parked ? '' : w.loose ? '<div class="muted small">Not a course word yet. If a later unit teaches it, it starts out parked.</div>' : '<div class="muted small">Skips this word in lessons, practice, tests and reviews until C2.</div>'}
      <button class="btn secondary" id="wm-cancel">Cancel</button></div>`;
    document.body.appendChild(m);
    const box = m.querySelector('.wmenu'); const r = box.getBoundingClientRect();
    box.style.left = Math.max(10, Math.min(window.innerWidth - r.width - 10, x - r.width / 2)) + 'px';
    box.style.top = Math.max(10, Math.min(window.innerHeight - r.height - 10, y + 16)) + 'px';
    m.addEventListener('click', e => { if (e.target === m) closeWordMenu(); });
    m.querySelector('#wm-cancel').onclick = closeWordMenu;
    if (easyRec) m.querySelector('#wm-unhide').onclick = () => { closeWordMenu(); undoHide(easyRec); refreshAfterHide(); setTimeout(() => toast(`${w.es} is back in rotation`), 30); };
    m.querySelector('#wm-act').onclick = () => {
      closeWordMenu();
      if (parked) unpark(id); else if (w.loose) { S.parked[id] = { at: Date.now(), word: w.es }; save(); hidePark(id, w.es, []); } else park(id);
      const rec = !parked && lastHide && lastHide.rec;
      refreshAfterHide();
      setTimeout(() => parked ? toast(`${w.es} is back in rotation`)
        : undoToast(w.loose ? `${w.es} marked not a priority` : `${w.es} parked until C2`, () => rec && undoHide(rec)), 30);
    };
  }
  function closeWordMenu() { document.querySelectorAll('.wmenu-backdrop').forEach(n => n.remove()); }
  // v9.2: long-press works on ANY Spanish word: tokenized text (course words carry data-w, every other word data-g), tiles and
  // Spanish answer buttons (data-lp; the word under the finger is found with caretRangeFromPoint). A long-press never also
  // picks the tile / answer or shows the tap hint, and iOS text selection + the callout are suppressed on those words.
  const LP_SEL = '[data-w], .tok[data-g], [data-lp]';
  function wordAt(t, x, y) {
    if (t.dataset.w) return { id: t.dataset.w };
    let word = t.dataset.g || '';
    if (!word && t.dataset.lp != null) {
      word = t.dataset.lp;
      try {
        const r = document.caretRangeFromPoint ? document.caretRangeFromPoint(x, y) : null;
        if (r && t.contains(r.startContainer) && r.startContainer.nodeType === 3) {
          const txt = r.startContainer.textContent, i = r.startOffset; let a = i, b = i;
          while (a > 0 && /[\p{L}\p{M}]/u.test(txt[a - 1])) a--; while (b < txt.length && /[\p{L}\p{M}]/u.test(txt[b])) b++;
          if (b > a) word = txt.slice(a, b);
        }
      } catch (e) { /* whole text */ }
      const ws = word.split(/\s+/).filter(Boolean); // several words and no point hit: the first course word, else the first word
      if (ws.length > 1) word = ws.find(w => IDX.forms[strip(w.replace(/[^\p{L}\p{M}]/gu, ''))]) || ws[ws.length - 1];
    }
    word = word.replace(/^[^\p{L}\p{M}]+|[^\p{L}\p{M}]+$/gu, '');
    if (!word) return null;
    const id = IDX.forms[strip(word)];
    return id ? { id } : { id: 'g:' + strip(word.toLowerCase()), word: word.toLowerCase() };
  }
  function initLongPress() {
    const cancel = () => { clearTimeout(lp.timer); lp.timer = null; };
    document.addEventListener('pointerdown', e => {
      const t = e.target.closest && e.target.closest(LP_SEL); lp.fired = false; if (!t || t.closest('.wmenu-backdrop')) return;
      lp.x = e.clientX; lp.y = e.clientY; cancel();
      lp.timer = setTimeout(() => { lp.timer = null; const w = wordAt(t, lp.x, lp.y); if (!w) return; lp.fired = true; closeHint(); try { navigator.vibrate && navigator.vibrate(10); } catch (err) { /* ignore */ } openWordMenu(w.id, lp.x, lp.y, w.word); }, 500);
    }, { passive: true });
    document.addEventListener('pointermove', e => { if (lp.timer && Math.hypot(e.clientX - lp.x, e.clientY - lp.y) > 10) cancel(); }, { passive: true });
    ['pointerup', 'pointercancel', 'scroll'].forEach(ev => document.addEventListener(ev, cancel, { passive: true, capture: true }));
    // the click that ends a long-press is swallowed before anything else sees it (tile pick, answer, tap hint)
    const swallow = e => { if (lp.fired && !(e.target.closest && e.target.closest('.wmenu-backdrop'))) { e.preventDefault(); e.stopImmediatePropagation(); if (e.type === 'click') lp.fired = false; } };
    window.addEventListener('click', swallow, true);
    document.addEventListener('contextmenu', e => { const t = e.target.closest && e.target.closest(LP_SEL); if (t) { e.preventDefault(); if (!document.querySelector('.wmenu-backdrop')) { const w = wordAt(t, e.clientX, e.clientY); if (w) openWordMenu(w.id, e.clientX, e.clientY, w.word); } } });
    document.addEventListener('selectstart', e => { if (e.target.closest && (e.target.nodeType === 1 ? e.target : e.target.parentElement).closest(LP_SEL)) e.preventDefault(); });
  }

  // ---------- updates ----------
  let pendingReload = false;
  function reloadForUpdate() {
    pendingReload = false;
    const last = +sessionStorage.getItem('sw-reload-at') || 0;
    if (Date.now() - last < 15000) return renderHome();
    sessionStorage.setItem('sw-reload-at', String(Date.now()));
    location.reload();
  }
  if ('serviceWorker' in navigator) {
    let hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController) { hadController = true; return; }
      if (run || story) pendingReload = true; else reloadForUpdate();
    });
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
        const check = () => reg.update().catch(() => {});
        check();
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
        window.addEventListener('pageshow', e => { if (e.persisted) check(); });
      }).catch(e => console.warn('SW failed', e));
    });
  }

  // ---------- boot ----------
  function initNoZoom() { // iOS: no double-tap zoom, no pinch-zoom; a quick second tap on the same control is dropped
    document.addEventListener('dblclick', e => e.preventDefault(), { passive: false });
    document.addEventListener('gesturestart', e => e.preventDefault(), { passive: false });
    let lastEnd = 0, lastEl = null;
    document.addEventListener('touchend', e => {
      if (e.touches && e.touches.length) return; // multi-finger
      const t = performance.now(), el = e.target && e.target.closest ? e.target.closest('button, .btn, .tile, .opt, a') || e.target : e.target;
      if (el === lastEl && t - lastEnd < 350 && !(navigator.webdriver && !window.__forceTapGuard)) e.preventDefault();
      lastEnd = t; lastEl = el;
    }, { passive: false });
  }
  async function boot() {
    S = load();
    FX.init(() => S.settings);
    initLongPress(); initNoZoom(); initHints();
    try { C = await (await fetch('content.json')).json(); }
    catch (e) { app.innerHTML = '<main class="card"><p>Could not load lessons. Open once with internet to install them.</p></main>'; return; }
    buildIndex(); Check.setKnown(Check.knownFromContent(C)); Check.setSynonyms(C.synonyms); migratePath(); applyStartParked();
    initVoices();
    await initRecorded();
    renderHome();
  }
  // v9: load the recorded-audio manifest (precached with the app; don't hold the home screen more than ~2.5 s for it),
  // unlock the audio element on the first tap (iOS), then quietly cache audio for offline use.
  async function initRecorded() {
    ['pointerdown', 'touchend', 'click', 'keydown'].forEach(ev => document.addEventListener(ev, Rec.unlock, { capture: true, passive: true }));
    await Promise.race([Rec.load(), new Promise(r => setTimeout(r, 2500))]);
    if (!Rec.man) Rec.load(); // slow network: keep trying in the background; speech falls back to device voices meanwhile
    setTimeout(() => { if (!Rec.man) return; Rec.prune().catch(() => {}); if (useRecorded() && S.settings.audioOffline !== false) Rec.prefetch(offlineAudio()).catch(() => {}); }, 4000);
  }
  // clips cached in the background after launch: every unit up to two past where you are (all done units included,
  // since reviews reuse them), plus the Settings samples. Units further ahead are cached when opened.
  function offlineAudio() {
    const list = IDX.section ? IDX.section.units : C.units.map(u => u.id), cur = currentPos();
    const uids = cur ? list.slice(0, list.indexOf(cur.uid) + 3) : list;
    const out = new Set(); uids.forEach(uid => unitAudio(C.units[IDX.unitIdx[uid]]).forEach(p => out.add(p)));
    [VOICE_TEST, RATE_TEST].forEach(t => { const p = Rec.lookup(Rec.man, t); if (p) out.add(p); });
    const p2 = Rec.lookup(Rec.man, VOICE2_TEST, Rec.man.second); if (p2) out.add(p2);
    return [...out];
  }
  window.__app = { version: APP_VERSION, counts: () => runCounts(), openWordMenu: (id, x, y, word) => openWordMenu(id, x, y, word), get state() { return S; }, get ex() { return run && run.ex; }, get entry() { return run && (run.ruleStep ? Object.assign({}, run.queue[run.i], { rule: true }) : run.queue[run.i]); }, get run() { return run; }, get story() { return story; },
    makeExercise: e => makeExercise(e), nextCard: () => nextCard(), openRule: p => openRule(p), get content() { return C; }, importBackup: (t) => importBackup(t, true), openStone: (u, i) => openStone(u, i), testQueue: u => testQueue(C.units[IDX.unitIdx[u]]), practiceQueue: u => practiceQueue(C.units[IDX.unitIdx[u]]), reviewQueue: () => reviewQueue(), chooseFocus: (c, f) => chooseFocus(c, f || []), patWeak: pk => patWeak(pk), startReview: () => startReview(), dueIds: () => dueIds(Date.now()), currentPos: () => currentPos(),
    introQueue: u => introQueue(C.units[IDX.unitIdx[u]]), wordPracticeQueue: u => wordPracticeQueue(C.units[IDX.unitIdx[u]]), stoneDone: (u, i) => stoneDone(u, i), STONES: STONES, withTiles: (w, t) => withTiles(w, t), pickStoryTile: u => pickStoryTile(C.units[IDX.unitIdx[u]].story),
    forceEx: (type, sent) => { if (!run || run.answered) return; run.ruleStep = null; const e = run.queue[run.i] = Object.assign({}, run.queue[run.i], { ex: type }, sent ? { sent } : {}); run.ex = makeExercise(e); renderExercise(e, run.ex); },
    speakPaused: () => speakPaused(), speakOk: () => speakOk(), cantSpeak: () => { const b = document.getElementById('cantSpeak'); if (b) b.click(); }, get voice() { return voice; }, get voice2() { return voice2; }, storyVoice: s => { const v = storyVoice(s); return v && { voice: v.voice && v.voice.name, pitch: v.pitch }; }, pickVoice: () => pickVoice(), gloss: w => gloss(w), pickExercise: (id, rev) => pickExercise(IDX.words[id], rev), unblockSpeech: () => unblockSpeech(), get micFails() { return micFails; }, get recActive() { return !!rec; }, get speechBlocked() { return speechBlocked; }, normalize: raw => normalize(raw), keepFooterVisible: () => keepFooterVisible(), speakables: () => speakables(), speak: (t, slow, spk) => speak(t, slow, spk != null ? storyVoice(spk) : null), unitAudio: u => unitAudio(C.units[IDX.unitIdx[u]]), get recorded() { return useRecorded(); }, recStory: s => storyVoice(s) && storyVoice(s).rec, offlineAudio: () => offlineAudio(),
    tick: () => tick(), listenPaused: () => listenPaused(), cantListen: () => { const b = document.getElementById('cantListen'); if (b) b.click(); }, todayMinutes: () => Daily.minutesOn(S.daily, todayKey()), streakNow: () => Daily.current(S.streak, todayKey()) };
  boot();
})();
