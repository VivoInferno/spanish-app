(() => {
  'use strict';
  const KEY = 'spanish-app-state-v1';
  const DAY = SRS.DAY;
  const app = document.getElementById('app');
  let C, S, IDX;

  // ---------- state ----------
  const defaults = () => ({ v: 1, placementDone: false, created: Date.now(), items: {}, pstats: {}, recent: {},
    settings: { newPerSession: 5, rate: 0.9, autoAdvance: false, sound: true, anim: true }, sessions: 0 });
  function load() {
    try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.v) { const d = defaults(); return Object.assign(d, s, { settings: Object.assign(d.settings, s.settings) }); } } catch (e) { /* fresh */ }
    return defaults();
  }
  const save = () => localStorage.setItem(KEY, JSON.stringify(S));
  async function persist() { try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (e) { /* ignore */ } }

  // ---------- helpers ----------
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const endOfToday = () => { const d = new Date(); d.setHours(23, 59, 59, 999); return d.getTime(); };
  const wid = id => 'w:' + id, pid = id => 'p:' + id;

  function buildIndex() {
    IDX = { words: {}, wordOrder: [], patterns: C.patterns, sentByWord: {}, sentences: [] };
    C.units.forEach((u, ui) => {
      u.words.forEach(w => { IDX.words[w.id] = Object.assign({ unit: u.id, unitIdx: ui }, w); IDX.wordOrder.push(w.id); });
      u.sentences.forEach(s => { s.unit = u.id; IDX.sentences.push(s); (IDX.sentByWord[s.k] = IDX.sentByWord[s.k] || []).push(s); });
    });
  }

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
  function dueIds(now) {
    const eod = endOfToday();
    return Object.keys(S.items).filter(id => S.items[id].due <= eod && validId(id))
      .sort((a, b) => SRS.currentR(S.items[a], now) - SRS.currentR(S.items[b], now));
  }
  const validId = id => id.startsWith('w:') ? !!IDX.words[id.slice(2)] : !!IDX.patterns[id.slice(2)];
  function nextNewWords(n) {
    for (const u of C.units) {
      const fresh = u.words.filter(w => !S.items[wid(w.id)]);
      if (fresh.length) return fresh.slice(0, n).map(w => w.id);
    }
    return [];
  }
  function nextNewPatterns(n, introducingUnitIds) {
    const out = [];
    for (const u of C.units) {
      const started = u.words.some(w => S.items[wid(w.id)]) || introducingUnitIds.includes(u.id) || u.words.every(w => S.items[wid(w.id)]);
      if (!started) break;
      for (const p of u.focus) if (!S.items[pid(p)] && out.length < n) out.push(p);
    }
    return out;
  }
  // pick a fresh item from a pattern family, avoiding recently seen ones
  function patternItem(p) {
    const items = IDX.patterns[p].items; const rec = S.recent[p] = S.recent[p] || [];
    let pool = items.map((_, i) => i).filter(i => !rec.includes(i)); if (!pool.length) { rec.length = 0; pool = items.map((_, i) => i); }
    const i = pick(pool); rec.push(i); while (rec.length > Math.max(1, items.length - 2)) rec.shift();
    return i;
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
    if (!type) {
      const s = card ? card.s : 0;
      type = s < 3 ? pick(['es2en', 'cloze', 'listen']) : s < 15 ? pick(['en2es', 'cloze', 'listen', 'es2en']) : pick(['en2es', 'listen', 'cloze']);
    }
    if ((type === 'cloze' || type === 'listenS') && !sents.length) type = 'en2es';
    const sent = sents.length ? pick(sents) : null;
    const esAns = [w.es].concat(w.esAlt || []);
    switch (type) {
      case 'es2en': return { kind: 'type', label: 'Translate to English', big: w.es, speakNow: w.es, answers: w.accept, opts: { lang: 'en', typo: true }, placeholder: 'English', reveal: { es: w.es, en: w.en, note: w.note, ex: sent } };
      case 'en2es': return { kind: 'type', label: 'Translate to Spanish', big: w.en, answers: esAns, opts: { lang: 'es', typo: w.es.length >= 8 }, placeholder: 'Español', reveal: { es: w.es, en: w.en, note: w.note, ex: sent }, speakAfter: w.es };
      case 'cloze': {
        const blank = sent.es.replace(sent.f, '_____');
        return { kind: 'type', label: 'Fill in the missing word', clozeEs: blank, sub: sent.en + (sent.h ? ` · (${sent.h})` : ` · (${w.en})`), answers: [sent.f], opts: { lang: 'es' }, placeholder: 'Español', reveal: { es: sent.es, en: sent.en, note: w.note }, speakAfter: sent.es };
      }
      default: { // listening: early = word, later = whole sentence dictation
        const useSentence = sent && (card && card.s >= 3 || type === 'listenS');
        const text = useSentence ? sent.es : w.es;
        return { kind: 'type', label: useSentence ? 'Listen and type the sentence' : 'Listen and type the word', listen: text, answers: [text], opts: { lang: 'es', sentence: useSentence, typo: !useSentence && w.es.length >= 8 }, placeholder: 'Escribe lo que oyes', reveal: useSentence ? { es: sent.es, en: sent.en } : { es: w.es, en: w.en, note: w.note } };
      }
    }
  }

  // ---------- runner (placement + daily session share this) ----------
  let run = null;
  function startRun(queue, mode) { run = { queue, i: 0, mode, results: [], firstDone: {} }; nextCard(); }
  function nextCard() {
    if (run.i >= run.queue.length) return run.mode === 'placement' ? finishPlacement() : finishSession();
    const entry = run.queue[run.i];
    if (entry.intro) return renderIntro(entry);
    run.ex = makeExercise(entry); run.answered = false;
    renderExercise(entry, run.ex);
  }
  function progressBar() { const pct = run.barPct || 0; return `<div class="topbar"><button class="icon" id="quit" aria-label="Close">✕</button><div class="bar"><span style="width:${pct}%"></span></div><span class="count">${run.i + 1}/${run.queue.length}</span></div>`; }
  function setBar(frac) {
    const pct = Math.max(0, Math.min(100, 100 * frac)); run.barPct = pct;
    const el = app.querySelector('.bar span'); if (!el) return; void el.offsetWidth; el.style.width = pct + '%';
  }
  function bindQuit() { document.getElementById('quit').onclick = () => { if (run.mode === 'placement' && !confirm('Leave placement? Progress on it will be lost.')) return; speechSynthesis && speechSynthesis.cancel(); run = null; renderHome(); }; }

  function renderIntro(entry) {
    let body;
    if (entry.id.startsWith('w:')) {
      const w = IDX.words[entry.id.slice(2)]; const ex = (IDX.sentByWord[w.id] || [])[0];
      body = `<div class="label">New word · ${esc(C.units[w.unitIdx].title)}</div>
        <div class="big">${esc(w.es)} <button class="icon speak" data-say="${esc(w.es)}">🔊</button></div>
        <div class="en">${esc(w.en)}</div>${w.note ? `<p class="note">${esc(w.note)}</p>` : ''}
        ${ex ? `<div class="example"><div>${esc(ex.es)} <button class="icon speak" data-say="${esc(ex.es)}">🔊</button></div><div class="muted">${esc(ex.en)}</div></div>` : ''}
        <div class="row"><button class="btn secondary" id="known">I already know this</button></div>`;
    } else {
      const p = IDX.patterns[entry.id.slice(2)];
      body = `<div class="label">New grammar pattern</div><div class="title">${esc(p.name)}</div><p>${esc(p.explain)}</p>`;
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
    else if (ex.listen) prompt = `<div class="listen"><button class="btn play" id="play">🔊 Play</button><button class="btn secondary" id="slow">🐢 Slow</button></div>`;
    else if (ex.clozeEs) prompt = `<div class="prompt">${esc(ex.clozeEs).replace('_____', '<span class="blank">_____</span>')}</div><div class="muted sub">${esc(ex.sub)}</div>`;
    else prompt = `<div class="big">${esc(ex.big)}${ex.speakNow ? ` <button class="icon speak" data-say="${esc(ex.speakNow)}">🔊</button>` : ''}</div>`;
    const input = ex.kind === 'mc'
      ? `<div class="options">${ex.options.map((o, k) => `<button class="opt" data-k="${k}">${esc(o)}</button>`).join('')}</div>`
      : `<form id="f" autocomplete="off"><input id="ans" type="text" lang="${ex.opts.lang}" placeholder="${esc(ex.placeholder)}" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="done"></form>`;
    app.innerHTML = progressBar() + `<main class="card"><div class="label">${esc(ex.label)}</div>${prompt}${input}<div id="fb"></div></main>
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
    } else {
      const inp = document.getElementById('ans'); setTimeout(() => inp.focus(), 50);
      document.getElementById('f').onsubmit = e => { e.preventDefault(); if (run.answered) return advance(); doCheck(); };
      document.getElementById('check').onclick = () => run.answered ? advance() : doCheck();
      document.getElementById('skip').onclick = () => { if (!run.answered) answer(entry, ex, 'wrong', ''); };
      function doCheck() { const v = inp.value; if (!v.trim()) return; const r = Check.check(v, ex.answers, ex.opts); ex.matched = r.answer; answer(entry, ex, r.result, v); }
    }
  }

  function answer(entry, ex, result, given) {
    run.answered = true;
    const ok = result !== 'wrong';
    const g = result === 'exact' ? 3 : ok ? 2 : 1;
    const isPattern = entry.id.startsWith('p:');
    const graded = run.mode === 'session' && !entry.practice && !run.firstDone[entry.id];
    if (run.mode === 'placement') run.results.push({ id: entry.id, ok });
    else {
      if (graded) { run.firstDone[entry.id] = true; run.prev = S.items[entry.id] ? Object.assign({}, S.items[entry.id]) : undefined; grade(entry.id, g); }
      if (isPattern) pstat(entry.id.slice(2), ok);
      if (!ok && run.mode === 'session') requeueAfterMiss(entry);
      save();
    }
    const fb = document.getElementById('fb');
    const correctForm = ex.kind === 'mc' ? ex.answer : (ex.matched || ex.answers[0]);
    let head = result === 'exact' ? '<div class="ok">✓ Correct</div>'
      : result === 'accent' ? `<div class="ok warn">✓ Watch the accents: <b>${esc(correctForm)}</b></div>`
      : result === 'typo' ? `<div class="ok warn">✓ Close — check spelling: <b>${esc(correctForm)}</b></div>`
      : `<div class="bad">✗ ${ex.kind === 'mc' ? 'Answer' : 'Correct answer'}: <b>${esc(correctForm)}</b></div>`;
    const rv = ex.reveal || {};
    let more = '';
    if (rv.es && rv.es !== correctForm) more += `<div class="rv-es">${esc(rv.es)} <button class="icon speak" data-say="${esc(ex.speakAfter || rv.es)}">🔊</button></div>`;
    else if (ex.speakAfter || rv.es) more += `<div><button class="icon speak" data-say="${esc(ex.speakAfter || rv.es)}">🔊</button></div>`;
    if (rv.en) more += `<div class="muted">${esc(rv.en)}</div>`;
    if (rv.note && (!ok || isPattern)) more += `<p class="note">${esc(rv.note)}</p>`;
    if (rv.ex && !ok) more += `<div class="example"><div>${esc(rv.ex.es)}</div><div class="muted">${esc(rv.ex.en)}</div></div>`;
    fb.innerHTML = `<div class="feedback ${ok ? 'good' : 'miss'}">${head}${more}</div>`;
    bindSpeak();
    const inp = document.getElementById('ans'); if (inp) inp.readOnly = true;
    setBar((run.i + 1) / run.queue.length);
    const chosen = ex.kind === 'mc' ? app.querySelector(ok ? '.opt.right' : '.opt.wrong') : inp;
    const fbBox = fb.querySelector('.feedback');
    if (ok) FX.correct([chosen, fbBox]); else FX.miss([chosen]);
    const footer = app.querySelector('footer');
    const extra = [];
    if (!ok && ex.kind === 'type' && given && run.mode === 'session') extra.push('<button class="btn secondary" id="override">I was right</button>');
    if (ok && run.mode === 'session' && !entry.practice) extra.push('<button class="btn secondary" id="easy">Too easy · hide for months</button>');
    footer.innerHTML = extra.join('') + '<button class="btn primary" id="next">Continue</button>';
    document.getElementById('next').onclick = advance;
    const ov = document.getElementById('override');
    if (ov) ov.onclick = () => { // undo the miss
      if (graded) { if (run.prev) S.items[entry.id] = run.prev; else delete S.items[entry.id]; grade(entry.id, 3); }
      run.queue = run.queue.filter((e, k) => k <= run.i || !(e.id === entry.id && e.fromMiss)); save(); advance();
    };
    const ez = document.getElementById('easy');
    if (ez) ez.onclick = () => { S.items[entry.id] = SRS.markKnown(S.items[entry.id], Date.now(), 120); save(); advance(); };
    if (ok && result === 'exact' && S.settings.autoAdvance && run.mode === 'session') run.timer = setTimeout(advance, 900);
    else setTimeout(() => document.getElementById('next') && document.getElementById('next').focus(), 30);
  }
  function advance() { clearTimeout(run && run.timer); if (!run) return; run.i++; nextCard(); }

  function requeueAfterMiss(entry) {
    const q = run.queue, at = run.i;
    if (entry.id.startsWith('p:')) {
      // a missed grammar pattern: two fresh sentences from the same family later in this session
      const extra = q.filter((e, k) => k > at && e.id === entry.id && e.fromMiss).length;
      if (extra >= 2) return;
      q.splice(Math.min(q.length, at + 3), 0, { id: entry.id, practice: true, fromMiss: true });
      q.splice(Math.min(q.length, at + 7), 0, { id: entry.id, practice: true, fromMiss: true });
    } else {
      if (q.some((e, k) => k > at && e.id === entry.id && e.fromMiss)) return;
      const ex = entry.ex === 'en2es' ? 'es2en' : 'en2es';
      q.splice(Math.min(q.length, at + 4), 0, { id: entry.id, practice: true, fromMiss: true, ex });
    }
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
      <p>${placementQueue().length} quick items, about 5 minutes. Grammar you already handle and words you know get pushed far out so they rarely come back. What you miss becomes today's review.</p>
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
        const p = id.slice(2);
        oks.forEach(ok => pstat(p, ok));
        S.recent[p] = [0, 1];
        if (right === oks.length) { S.items[id] = SRS.markKnown(null, now, 45); summary.strong.push(p); }
        else if (right > 0) { S.items[id] = SRS.review(SRS.newCard(), 2, now); S.items[id].due = now; summary.partial.push(p); }
        else { S.items[id] = SRS.review(SRS.newCard(), 1, now); S.items[id].due = now; summary.weak.push(p); }
      } else {
        if (right) { S.items[id] = SRS.markKnown(null, now, 60); summary.knownWords.push(id.slice(2)); }
        else summary.newWords.push(id.slice(2));
      }
    });
    S.placementDone = true; S.placementSummary = summary; save();
    const li = arr => arr.map(p => `<li>${esc(IDX.patterns[p].name)}</li>`).join('') || '<li class="muted">—</li>';
    app.innerHTML = `<main class="card"><h1>Placement results</h1>
      <h3>Needs work (due today)</h3><ul>${li(summary.weak)}</ul>
      <h3>Shaky (due today)</h3><ul>${li(summary.partial)}</ul>
      <h3>Solid (pushed out ~6 weeks)</h3><ul>${li(summary.strong)}</ul>
      <p class="muted">Words already known: ${summary.knownWords.length} of ${C.placement.words.length} tested. Those are skipped when their unit comes up.</p></main>
      <footer><button class="btn primary" id="go">Start today's session</button></footer>`;
    run = null;
    document.getElementById('go').onclick = startSession;
  }

  // ---------- daily session ----------
  function buildSession() {
    const now = Date.now();
    const due = dueIds(now).slice(0, 60);
    const q = due.map(id => ({ id }));
    if (due.length < 40) {
      const nw = nextNewWords(S.settings.newPerSession);
      const units = [...new Set(nw.map(w => IDX.words[w].unit))];
      const np = nextNewPatterns(2, units);
      nw.forEach(w => { q.push({ id: wid(w), intro: true }); q.push({ id: wid(w), ex: 'es2en' }); });
      np.forEach(p => { q.push({ id: pid(p), intro: true }); q.push({ id: pid(p) }); });
      // recycle today's new words once more at the end, the other direction
      shuffle(nw).forEach(w => q.push({ id: wid(w), ex: pick(['en2es', 'cloze']), practice: true }));
    }
    return q;
  }
  function startSession() { persist(); const q = buildSession(); if (!q.length) return renderHome('Nothing due right now. Come back later.'); startRun(q, 'session'); }
  function finishSession() {
    S.sessions = (S.sessions || 0) + 1; S.lastSession = Date.now(); save();
    setTimeout(() => FX.complete(), 0);
    const tomorrow = endOfToday() + DAY;
    const dueTomorrow = Object.values(S.items).filter(c => c.due <= tomorrow).length;
    run = null;
    app.innerHTML = `<main class="card"><h1>Done for now</h1><p>Due by end of tomorrow: <b>${dueTomorrow}</b>.</p></main>
      <footer><button class="btn secondary" id="prog">Progress</button><button class="btn primary" id="home">Home</button></footer>`;
    document.getElementById('home').onclick = () => renderHome();
    document.getElementById('prog').onclick = renderProgress;
  }

  // ---------- home / progress / settings ----------
  function stats() {
    const now = Date.now(), ids = Object.keys(S.items).filter(validId);
    const words = ids.filter(i => i.startsWith('w:')), pats = ids.filter(i => i.startsWith('p:'));
    const mastered = ids.filter(i => S.items[i].s >= 21).length;
    const due = dueIds(now).length;
    const newLeft = IDX.wordOrder.filter(w => !S.items[wid(w)]).length;
    const weak = Object.keys(C.patterns).map(p => {
      const c = S.items[pid(p)], st = S.pstats[p] || { seen: 0, correct: 0 };
      const acc = st.seen ? st.correct / st.seen : null;
      const r = c ? SRS.currentR(c, now) : 0;
      return { p, acc, seen: st.seen, lapses: c ? c.lapses : 0, s: c ? c.s : 0, r, introduced: !!c };
    }).filter(x => x.introduced && (x.s < 21 || (x.acc != null && x.acc < 0.8))).sort((a, b) => (a.acc ?? 1) - (b.acc ?? 1) || a.s - b.s);
    return { words: words.length, patterns: pats.length, mastered, due, newLeft, weak };
  }
  function renderHome(msg) {
    if (!S.placementDone) return renderPlacementIntro();
    const st = stats();
    const q = buildSession();
    const nNew = q.filter(e => e.intro && e.id.startsWith('w:')).length;
    app.innerHTML = `<main class="card home"><h1>Español</h1>
      ${msg ? `<p class="muted">${esc(msg)}</p>` : ''}
      <div class="today"><div><b>${st.due}</b><span>due</span></div><div><b>${nNew}</b><span>new words</span></div><div><b>${st.weak.length}</b><span>weak patterns</span></div></div>
      ${st.weak.length ? `<p class="muted">Focus: ${st.weak.slice(0, 3).map(w => esc(IDX.patterns[w.p].name)).join(' · ')}</p>` : ''}
      </main>
      <footer><button class="btn secondary" id="prog">Progress</button><button class="btn primary" id="go" ${q.length ? '' : 'disabled'}>${q.length ? 'Start session' : 'All caught up'}</button></footer>`;
    document.getElementById('go').onclick = startSession;
    document.getElementById('prog').onclick = renderProgress;
  }
  function fmtDue(c) { const d = Math.round((c.due - Date.now()) / DAY); return d <= 0 ? 'due' : d === 1 ? '1 day' : d < 60 ? d + ' days' : Math.round(d / 30) + ' mo'; }
  function renderProgress() {
    const st = stats();
    const units = C.units.map(u => {
      const learned = u.words.filter(w => S.items[wid(w.id)]).length;
      return `<li><span>${esc(u.title)} <span class="muted">· ${esc(u.titleEn)}</span></span><span>${learned}/${u.words.length}</span></li>`;
    }).join('');
    const patterns = Object.keys(C.patterns).map(p => {
      const c = S.items[pid(p)], ps = S.pstats[p];
      return `<li><span>${esc(C.patterns[p].name)}</span><span class="muted">${c ? (ps && ps.seen ? Math.round(100 * ps.correct / ps.seen) + '% · ' : '') + fmtDue(c) : 'not started'}</span></li>`;
    }).join('');
    const weak = st.weak.map(w => `<li><span>${esc(C.patterns[w.p].name)}</span><span class="muted">${w.acc != null ? Math.round(w.acc * 100) + '%' : ''}</span></li>`).join('') || '<li class="muted">None right now</li>';
    app.innerHTML = `<div class="topbar"><button class="icon" id="back" aria-label="Back">←</button><div class="title">Progress</div></div>
      <main class="card">
      <div class="today"><div><b>${st.words}</b><span>words learned</span></div><div><b>${st.mastered}</b><span>long-term</span></div><div><b>${st.due}</b><span>due today</span></div></div>
      <h3>Weak patterns</h3><ul class="list">${weak}</ul>
      <h3>Units</h3><ul class="list">${units}</ul>
      <h3>Grammar patterns</h3><ul class="list">${patterns}</ul>
      <h3>Settings</h3>
      <label class="set">New words per session <select id="npw">${[3, 4, 5, 6, 8].map(n => `<option ${n === S.settings.newPerSession ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label class="set">Speech speed <input id="rate" type="range" min="0.6" max="1.2" step="0.05" value="${S.settings.rate}"></label>
      <label class="set">Sound effects <input id="snd" type="checkbox" ${S.settings.sound !== false ? 'checked' : ''}></label>
      <label class="set">Animations <input id="anim" type="checkbox" ${S.settings.anim !== false ? 'checked' : ''}></label>
      <label class="set">Auto-continue on correct <input id="auto" type="checkbox" ${S.settings.autoAdvance ? 'checked' : ''}></label>
      <p class="muted">Voice: ${voice ? esc(voice.name + ' (' + voice.lang + ')') : 'default Spanish'} <button class="icon speak" data-say="¿Me lo puedes mandar mañana?">🔊</button></p>
      <h3>Backup</h3>
      <div class="row wrap"><button class="btn secondary" id="exp">Export progress</button><button class="btn secondary" id="copy">Copy to clipboard</button><label class="btn secondary">Import file<input id="imp" type="file" accept="application/json,.json" hidden></label></div>
      <textarea id="paste" placeholder="…or paste a backup here and tap Import pasted" rows="2"></textarea>
      <div class="row wrap"><button class="btn secondary" id="impPaste">Import pasted</button><button class="btn secondary" id="replace">Retake placement</button><button class="btn danger" id="reset">Reset everything</button></div>
      <p class="muted small">Content v${C.version} · ${IDX.wordOrder.length} words · ${Object.keys(C.patterns).length} patterns · ${st.newLeft} words not started</p>
      </main>`;
    bindSpeak();
    document.getElementById('back').onclick = () => renderHome();
    document.getElementById('npw').onchange = e => { S.settings.newPerSession = +e.target.value; save(); };
    document.getElementById('rate').onchange = e => { S.settings.rate = +e.target.value; save(); speak('Así suena ahora.'); };
    document.getElementById('snd').onchange = e => { S.settings.sound = e.target.checked; save(); if (e.target.checked) FX.sounds.correct(); };
    document.getElementById('anim').onchange = e => { S.settings.anim = e.target.checked; save(); FX.applyClasses(); };
    document.getElementById('auto').onchange = e => { S.settings.autoAdvance = e.target.checked; save(); };
    const json = () => JSON.stringify(Object.assign({ exportedAt: new Date().toISOString(), app: 'spanish-app' }, S), null, 1);
    document.getElementById('exp').onclick = () => {
      const blob = new Blob([json()], { type: 'application/json' }); const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'spanish-progress-' + new Date().toISOString().slice(0, 10) + '.json'; document.body.appendChild(a); a.click(); a.remove();
    };
    document.getElementById('copy').onclick = async () => { try { await navigator.clipboard.writeText(json()); alert('Backup copied. Paste it into Notes or email it to yourself.'); } catch (e) { document.getElementById('paste').value = json(); alert('Copy blocked — the backup is in the box below; select all and copy.'); } };
    const doImport = txt => { try { const d = JSON.parse(txt); if (!d || !d.v || !d.items) throw new Error('not a backup'); if (!confirm('Replace current progress with this backup?')) return; delete d.exportedAt; delete d.app; S = Object.assign(defaults(), d, { settings: Object.assign(defaults().settings, d.settings) }); save(); FX.applyClasses(); renderProgress(); alert('Imported.'); } catch (e) { alert('Could not import: ' + e.message); } };
    document.getElementById('imp').onchange = e => { const f = e.target.files[0]; if (f) f.text().then(doImport); };
    document.getElementById('impPaste').onclick = () => doImport(document.getElementById('paste').value);
    document.getElementById('replace').onclick = () => { if (confirm('Retake placement? Your learned words are kept; grammar patterns get re-rated.')) { S.placementDone = false; save(); renderHome(); } };
    document.getElementById('reset').onclick = () => { if (confirm('Erase all progress on this phone? Export first if you want a backup.')) { S = defaults(); save(); renderHome(); } };
  }
  function bindSpeak() { app.querySelectorAll('.speak').forEach(b => b.onclick = e => { e.preventDefault(); speak(b.dataset.say); }); }

  // ---------- boot ----------
  async function boot() {
    S = load();
    FX.init(() => S.settings);
    try { C = await (await fetch('content.json')).json(); }
    catch (e) { app.innerHTML = '<main class="card"><p>Could not load lessons. Open once with internet to install them.</p></main>'; return; }
    buildIndex();
    if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
    renderHome();
  }
  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW failed', e)));
  // expose a tiny hook for automated tests
  window.__app = { get state() { return S; }, get ex() { return run && run.ex; }, get entry() { return run && run.queue[run.i]; }, buildSession: () => buildSession(), makeExercise: e => makeExercise(e), get content() { return C; } };
  boot();
})();
