(() => {
  'use strict';
  const APP_VERSION = 'v6'; // keep in sync with CACHE in sw.js (espanol-v6)
  const KEY = 'spanish-app-state-v1'; // unchanged since v1 — never rename
  const DAY = SRS.DAY;
  const STONES = [
    { key: 'intro', label: 'New words', icon: 'Aa' },
    { key: 'story', label: 'Story', icon: '❝' },
    { key: 'practice', label: 'Practice', icon: '↻' },
    { key: 'test', label: 'Unit test', icon: '✓' }
  ];
  const PASS = 0.8;
  const app = document.getElementById('app');
  let C, S, IDX;

  // ---------- state + migration ----------
  const defaults = () => ({ v: 1, schema: 4, placementDone: false, created: Date.now(), items: {}, pstats: {}, recent: {},
    settings: { newPerSession: 5, rate: 0.9, autoAdvance: false, sound: true, anim: true, goalMin: Daily.GOAL_MIN }, sessions: 0,
    path: { done: {}, tests: {}, testedOut: {} }, parked: {}, daily: {}, streak: Daily.seed(), parkedDefaults: {} });
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
    s.schema = 4;
    return s;
  }
  function applyStartParked() { // syllabus words parked by default (e.g. poesía); only words not yet studied, and only once each
    let changed = false;
    (C.startParked || []).forEach(w => {
      if (!IDX.words[w] || S.parkedDefaults[w]) return;
      S.parkedDefaults[w] = true; changed = true;
      if (!S.items[wid(w)] && !S.parked[w]) S.parked[w] = { at: Date.now(), auto: true };
    });
    if (changed) save();
  }
  function migratePath() { // runs once content is loaded; derives path progress from existing SRS items
    if (!S.needsPathMigration) return;
    delete S.needsPathMigration;
    C.units.forEach(u => {
      const words = u.words.filter(w => !S.parked[w.id]);
      if (words.length && words.every(w => S.items[wid(w.id)])) setStone(u.id, 0, true);
    });
    if (S.placementSummary) applyPlacementToPath(S.placementSummary);
    save();
  }
  function applyPlacementToPath(sum) {
    const strong = new Set(sum.strong || []), known = new Set(sum.knownWords || []), tested = new Set(C.placement.words);
    C.units.forEach(u => {
      const testedHere = u.words.filter(w => tested.has(w.id));
      const out = u.focus.every(p => strong.has(p)) && testedHere.length > 0 && testedHere.every(w => known.has(w.id));
      if (out) { [0, 1, 2, 3].forEach(i => setStone(u.id, i, true)); S.path.testedOut[u.id] = true; }
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
  }
  // wrap Spanish text so each tracked vocabulary word can be long-pressed
  function tokenize(text) {
    return text.split(/(\s+)/).map(tok => {
      if (/^\s+$/.test(tok)) return tok;
      const core = tok.replace(/^[¿¡“"(«]+|[.,;:!?”"»)…]+$/g, '');
      const id = IDX.forms[strip(core)];
      return id ? esc(tok.slice(0, tok.indexOf(core))) + `<span class="tok w" data-w="${id}">${esc(core)}</span>` + esc(tok.slice(tok.indexOf(core) + core.length)) : esc(tok);
    }).join('');
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

  // ---------- speech ----------
  let voice = null;
  function pickVoice() {
    if (!('speechSynthesis' in window)) return;
    const vs = speechSynthesis.getVoices();
    voice = vs.find(v => /^es[-_]MX/i.test(v.lang)) || vs.find(v => /^es[-_](US|419)/i.test(v.lang)) || vs.find(v => /^es/i.test(v.lang)) || null;
  }
  function speak(text, slow) {
    if (!('speechSynthesis' in window)) return false;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = voice ? voice.lang : 'es-MX'; if (voice) u.voice = voice;
    u.rate = (S.settings.rate || 0.9) * (slow ? 0.7 : 1);
    speechSynthesis.speak(u); return true;
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
  const knownCard = c => c && (c.known || c.s >= 21);

  // ---------- path state ----------
  function stones(uid) { return S.path.done[uid] = S.path.done[uid] || [false, false, false, false]; }
  function setStone(uid, i, v) { stones(uid)[i] = v; }
  const unitDone = uid => stones(uid)[3];
  function currentPos() { // first unit (in order) with an unfinished stone
    for (const uid of IDX.section.units) { const st = stones(uid); const i = st.indexOf(false); if (i >= 0) return { uid, stone: i }; }
    return null;
  }
  function stoneState(uid, i) {
    if (stones(uid)[i]) return 'done';
    const cur = currentPos();
    if (!cur) return 'done';
    const ui = IDX.section.units.indexOf(uid), ci = IDX.section.units.indexOf(cur.uid);
    if (ui < ci) return stones(uid).slice(0, i).every(Boolean) ? 'open' : 'locked'; // earlier unit, skipped stone
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
      const i = entry.itemIdx != null ? entry.itemIdx : patternItem(p); const it = pat.items[i];
      const full = it.q.replace('___', it.o[0]);
      return { kind: 'mc', label: run && run.mode === 'placement' ? 'Grammar' : 'Grammar · ' + pat.name.replace(/\s*\(.*\)\s*$/, ''), prompt: it.q, options: shuffle(it.o), answer: it.o[0], reveal: { es: full, en: it.en, note: it.n }, speakAfter: full.replace(/\s*\([^)]*\)\s*$/, '') };
    }
    const w = IDX.words[entry.id.slice(2)], card = S.items[entry.id];
    const sents = IDX.sentByWord[w.id] || [];
    let type = entry.ex;
    if (type === 'build') {
      const sent = entry.sent || pick(sents);
      const tokens = sent.es.replace(/[¿?¡!.,;:]/g, '').split(/\s+/).filter(Boolean);
      const others = shuffle(IDX.sentences.filter(s => s !== sent)).slice(0, 3).flatMap(s => s.es.replace(/[¿?¡!.,;:]/g, '').split(/\s+/));
      const lower = new Set(tokens.map(t => t.toLowerCase()));
      const distract = shuffle(others.filter(t => t.length > 2 && !lower.has(t.toLowerCase()))).slice(0, 2);
      return { kind: 'build', label: 'Build the sentence in Spanish', big: sent.en, tiles: shuffle(tokens.concat(distract)), answers: [sent.es], opts: { lang: 'es' }, reveal: { es: sent.es, en: sent.en }, speakAfter: sent.es };
    }
    if (!type) {
      const s = card ? card.s : 0;
      type = s < 3 ? pick(['es2en', 'cloze', 'listen']) : s < 15 ? pick(['en2es', 'cloze', 'listen', 'es2en']) : pick(['en2es', 'listen', 'cloze']);
    }
    if ((type === 'cloze' || type === 'listenS') && !sents.length) type = 'en2es';
    const sent = sents.length ? pick(sents) : null;
    const esAns = [w.es].concat(w.esAlt || []);
    switch (type) {
      case 'es2en': return { kind: 'type', label: 'Translate to English', big: w.es, bigW: w.id, speakNow: w.es, answers: w.accept, opts: { lang: 'en', typo: true }, placeholder: 'English', reveal: { es: w.es, en: w.en, note: w.note, ex: sent } };
      case 'en2es': return { kind: 'type', label: 'Translate to Spanish', big: w.en, bigW: w.id, answers: esAns, opts: { lang: 'es', typo: w.es.length >= 8 }, placeholder: 'Español', reveal: { es: w.es, en: w.en, note: w.note, ex: sent }, speakAfter: w.es };
      case 'cloze': {
        const blank = sent.es.replace(sent.f, '_____');
        return { kind: 'type', label: 'Fill in the missing word', clozeEs: blank, sub: sent.en + (sent.h ? ` · (${sent.h})` : ` · (${w.en})`), answers: [sent.f], opts: { lang: 'es' }, placeholder: 'Español', reveal: { es: sent.es, en: sent.en, note: w.note }, speakAfter: sent.es };
      }
      default: {
        const useSentence = sent && (card && card.s >= 3 || type === 'listenS');
        const text = useSentence ? sent.es : w.es;
        return { kind: 'type', label: useSentence ? 'Listen and type the sentence' : 'Listen and type the word', listen: text, answers: [text], opts: { lang: 'es', sentence: useSentence, typo: !useSentence && w.es.length >= 8 }, placeholder: 'Escribe lo que oyes', reveal: useSentence ? { es: sent.es, en: sent.en } : { es: w.es, en: w.en, note: w.note } };
      }
    }
  }

  // ---------- runner (placement, review, and the intro/practice/test stones share this) ----------
  let run = null;
  function startRun(queue, mode, meta) { sessionStart(); run = Object.assign({ queue, i: 0, mode, results: [], firstDone: {}, score: 0, total: 0, misses: [] }, meta || {}); nextCard(); }
  function nextCard() {
    while (run.i < run.queue.length && run.queue[run.i].id && run.queue[run.i].id.startsWith('w:') && isParked(run.queue[run.i].id) && run.mode !== 'placement') run.i++;
    if (run.i >= run.queue.length) return finishRun();
    const entry = run.queue[run.i];
    if (entry.theme) return renderTheme(entry);
    if (entry.intro) return renderIntro(entry);
    run.ex = makeExercise(entry); run.answered = false;
    renderExercise(entry, run.ex);
  }
  function finishRun() {
    sessionDone();
    if (run.mode === 'placement') return finishPlacement();
    if (run.mode === 'review') return finishReview();
    if (run.mode === 'test') return finishTest();
    const { uid, stone } = run; setStone(uid, stone, true); S.lastStudy = Date.now(); save(); run = null;
    renderHome({ justDone: { uid, stone } });
  }
  function progressBar() { const pct = run.barPct || 0; return `<div class="topbar"><button class="icon" id="quit" aria-label="Close">✕</button><div class="bar"><span style="width:${pct}%"></span></div><span class="count">${Math.min(run.i + 1, run.queue.length)}/${run.queue.length}</span></div>`; }
  function setBar(frac) {
    const pct = Math.max(0, Math.min(100, 100 * frac)); if (run) run.barPct = pct;
    const el = app.querySelector('.bar span'); if (!el) return; void el.offsetWidth; el.style.width = pct + '%';
  }
  function bindQuit(onQuit) { document.getElementById('quit').onclick = () => { if (run && run.mode === 'placement' && !confirm('Leave placement? Progress on it will be lost.')) return; if ('speechSynthesis' in window) speechSynthesis.cancel(); tick(); save(); run = null; story = null; (onQuit || renderHome)(); }; }

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
      <h3>Grammar focus</h3><ul class="list">${u.focus.map(p => `<li>${esc(C.patterns[p].name)}</li>`).join('')}</ul>
      <p class="muted small">Tip: press and hold any word to mark it “Not a priority”.</p></main>
      <footer><button class="btn primary" id="go">Start</button></footer>`;
    bindQuit(); setBar(run.i / run.queue.length);
    document.getElementById('go').onclick = () => { run.i++; nextCard(); };
  }
  function renderIntro(entry) {
    let body;
    if (entry.id.startsWith('w:')) {
      const w = IDX.words[entry.id.slice(2)]; const ex = (IDX.sentByWord[w.id] || [])[0];
      body = `<div class="label"><span class="badge new">NEW</span> New word · ${esc(C.units[w.unitIdx].title)}</div>
        <div class="big">${wordSpan(w.id, w.es)} <button class="icon speak" data-say="${esc(w.es)}">🔊</button></div>
        <div class="en">${esc(w.en)}</div>${w.note ? `<p class="note">${esc(w.note)}</p>` : ''}
        ${ex ? `<div class="example"><div>${tokenize(ex.es)} <button class="icon speak" data-say="${esc(ex.es)}">🔊</button></div><div class="muted">${esc(ex.en)}</div></div>` : ''}
        <div class="row"><button class="btn secondary" id="known">I already know this</button></div>`;
    } else {
      const p = IDX.patterns[entry.id.slice(2)];
      body = `<div class="label"><span class="badge new">NEW</span> Grammar pattern</div><div class="title">${esc(p.name)}</div><p>${esc(p.explain)}</p>`;
    }
    app.innerHTML = progressBar() + `<main class="card">${body}</main><footer><button class="btn primary" id="go">Continue</button></footer>`;
    bindQuit(); bindSpeak(); setBar(run.i / run.queue.length);
    if (entry.id.startsWith('w:')) speak(IDX.words[entry.id.slice(2)].es);
    const known = document.getElementById('known');
    if (known) known.onclick = () => {
      S.items[entry.id] = SRS.markKnown(S.items[entry.id], Date.now(), 120); save();
      run.queue = run.queue.filter((e, k) => k <= run.i || e.id !== entry.id); run.i++; nextCard();
    };
    document.getElementById('go').onclick = () => { run.i++; nextCard(); };
  }

  function renderExercise(entry, ex) {
    let prompt = '';
    if (ex.kind === 'mc') prompt = `<div class="prompt">${esc(ex.prompt).replace('___', '<span class="blank">___</span>')}</div>`;
    else if (ex.kind === 'build') prompt = `<div class="prompt en-prompt">${esc(ex.big)}</div>`;
    else if (ex.listen) prompt = `<div class="listen"><button class="btn play" id="play">🔊 Play</button><button class="btn secondary" id="slow">🐢 Slow</button></div>`;
    else if (ex.clozeEs) prompt = `<div class="prompt">${tokenize(ex.clozeEs).replace('_____', '<span class="blank">_____</span>')}</div><div class="muted sub">${esc(ex.sub)}</div>`;
    else prompt = `<div class="big">${ex.bigW ? wordSpan(ex.bigW, ex.big) : esc(ex.big)}${ex.speakNow ? ` <button class="icon speak" data-say="${esc(ex.speakNow)}">🔊</button>` : ''}</div>`;
    let input;
    if (ex.kind === 'mc') input = `<div class="options">${ex.options.map((o, k) => `<button class="opt" data-k="${k}">${esc(o)}</button>`).join('')}</div>`;
    else if (ex.kind === 'build') input = `<div class="answer-line" id="line"></div><div class="tiles" id="tiles">${ex.tiles.map((t, k) => `<button class="tile" data-k="${k}">${esc(t)}</button>`).join('')}</div>`;
    else input = `<form id="f" autocomplete="off"><input id="ans" type="text" lang="${ex.opts.lang}" placeholder="${esc(ex.placeholder)}" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="done"></form>`;
    app.innerHTML = progressBar() + `<main class="card"><div class="label">${run.mode === 'test' ? 'Test · ' : ''}${esc(ex.label)}</div>${prompt}${input}<div id="fb"></div></main>
      <footer>${ex.kind === 'mc' ? '' : '<button class="btn secondary" id="skip">I don\'t know</button><button class="btn primary" id="check">Check</button>'}</footer>`;
    bindQuit(); bindSpeak(); setBar(run.i / run.queue.length);
    if (ex.listen) {
      document.getElementById('play').onclick = () => speak(ex.listen);
      document.getElementById('slow').onclick = () => speak(ex.listen, true);
      speak(ex.listen);
    }
    if (ex.kind === 'mc') {
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
      const line = document.getElementById('line'), tiles = document.getElementById('tiles'); ex.order = [];
      const draw = () => { line.innerHTML = ex.order.map(k => `<button class="tile in" data-k="${k}">${esc(ex.tiles[k])}</button>`).join(''); tiles.querySelectorAll('.tile').forEach(t => t.classList.toggle('used', ex.order.includes(+t.dataset.k))); };
      tiles.onclick = e => { const t = e.target.closest('.tile'); if (!t || run.answered || ex.order.includes(+t.dataset.k)) return; ex.order.push(+t.dataset.k); draw(); };
      line.onclick = e => { const t = e.target.closest('.tile'); if (!t || run.answered) return; ex.order = ex.order.filter(k => k !== +t.dataset.k); draw(); };
      const doCheck = () => { if (!ex.order.length) return; const v = ex.order.map(k => ex.tiles[k]).join(' '); const r = Check.check(v, ex.answers, { lang: 'es' }); answer(entry, ex, r.result === 'exact' ? 'exact' : 'wrong', v); };
      document.getElementById('check').onclick = () => run.answered ? advance() : doCheck();
      document.getElementById('skip').onclick = () => { if (!run.answered) answer(entry, ex, 'wrong', ''); };
      return;
    }
    const inp = document.getElementById('ans'); setTimeout(() => inp.focus(), 50);
    const doCheck = () => { const v = inp.value; if (!v.trim()) return; const r = Check.check(v, ex.answers, ex.opts); ex.matched = r.answer; answer(entry, ex, r.result, v); };
    document.getElementById('f').onsubmit = e => { e.preventDefault(); if (run.answered) return advance(); doCheck(); };
    document.getElementById('check').onclick = () => run.answered ? advance() : doCheck();
    document.getElementById('skip').onclick = () => { if (!run.answered) answer(entry, ex, 'wrong', ''); };
  }

  function answer(entry, ex, result, given) {
    run.answered = true;
    const ok = result !== 'wrong';
    const g = result === 'exact' ? 3 : ok ? 2 : 1;
    const isPattern = entry.id.startsWith('p:');
    const graded = run.mode !== 'placement' && !entry.practice && !run.firstDone[entry.id];
    if (run.mode === 'placement') run.results.push({ id: entry.id, ok });
    else {
      if (graded) { run.firstDone[entry.id] = true; run.prev = S.items[entry.id] ? Object.assign({}, S.items[entry.id]) : undefined; grade(entry.id, g); }
      if (isPattern) pstat(entry.id.slice(2), ok);
      if (run.mode === 'test') { run.total++; if (ok) run.score++; else run.misses.push(ex.kind === 'mc' ? ex.reveal.es : (ex.reveal.es || ex.answers[0])); entry.ok = ok; }
      else if (!ok) requeueAfterMiss(entry);
      save();
    }
    const fb = document.getElementById('fb');
    const correctForm = ex.kind === 'mc' ? ex.answer : (ex.matched || ex.answers[0]);
    const head = result === 'exact' ? '<div class="ok">✓ Correct</div>'
      : result === 'accent' ? `<div class="ok warn">✓ Watch the accents: <b>${esc(correctForm)}</b></div>`
      : result === 'typo' ? `<div class="ok warn">✓ Close — check spelling: <b>${esc(correctForm)}</b></div>`
      : `<div class="bad">✗ ${ex.kind === 'mc' ? 'Answer' : 'Correct answer'}: <b>${esc(correctForm)}</b></div>`;
    const rv = ex.reveal || {};
    let more = '';
    if (rv.es && rv.es !== correctForm) more += `<div class="rv-es">${tokenize(rv.es)} <button class="icon speak" data-say="${esc(ex.speakAfter || rv.es)}">🔊</button></div>`;
    else if (ex.speakAfter || rv.es) more += `<div><button class="icon speak" data-say="${esc(ex.speakAfter || rv.es)}">🔊</button></div>`;
    if (rv.en) more += `<div class="muted">${esc(rv.en)}</div>`;
    if (rv.note && (!ok || isPattern)) more += `<p class="note">${esc(rv.note)}</p>`;
    if (rv.ex && !ok) more += `<div class="example"><div>${tokenize(rv.ex.es)}</div><div class="muted">${esc(rv.ex.en)}</div></div>`;
    fb.innerHTML = `<div class="feedback ${ok ? 'good' : 'miss'}">${head}${more}</div>`;
    bindSpeak();
    const inp = document.getElementById('ans'); if (inp) inp.readOnly = true;
    setBar((run.i + 1) / run.queue.length);
    const chosen = ex.kind === 'mc' ? app.querySelector(ok ? '.opt.right' : '.opt.wrong') : ex.kind === 'build' ? document.getElementById('line') : inp;
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
      if (run.mode === 'test' && !entry.ok) { run.score++; entry.ok = true; run.misses.pop(); }
      run.queue = run.queue.filter((e, k) => k <= run.i || !(e.id === entry.id && e.fromMiss)); save(); advance();
    };
    const ez = document.getElementById('easy');
    if (ez) ez.onclick = () => { S.items[entry.id] = SRS.markKnown(S.items[entry.id], Date.now(), 120); save(); advance(); };
    if (ok && result === 'exact' && S.settings.autoAdvance && run.mode !== 'placement') run.timer = setTimeout(advance, 900);
    else setTimeout(() => document.getElementById('next') && document.getElementById('next').focus(), 30);
  }
  function advance() { if (!run) return; clearTimeout(run.timer); run.i++; nextCard(); }
  function requeueAfterMiss(entry) {
    const q = run.queue, at = run.i;
    if (entry.id.startsWith('p:')) {
      if (q.filter((e, k) => k > at && e.id === entry.id && e.fromMiss).length >= 2) return;
      q.splice(Math.min(q.length, at + 3), 0, { id: entry.id, practice: true, fromMiss: true });
      q.splice(Math.min(q.length, at + 7), 0, { id: entry.id, practice: true, fromMiss: true });
    } else {
      if (q.some((e, k) => k > at && e.id === entry.id && e.fromMiss)) return;
      q.splice(Math.min(q.length, at + 4), 0, { id: entry.id, practice: true, fromMiss: true, ex: entry.ex === 'en2es' ? 'es2en' : 'en2es' });
    }
  }

  // ---------- stone builders ----------
  function introQueue(u) {
    const q = [{ theme: true, id: '' }];
    const fresh = u.words.filter(w => !S.parked[w.id] && !knownCard(S.items[wid(w.id)]));
    fresh.forEach(w => { q.push({ id: wid(w.id), intro: true }); q.push({ id: wid(w.id), ex: 'es2en' }); });
    u.focus.forEach(p => {
      if (!S.items[pid(p)]) { q.push({ id: pid(p), intro: true }); q.push({ id: pid(p) }); q.push({ id: pid(p), practice: true }); }
      else q.push({ id: pid(p) });
    });
    shuffle(fresh).forEach(w => q.push({ id: wid(w.id), ex: pick(['en2es', 'cloze', 'listen']), practice: true }));
    return q;
  }
  function practiceQueue(u, n) {
    n = n || 14; const now = Date.now();
    const units = unitsUpTo(u.id);
    const pool = [];
    units.forEach(x => { x.words.forEach(w => { if (!S.parked[w.id] && S.items[wid(w.id)]) pool.push(wid(w.id)); }); x.focus.forEach(p => { if (S.items[pid(p)] && !pool.includes(pid(p))) pool.push(pid(p)); }); });
    const eod = endOfToday();
    const score = id => { const c = S.items[id]; const due = c.due <= eod ? 0 : 1; const weak = (c.lapses || 0) > 0 || c.s < 7 ? 0 : 1; return due * 2 + weak + SRS.currentR(c, now) * 0.5 + Math.random() * 0.4; };
    const ranked = pool.sort((a, b) => score(a) - score(b));
    let chosen = ranked.slice(0, n);
    const pats = ranked.filter(id => id.startsWith('p:'));
    if (chosen.filter(id => id.startsWith('p:')).length < 3) chosen = shuffle(chosen.filter(id => id.startsWith('w:')).slice(0, n - 3).concat(pats.slice(0, 3)));
    // fresh sentences: words lean on cloze / sentence listening, patterns pick unseen items
    return shuffle(chosen).map(id => id.startsWith('w:') ? { id, ex: pick(['cloze', 'listenS', 'en2es', 'cloze']) } : { id });
  }
  function testQueue(u) {
    const units = unitsUpTo(u.id).reverse(); // most recent first
    const vocab = [];
    for (const x of units) for (const w of shuffle(x.words)) { if (vocab.length >= 12) break; if (!S.parked[w.id]) vocab.push(w.id); }
    // early in a section there may be fewer than 12 words: reuse them in a different exercise direction
    const uniq = vocab.slice(); for (let k = 0; vocab.length < 12 && uniq.length; k++) vocab.push(uniq[k % uniq.length]);
    const types = ['en2es', 'cloze', 'es2en', 'listen'];
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
    if (i === 1) return startStory(u);
    const meta = { uid, stone: i };
    if (i === 0) return startRun(introQueue(u), 'intro', meta);
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
  function startStory(u) { sessionStart(); story = { u, shown: 1, answered: {}, showEn: false }; renderStory(true); }
  function renderStory(speakLast) {
    const { u } = story, st = u.story, lines = st.lines.slice(0, story.shown);
    const pendingQ = st.qs.find(q => q.after === story.shown - 1 && !story.answered[st.qs.indexOf(q)]);
    const done = story.shown >= st.lines.length && !pendingQ;
    const frac = (story.shown + Object.keys(story.answered).length) / (st.lines.length + st.qs.length);
    app.innerHTML = `<div class="topbar"><button class="icon" id="quit" aria-label="Close">✕</button><div class="bar"><span style="width:${story.bar || 0}%"></span></div><button class="icon small-btn" id="en" aria-pressed="${story.showEn}">EN</button></div>
      <main class="card story ${story.entered ? 'no-enter' : ''}"><div class="label">Story · ${esc(u.title)}</div><h1>${esc(st.title)}</h1>
      ${lines.map((l, k) => `<div class="sline ${k === lines.length - 1 ? 'fresh' : ''}" data-k="${k}">${l.s ? `<div class="speaker">${esc(l.s)}</div>` : ''}<div class="ses"><button class="icon speak" data-say="${esc(l.es)}">🔊</button> <span>${tokenize(l.es)}</span></div><div class="sen muted ${story.showEn ? '' : 'hidden'}">${esc(l.en)}</div></div>`).join('')}
      ${pendingQ ? `<div class="squestion"><div class="prompt">${esc(pendingQ.q)}</div><div class="options">${shuffle(pendingQ.o).map(o => `<button class="opt" data-o="${esc(o)}">${esc(o)}</button>`).join('')}</div><div id="fb"></div></div>` : ''}
      </main><footer>${pendingQ ? '' : `<button class="btn primary" id="next">${done ? 'Finish story' : 'Continue'}</button>`}</footer>`;
    story.entered = true; bindQuit(); bindSpeak();
    const bar = app.querySelector('.bar span'); void bar.offsetWidth; story.bar = 100 * frac; bar.style.width = story.bar + '%';
    document.getElementById('en').onclick = () => { story.showEn = !story.showEn; renderStory(false); };
    app.querySelectorAll('.sline .ses span').forEach(sp => sp.onclick = e => { if (!e.target.closest('[data-w]') || !lp.fired) speak(st.lines[+sp.closest('.sline').dataset.k].es); });
    const last = app.querySelector('.sline.fresh'); if (last) last.scrollIntoView({ block: 'nearest', behavior: S.settings.anim === false ? 'auto' : 'smooth' });
    if (speakLast && lines.length) speak(lines[lines.length - 1].es);
    if (pendingQ) {
      const qi = st.qs.indexOf(pendingQ);
      app.querySelectorAll('.squestion .opt').forEach(b => b.onclick = () => {
        if (story.answered[qi] != null) return;
        const ok = b.dataset.o === pendingQ.o[0]; story.answered[qi] = ok;
        app.querySelectorAll('.squestion .opt').forEach(x => { if (x.dataset.o === pendingQ.o[0]) x.classList.add('right'); });
        if (!ok) b.classList.add('wrong');
        const target = pendingQ.p ? pid(pendingQ.p) : pendingQ.k && !S.parked[pendingQ.k] && S.items[wid(pendingQ.k)] ? wid(pendingQ.k) : null;
        if (target && !story['g' + target]) { story['g' + target] = 1; grade(target, ok ? 3 : 1); }
        if (pendingQ.p) pstat(pendingQ.p, ok);
        save();
        if (ok) FX.correct([b]); else FX.miss([b]);
        app.querySelector('footer').innerHTML = '<button class="btn primary" id="next">Continue</button>';
        document.getElementById('next').onclick = () => storyNext();
      });
    } else document.getElementById('next').onclick = () => storyNext();
  }
  function storyNext() {
    const st = story.u.story;
    const pendingQ = st.qs.find(q => q.after === story.shown - 1 && story.answered[st.qs.indexOf(q)] == null);
    if (pendingQ) return renderStory(false);
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
  function reviewQueue() { return dueIds(Date.now()).slice(0, 60).map(id => ({ id })); }
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
    const offs = [0, 1, 0, -1];
    const sectionHtml = s => {
      if (s.placeholder === 'before') return `<div class="section-card skipped"><span class="cefr">${esc(s.cefr)}</span><div><b>${esc(s.title)}</b><div class="muted small">Skipped — below your level</div></div></div>`;
      if (s.placeholder === 'after') return `<div class="section-card locked"><span class="cefr">${esc(s.cefr)}</span><div><b>${esc(s.title)}</b><div class="muted small">Not written yet</div></div></div>`;
      return `<div class="section-card current"><span class="cefr">${esc(s.cefr)}</span><div><b>${esc(s.title)}</b><div class="muted small">${esc(s.desc || '')}</div><div class="muted small">${doneUnits}/${s.units.length} units done</div></div></div>
        ${s.units.map((uid, n) => {
          const u = C.units[IDX.unitIdx[uid]];
          return `<div class="unit ${unitDone(uid) ? 'udone' : ''}${u.ta ? ' ta' : ''}" id="unit-${uid}"><div class="unit-head"><div class="label">Unit ${n + 1}${u.ta ? ' · <span class="badge ta">Tres Aguas</span>' : ''}${S.path.testedOut[uid] ? ' · tested out' : ''}</div><div class="utitle">${esc(u.title)}</div><div class="muted small">${esc(u.titleEn)} · ${u.focus.map(p => esc(C.patterns[p].name.replace(/\s*\(.*\)\s*$/, ''))).join(' · ')}</div></div>
            <div class="stones">${STONES.map((stn, i) => { const state = stoneState(uid, i); const jd = opts.justDone && opts.justDone.uid === uid && opts.justDone.stone === i;
              return `<div class="stone-wrap" style="--off:${offs[i]}"><button class="stone ${state}${jd ? ' just-done' : ''}" data-u="${uid}" data-s="${i}" aria-label="${esc(stn.label)}">${state === 'done' ? '✓' : state === 'locked' ? '🔒' : stn.icon}</button><span class="stone-label">${esc(stn.label)}${i === 3 && S.path.tests[uid] ? ` · ${S.path.tests[uid].best}/${S.path.tests[uid].total || 15}` : ''}</span></div>`; }).join('')}</div></div>`;
        }).join('')}`;
    };
    app.innerHTML = `<div class="home-head"><div class="topbar home-top"><div class="title">Español <span class="muted small">${APP_VERSION}</span></div><button class="btn secondary slim" id="prog">Progress</button></div>${dayBarHtml()}</div>
      <main class="card path">
      <button class="btn ${st.due ? 'primary' : 'secondary'} review-btn" id="review" ${st.due ? '' : 'disabled'}>${st.due ? `Review · ${st.due} due` : 'No reviews due'}</button>
      ${st.weak.length ? `<p class="muted small center">Weak: ${st.weak.slice(0, 3).map(w => esc(C.patterns[w.p].name.replace(/\s*\(.*\)\s*$/, ''))).join(' · ')}</p>` : ''}
      ${C.sections.map(sectionHtml).join('')}
      ${!cur ? '<p class="center muted">Section complete. More sections are coming.</p>' : ''}
      <p class="muted small version">${APP_VERSION}</p></main><div id="toast" class="toast"></div>`;
    document.getElementById('prog').onclick = renderProgress;
    document.getElementById('review').onclick = startReview;
    app.querySelectorAll('.stone').forEach(b => b.onclick = () => {
      const uid = b.dataset.u, i = +b.dataset.s, state = stoneState(uid, i);
      if (state === 'locked') return toast('Finish the stone before this one first.');
      openStone(uid, i);
    });
    const focus = opts.justDone ? app.querySelector('.stone.just-done') : app.querySelector('.stone.current');
    if (focus) focus.scrollIntoView({ block: 'center' });
    if (opts.justDone) { const el = app.querySelector('.stone.just-done'); FX.stone(el); }
    T.shownDay = todayKey(); celebrateGoal();
  }
  function toast(msg) { const t = document.getElementById('toast'); if (!t) return; t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 1800); }

  // ---------- progress ----------
  function fmtDue(c) { const d = Math.round((c.due - Date.now()) / DAY); return d <= 0 ? 'due' : d === 1 ? '1 day' : d < 60 ? d + ' days' : Math.round(d / 30) + ' mo'; }
  function renderProgress() {
    const st = stats();
    const units = IDX.section.units.map(uid => {
      const u = C.units[IDX.unitIdx[uid]]; const n = stones(uid).filter(Boolean).length;
      return `<li class="col"><div class="rowline"><span>${esc(u.title)} <span class="muted">· ${esc(u.titleEn)}</span></span><span>${n}/4</span></div><div class="small">${u.words.map(w => `<span class="chip ${S.parked[w.id] ? 'parked' : S.items[wid(w.id)] ? 'learned' : ''}" data-w="${w.id}">${esc(w.es)}</span>`).join(' ')}</div></li>`;
    }).join('');
    const patterns = Object.keys(C.patterns).map(p => {
      const c = S.items[pid(p)], ps = S.pstats[p];
      return `<li><span>${esc(C.patterns[p].name)}</span><span class="muted">${c ? (ps && ps.seen ? Math.round(100 * ps.correct / ps.seen) + '% · ' : '') + fmtDue(c) : 'not started'}</span></li>`;
    }).join('');
    const weak = st.weak.map(w => `<li><span>${esc(C.patterns[w.p].name)}</span><span class="muted">${w.acc != null ? Math.round(w.acc * 100) + '%' : ''}</span></li>`).join('') || '<li class="muted">None right now</li>';
    const parked = Object.keys(S.parked).filter(w => IDX.words[w]).map(w => `<li><span>${wordSpan(w, IDX.words[w].es)} <span class="muted">· ${esc(IDX.words[w].en)}</span></span><button class="btn secondary slim unpark" data-id="${w}">Unpark</button></li>`).join('') || '<li class="muted">None. Press and hold any word to park it.</li>';
    app.innerHTML = `<div class="topbar"><button class="icon" id="back" aria-label="Back">←</button><div class="title">Progress</div></div>
      <main class="card">
      <div class="today"><div><b>${st.words}</b><span>words learned</span></div><div><b>${st.mastered}</b><span>long-term</span></div><div><b>${st.due}</b><span>due today</span></div></div>
      <h3>Weak patterns</h3><ul class="list">${weak}</ul>
      <h3>Units · ${esc(IDX.section.cefr)}</h3><ul class="list">${units}</ul>
      <h3>Parked words</h3><p class="muted small">Not a priority — skipped in lessons, practice, tests and reviews until you reach C2.</p><ul class="list" id="parked">${parked}</ul>
      <h3>Grammar patterns</h3><ul class="list">${patterns}</ul>
      <h3>Settings</h3>
      <label class="set">New words per unit intro <span class="muted small">4–5 per unit</span></label>
      <label class="set">Speech speed <input id="rate" type="range" min="0.6" max="1.2" step="0.05" value="${S.settings.rate}"></label>
      <label class="set">Sound effects <input id="snd" type="checkbox" ${S.settings.sound !== false ? 'checked' : ''}></label>
      <label class="set">Animations <input id="anim" type="checkbox" ${S.settings.anim !== false ? 'checked' : ''}></label>
      <label class="set">Auto-continue on correct <input id="auto" type="checkbox" ${S.settings.autoAdvance ? 'checked' : ''}></label>
      <div class="set">Edit streak <span class="row-inline"><input id="streakIn" type="number" inputmode="numeric" min="0" step="1" value="${Daily.current(S.streak, todayKey()).count}"><button class="btn secondary slim" id="streakSave">Save</button></span></div>
      <p class="muted small">Use this only to correct the number. Today counts once you finish a lesson.</p>
      <p class="muted">Voice: ${voice ? esc(voice.name + ' (' + voice.lang + ')') : 'default Spanish'} <button class="icon speak" data-say="¿Me lo puedes mandar mañana?">🔊</button></p>
      <h3>Backup</h3>
      <div class="row wrap"><button class="btn secondary" id="exp">Export progress</button><button class="btn secondary" id="copy">Copy to clipboard</button><label class="btn secondary">Import file<input id="imp" type="file" accept="application/json,.json" hidden></label></div>
      <textarea id="paste" placeholder="…or paste a backup here and tap Import pasted" rows="2"></textarea>
      <div class="row wrap"><button class="btn secondary" id="impPaste">Import pasted</button><button class="btn secondary" id="replace">Retake placement</button><button class="btn danger" id="reset">Reset everything</button></div>
      <p class="muted small">App ${APP_VERSION} · Content v${C.version} · ${C.units.length} units · ${IDX.wordOrder.length} words · ${Object.keys(C.patterns).length} patterns</p>
      </main><div id="toast" class="toast"></div>`;
    bindSpeak();
    document.getElementById('back').onclick = () => renderHome();
    app.querySelectorAll('.unpark').forEach(b => b.onclick = () => { unpark(b.dataset.id); renderProgress(); });
    document.getElementById('rate').onchange = e => { S.settings.rate = +e.target.value; save(); speak('Así suena ahora.'); };
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
  function bindSpeak() { app.querySelectorAll('.speak').forEach(b => b.onclick = e => { e.preventDefault(); speak(b.dataset.say); }); }

  // ---------- parking ("Not a priority") via long-press ----------
  function park(w) {
    S.parked[w] = { at: Date.now() }; save();
    if (run && run.mode !== 'placement') {
      const curId = run.queue[run.i] && run.queue[run.i].id;
      run.queue = run.queue.filter((e, k) => k <= run.i || e.id !== wid(w));
      if (curId === wid(w) && !run.answered) { run.i++; nextCard(); }
    }
  }
  function unpark(w) { delete S.parked[w]; save(); }
  const lp = { timer: null, fired: false, x: 0, y: 0 };
  function openWordMenu(id, x, y) {
    closeWordMenu();
    const w = IDX.words[id]; if (!w) return;
    const parked = !!S.parked[id];
    const m = document.createElement('div'); m.className = 'wmenu-backdrop';
    m.innerHTML = `<div class="wmenu" role="menu"><div class="wmenu-word">${esc(w.es)}</div><div class="muted small">${esc(w.en)}</div>
      <button class="btn ${parked ? 'secondary' : 'primary'}" id="wm-act">${parked ? 'Unpark (bring back)' : 'Not a priority'}</button>
      ${parked ? '' : '<div class="muted small">Skips this word in lessons, practice, tests and reviews until C2.</div>'}
      <button class="btn secondary" id="wm-cancel">Cancel</button></div>`;
    document.body.appendChild(m);
    const box = m.querySelector('.wmenu'); const r = box.getBoundingClientRect();
    box.style.left = Math.max(10, Math.min(window.innerWidth - r.width - 10, x - r.width / 2)) + 'px';
    box.style.top = Math.max(10, Math.min(window.innerHeight - r.height - 10, y + 16)) + 'px';
    m.addEventListener('click', e => { if (e.target === m) closeWordMenu(); });
    m.querySelector('#wm-cancel').onclick = closeWordMenu;
    m.querySelector('#wm-act').onclick = () => {
      closeWordMenu();
      if (parked) unpark(id); else park(id);
      if (app.querySelector('#parked')) renderProgress();
      else if (!run && !story) renderHome();
      else if (story) renderStory(false);
      else if (run && run.queue[run.i] && run.queue[run.i].theme) renderTheme(run.queue[run.i]);
      setTimeout(() => toast(parked ? `${w.es} is back in rotation` : `${w.es} parked until C2`), 30);
    };
  }
  function closeWordMenu() { document.querySelectorAll('.wmenu-backdrop').forEach(n => n.remove()); }
  function initLongPress() {
    const cancel = () => { clearTimeout(lp.timer); lp.timer = null; };
    document.addEventListener('pointerdown', e => {
      const t = e.target.closest && e.target.closest('[data-w]'); lp.fired = false; if (!t) return;
      lp.x = e.clientX; lp.y = e.clientY; cancel();
      lp.timer = setTimeout(() => { lp.fired = true; lp.timer = null; try { navigator.vibrate && navigator.vibrate(10); } catch (err) { /* ignore */ } openWordMenu(t.dataset.w, lp.x, lp.y); }, 500);
    }, { passive: true });
    document.addEventListener('pointermove', e => { if (lp.timer && Math.hypot(e.clientX - lp.x, e.clientY - lp.y) > 10) cancel(); }, { passive: true });
    ['pointerup', 'pointercancel', 'scroll'].forEach(ev => document.addEventListener(ev, cancel, { passive: true, capture: true }));
    document.addEventListener('click', e => { if (lp.fired && !e.target.closest('.wmenu-backdrop')) { e.preventDefault(); e.stopPropagation(); lp.fired = false; } }, true);
    document.addEventListener('contextmenu', e => { const t = e.target.closest && e.target.closest('[data-w]'); if (t) { e.preventDefault(); if (!document.querySelector('.wmenu-backdrop')) openWordMenu(t.dataset.w, e.clientX, e.clientY); } });
    document.addEventListener('selectstart', e => { if (e.target.closest && e.target.closest('[data-w]')) e.preventDefault(); });
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
  async function boot() {
    S = load();
    FX.init(() => S.settings);
    initLongPress();
    try { C = await (await fetch('content.json')).json(); }
    catch (e) { app.innerHTML = '<main class="card"><p>Could not load lessons. Open once with internet to install them.</p></main>'; return; }
    buildIndex(); migratePath(); applyStartParked();
    if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
    renderHome();
  }
  window.__app = { version: APP_VERSION, get state() { return S; }, get ex() { return run && run.ex; }, get entry() { return run && run.queue[run.i]; }, get run() { return run; }, get story() { return story; },
    makeExercise: e => makeExercise(e), get content() { return C; }, importBackup: (t) => importBackup(t, true), openStone: (u, i) => openStone(u, i), testQueue: u => testQueue(C.units[IDX.unitIdx[u]]), practiceQueue: u => practiceQueue(C.units[IDX.unitIdx[u]]), dueIds: () => dueIds(Date.now()), currentPos: () => currentPos(),
    tick: () => tick(), todayMinutes: () => Daily.minutesOn(S.daily, todayKey()), streakNow: () => Daily.current(S.streak, todayKey()) };
  boot();
})();
