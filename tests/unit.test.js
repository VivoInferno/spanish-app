process.env.TZ = 'America/Mexico_City'; // the app uses device-local days; Colby's phone is on Mexico City time
const assert = require('assert');
const Check = require('../check.js'), SRS = require('../srs.js');
const C = require('../content.json');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok -', name); };

t('exact Spanish', () => assert.equal(Check.check('se los enviaré', ['se los enviaré']).result, 'exact'));
t('missing accent is accepted but flagged', () => { const r = Check.check('se los enviare', ['se los enviaré']); assert.equal(r.result, 'accent'); assert.equal(r.answer, 'se los enviaré'); });
t('ñ without tilde flagged', () => assert.equal(Check.check('manana', ['mañana']).result, 'accent'));
t('article optional ES', () => assert.equal(Check.check('tramite', ['el trámite']).result, 'accent'));
t('article optional ES exact', () => assert.equal(Check.check('trámite', ['el trámite']).result, 'exact'));
t('"to" optional EN', () => assert.equal(Check.check('approve', ['to approve'], { lang: 'en' }).result, 'exact'));
t('EN synonyms', () => assert.equal(Check.check('Out of order', ['broken', 'out of order'], { lang: 'en', typo: true }).result, 'exact'));
t('apostrophe-insensitive', () => assert.equal(Check.check('doctors office', ["doctor's office"], { lang: 'en' }).result, 'exact'));
t('EN typo tolerated', () => assert.equal(Check.check('prescripton', ['prescription'], { lang: 'en', typo: true }).result, 'typo'));
t('cloze: wrong verb form rejected (no typo tolerance)', () => assert.equal(Check.check('aprueban', ['aprueben'], { lang: 'es' }).result, 'wrong'));
t('wrong answer', () => assert.equal(Check.check('plomo', ['el plomero'], { lang: 'es' }).result, 'wrong'));
t('sentence dictation punctuation/case-insensitive', () => assert.equal(Check.check('el vuelo tiene una escala en monterrey', ['El vuelo tiene una escala en Monterrey.'], { sentence: true }).result, 'exact'));
t('sentence dictation small typo', () => assert.equal(Check.check('El vuelo tiene una escla en Monterrey', ['El vuelo tiene una escala en Monterrey.'], { sentence: true }).result, 'typo'));
t('empty is wrong', () => assert.equal(Check.check('  ', ['x']).result, 'wrong'));

const DAY = SRS.DAY; let now = Date.UTC(2026, 10, 11, 15);
t('new card Good → a few days', () => { const c = SRS.review(SRS.newCard(), 3, now); assert.ok(c.due - now >= 3 * DAY && c.due - now <= 5 * DAY, (c.due - now) / DAY); });
t('repeated correct answers push intervals out fast', () => {
  let c = SRS.newCard(), t0 = now, ivls = [];
  for (let i = 0; i < 6; i++) { c = SRS.review(c, 3, t0); const ivl = Math.round((c.due - t0) / DAY); ivls.push(ivl); t0 = c.due; }
  for (let i = 1; i < ivls.length; i++) assert.ok(ivls[i] > ivls[i - 1], ivls.join(','));
  assert.ok(ivls[5] > 120, 'after 6 correct reviews interval should be months: ' + ivls.join(','));
  console.log('   intervals (days) for 6 straight correct:', ivls.join(', '));
});
t('a miss brings it back within a day and shrinks stability', () => {
  let c = SRS.review(SRS.newCard(), 3, now); c = SRS.review(c, 3, c.due); const s0 = c.s, t1 = c.due;
  c = SRS.review(c, 1, t1); assert.ok(c.s < s0); assert.ok(c.due - t1 <= DAY); assert.equal(c.lapses, 1);
});
t('Hard < Good < Easy', () => {
  const base = SRS.review(SRS.newCard(), 3, now), at = base.due;
  const h = SRS.review(base, 2, at), g = SRS.review(base, 3, at), e = SRS.review(base, 4, at);
  assert.ok(h.s < g.s && g.s < e.s);
});
t('markKnown pushes ~months out', () => { const c = SRS.markKnown(null, now, 120); assert.ok(c.due - now >= 100 * DAY); });

// content integrity
t('every pattern item has one blank and 2+ unique options', () => {
  for (const [id, p] of Object.entries(C.patterns)) for (const it of p.items) {
    assert.equal(it.q.split('___').length, 2, id + ': ' + it.q);
    assert.ok(it.o.length >= 2 && new Set(it.o).size === it.o.length, id + ': ' + it.q);
    assert.ok(it.en && it.n, id);
  }
});
t('each unit has 4–5 words, a focus pattern, and cloze forms present in sentences', () => {
  const ids = new Set();
  for (const u of C.units) {
    assert.ok(u.words.length >= 4 && u.words.length <= 5, u.id);
    u.focus.forEach(f => assert.ok(C.patterns[f], f));
    u.words.forEach(w => { assert.ok(!ids.has(w.id)); ids.add(w.id); assert.ok(w.accept.length); });
    for (const s of u.sentences) { assert.ok(s.es.includes(s.f), s.es + ' missing ' + s.f); assert.ok(ids.has(s.k), s.k); }
    u.words.forEach(w => assert.ok(u.sentences.some(s => s.k === w.id), 'no sentence for ' + w.id));
  }
  C.placement.words.forEach(w => assert.ok(ids.has(w)));
});
const PATH = C.sections.find(s => s.units).units.map(id => C.units.find(u => u.id === id));
t('later units (in path order) recycle earlier words in sentences and stories', () => {
  const stems = u => u.words.map(w => w.es.replace(/^(el|la|los|las) /, '').toLowerCase()).map(w => w.length > 5 ? w.slice(0, -1) : w);
  for (let i = 1; i < PATH.length; i++) {
    const earlier = PATH.slice(0, i).flatMap(stems), u = PATH[i];
    const hits = u.sentences.filter(s => earlier.some(w => s.es.toLowerCase().includes(w)));
    assert.ok(hits.length >= 1, u.id + ' sentences recycle nothing');
    const storyHits = u.story.lines.filter(l => earlier.some(w => l.es.toLowerCase().includes(w)));
    if (!/^u[1-9]$/.test(u.id)) assert.ok(storyHits.length >= 1, u.id + ' story recycles nothing'); // v6 stories must; v1-v4 stories predate the rule
  }
});
t('APP_VERSION matches sw.js CACHE', () => {
  const fs = require('fs'), path = require('path');
  const v = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8').match(/APP_VERSION = '(v\d+)'/)[1];
  const c = fs.readFileSync(path.join(__dirname, '../sw.js'), 'utf8').match(/CACHE = 'espanol-(v\d+)'/)[1];
  assert.equal(v, c); console.log('   version', v);
});
t('v4 content: sections, ≥8 units with stories, valid story questions', () => {
  const units = new Set(C.units.map(u => u.id));
  const sec = C.sections.find(s => s.units); assert.ok(sec && sec.units.length >= 8);
  sec.units.forEach(u => assert.ok(units.has(u)));
  for (const u of C.units) {
    assert.ok(u.story && u.story.lines.length >= 8, u.id + ' story');
    for (const q of u.story.qs) {
      assert.ok(q.after >= 0 && q.after < u.story.lines.length, u.id + ' q.after');
      assert.ok(new Set(q.o).size === q.o.length && q.o.length >= 2, u.id + ' options');
      if (q.k) assert.ok(u.words.some(w => w.id === q.k) || C.units.some(x => x.words.some(w => w.id === q.k)), q.k);
      if (q.p) assert.ok(C.patterns[q.p], q.p);
    }
    const words = u.words.map(w => w.es.replace(/^(el|la) /, '').split(' ')[0].slice(0, 5).toLowerCase());
    const text = u.story.lines.map(l => l.es.toLowerCase()).join(' ');
    const used = words.filter(w => text.includes(w)).length;
    assert.ok(used >= 3, `${u.id} story uses ${used} of its words`);
  }
  for (const [id, p] of Object.entries(C.patterns)) assert.ok(p.items.length >= 6, id);
});

// ---- v5: daily minutes + streak (daily.js)
const Daily = require('../daily.js');
const L = (y, m, d, h = 0, mi = 0, sec = 0) => new Date(y, m - 1, d, h, mi, sec).getTime(); // local (Mexico City) time
t('dayKey uses local calendar day (11:30 pm CST is still Nov 11)', () => {
  assert.equal(Daily.dayKey(L(2026, 11, 11, 23, 30)), '2026-11-11');
  assert.equal(Daily.dayKey(Date.UTC(2026, 10, 12, 5, 30)), '2026-11-11'); // 05:30 UTC = 23:30 UTC-6
  assert.equal(Daily.dayKey(Date.UTC(2026, 10, 12, 6, 0)), '2026-11-12');
});
t('minutes accumulate while active and stop 60 s after the last input', () => {
  const d = {}; const t0 = L(2026, 11, 11, 9);
  let added = Daily.accrue(d, t0, t0 + 5 * 60000, t0 + 5 * 60000); // 5 min of steady input
  assert.equal(added, 5 * 60000); assert.equal(Daily.minutesOn(d, '2026-11-11'), 5);
  added = Daily.accrue(d, t0 + 5 * 60000, t0 + 15 * 60000, t0 + 5 * 60000); // 10 min with no input: only 60 s counts
  assert.equal(added, 60000); assert.equal(Daily.minutesOn(d, '2026-11-11'), 6);
  assert.equal(Daily.accrue(d, t0 + 15 * 60000, t0 + 16 * 60000, t0 + 5 * 60000), 0, 'still idle → nothing');
});
t('a session that runs over local midnight is split between the two days', () => {
  const d = {}; const a = L(2026, 11, 11, 23, 55), b = L(2026, 11, 12, 0, 7);
  for (let x = a; x < b; x += 1000) Daily.accrue(d, x, x + 1000, x + 1000);
  assert.equal(Daily.minutesOn(d, '2026-11-11'), 5); assert.equal(Daily.minutesOn(d, '2026-11-12'), 7);
  assert.equal(Daily.minutesOn(d, '2026-11-13'), 0, 'next day starts at 0');
});
t('streak seed: 1090 with Nov 11 2026 already counted', () => {
  const s = Daily.seed(); assert.equal(s.count, 1090); assert.equal(s.lastDay, '2026-11-11');
  assert.deepEqual(Daily.current(s, '2026-11-11'), { count: 1090, doneToday: true });
  assert.equal(Daily.complete(s, '2026-11-11').count, 1090, 'a second lesson the same day does not add');
});
t('streak continues on consecutive days and survives a pending day', () => {
  let s = Daily.seed();
  assert.deepEqual(Daily.current(s, '2026-11-12'), { count: 1090, doneToday: false }, 'next day before practice: still 1090, flame unlit');
  s = Daily.complete(s, '2026-11-12'); assert.equal(s.count, 1091);
  s = Daily.complete(s, '2026-11-13'); assert.equal(s.count, 1092);
  s = Daily.complete(s, '2026-12-01'); assert.equal(s.count, 1, 'gap → restart at 1');
  s = Daily.complete(Daily.complete({ count: 5, lastDay: '2026-12-31' }, '2027-01-01'), '2027-01-02'); assert.equal(s.count, 7, 'year boundary');
});
t('streak breaks when a full local day is missed', () => {
  const s = { count: 1092, lastDay: '2026-11-13' };
  assert.equal(Daily.current(s, '2026-11-14').count, 1092);
  const c = Daily.current(s, '2026-11-15'); assert.equal(c.count, 0); assert.ok(c.broken);
  assert.equal(Daily.complete(s, '2026-11-15').count, 1);
});
t('streak across the DST-free Mexico calendar and a US-style DST date stays whole-day', () => {
  assert.equal(Daily.dayDiff('2027-03-13', '2027-03-15'), 2); assert.equal(Daily.dayDiff('2026-11-01', '2026-11-02'), 1);
});
t('Edit streak: today counted only if a lesson was done today', () => {
  let s = Daily.edit(Daily.seed(), 1200, '2026-11-20', false);
  assert.deepEqual(Daily.current(s, '2026-11-20'), { count: 1200, doneToday: false });
  assert.equal(Daily.complete(s, '2026-11-20').count, 1201);
  s = Daily.edit(s, 1200, '2026-11-20', true); assert.deepEqual(Daily.current(s, '2026-11-20'), { count: 1200, doneToday: true });
  assert.equal(Daily.complete(s, '2026-11-20').count, 1200);
  assert.equal(Daily.current(Daily.edit(s, 0, '2026-11-20', true), '2026-11-20').count, 0);
});

// ---- v6: Batch 1 (syllabus units 1-15)
const norm = x => String(x).toLowerCase().normalize('NFC').replace(/[…]|\.\.\./g, ' ').replace(/[¿?¡!.,;:“”"]/g, ' ').replace(/\s+/g, ' ').trim();
t('B1 path has syllabus units 1-15 in order, Tres Aguas at every third stop', () => {
  const titles = ['Trámites y mandados', 'La casa y las reparaciones', 'Primer mensaje por WhatsApp', 'El trabajo', 'De viaje', 'El proyecto en 30 segundos', 'La salud', 'En el mercado', '¿Dónde queda Tres Aguas?', 'El banco', 'La colonia y los vecinos', 'Lotes disponibles', 'El coche y el taller', 'Costumbres en la mesa', 'Cómo es el lote'];
  assert.deepEqual(PATH.map(u => u.title), titles);
  PATH.forEach((u, i) => assert.equal(!!u.ta, (i + 1) % 3 === 0, u.id + ' Tres Aguas flag'));
  assert.equal(new Set(C.units.map(u => u.id)).size, C.units.length);
  ['u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7', 'u8', 'u9'].forEach(id => assert.ok(C.units.some(u => u.id === id), 'existing unit id kept: ' + id));
});
t('every story: 9-12 lines, 4 questions, each answerable from the lines shown before it', () => {
  for (const u of PATH) {
    const st = u.story; assert.ok(st.lines.length >= 9 && st.lines.length <= 12, u.id + ' lines ' + st.lines.length); assert.equal(st.qs.length, 4, u.id);
    for (const q of st.qs) {
      const seen = norm(st.lines.slice(0, q.after + 1).map(l => l.es).join(' '));
      assert.ok(new Set(q.o.map(norm)).size === q.o.length, u.id + ' duplicate options: ' + q.q);
      const m = q.q.match(/“([^”]*___[^”]*)”/);
      if (m) { // grammar gap-fill: the correct option must reproduce a line already shown, the others must not
        const fill = o => norm(m[1].replace('___', o));
        assert.ok(seen.includes(fill(q.o[0])), `${u.id}: “${m[1]}” + ${q.o[0]} not in story`);
        q.o.slice(1).forEach(o => assert.ok(!seen.includes(fill(o)) || fill(q.o[0]).includes(fill(o)), `${u.id}: distractor ${o} also matches`));
        assert.ok((q.p && C.patterns[q.p]) || q.k, u.id + ' gap-fill needs a pattern or word');
      } else if (q.k) { // comprehension: the word it grades must already have appeared (any form)
        const w = C.units.flatMap(x => x.words).find(w => w.id === q.k);
        const forms = [w.es, ...(w.esAlt || [])].map(f => norm(f.replace(/^(el|la|los|las) /, ''))).map(f => f.slice(0, Math.max(4, f.length - 2))); // stem, so solemos counts for soler
        assert.ok(forms.some(f => seen.includes(f)), `${u.id}: “${q.q}” asks about ${q.k} before it appears`);
      }
    }
  }
});
t('no missing audio text: every word, sentence, story line and pattern answer has Spanish to speak', () => {
  for (const u of C.units) {
    u.words.forEach(w => assert.ok(w.es && w.es.trim() && w.en && w.accept.length, u.id + ' ' + w.id));
    u.sentences.forEach(x => assert.ok(x.es.trim() && x.en.trim() && !x.es.includes('___'), u.id + ' sentence'));
    u.story.lines.forEach(l => assert.ok(l.es.trim() && l.en.trim() && !l.es.includes('___'), u.id + ' story line'));
    assert.ok(u.story.title && u.title && u.titleEn, u.id + ' titles');
  }
  for (const [id, p] of Object.entries(C.patterns)) p.items.forEach(it => { const full = it.q.replace('___', it.o[0]); assert.ok(!full.includes('___') && full.trim().length > 3, id); });
});
t('every unit can build its test: 12 vocab + 3 short sentences available', () => {
  for (let i = 0; i < PATH.length; i++) {
    const upTo = PATH.slice(0, i + 1);
    const short = new Set(upTo.flatMap(u => u.sentences.filter(x => x.es.split(' ').length <= 10).map(x => x.k)));
    assert.ok(short.size >= 3, PATH[i].id + ' has only ' + short.size + ' sentence words for tile questions');
    assert.ok(upTo.flatMap(u => u.words).length >= 5, PATH[i].id);
  }
});
t('Tres Aguas content rules: Agua Dulce, no guaranteed returns or plusvalía, no crocodiles', () => {
  const txt = JSON.stringify(PATH.filter(u => u.ta)).toLowerCase();
  assert.ok(txt.includes('agua dulce'));
  ['palmarito', 'cocodril', 'plusval', 'garantiz', 'rendimiento', 'ganancia segura', 'va a subir de precio'].forEach(bad => assert.ok(!txt.includes(bad), 'found ' + bad));
  PATH.filter(u => u.ta).forEach(u => assert.ok(u.note && /practice examples/.test(u.note), u.id + ' illustrative note'));
});
t('new patterns have 8 items, a unit using them, and clitic patterns recur across the batch', () => {
  ['clitic_usted', 'quedar_distancia', 'estar_participio', 'habitual', 'comparatives'].forEach(p => { assert.ok(C.patterns[p] && C.patterns[p].items.length >= 8, p); assert.ok(PATH.some(u => u.focus.includes(p)), p + ' unused'); });
  const clitic = PATH.filter(u => u.focus.some(f => f.startsWith('clitic_'))).length; assert.ok(clitic >= 5, 'clitic units ' + clitic);
  Object.keys(C.patterns).forEach(p => assert.ok(PATH.some(u => u.focus.includes(p)), p + ' not in any unit'));
});
t('startParked list holds word ids', () => {
  assert.ok(Array.isArray(C.startParked) && C.startParked.includes('poesia'));
  const ids = new Set(C.units.flatMap(u => u.words.map(w => w.id)));
  C.startParked.forEach(id => assert.ok(/^[a-z]+$/.test(id), id));
});

// ---- v7: "Can't listen now"
const Listen = require('../listen.js');
t('only listen / listenS are audio-only types', () => {
  assert.deepEqual(['es2en', 'en2es', 'cloze', 'listen', 'listenS', 'build'].filter(Listen.isAudio), ['listen', 'listenS']);
});
t('audio types get a read-only equivalent', () => {
  assert.equal(Listen.substitute('listen', true), 'es2en'); assert.equal(Listen.substitute('listenS', true), 'cloze'); assert.equal(Listen.substitute('listenS', false), 'es2en');
  Listen.AUDIO.forEach(a => assert.ok(!Listen.isAudio(Listen.substitute(a, true)) && !Listen.isAudio(Listen.substitute(a, false))));
});
t('pause lasts 10 minutes and counts down', () => {
  const t0 = Date.UTC(2026, 10, 12, 16), until = Listen.start(t0);
  assert.equal(until - t0, 600000);
  assert.ok(Listen.paused(until, t0) && Listen.paused(until, t0 + 599999) && !Listen.paused(until, t0 + 600000));
  assert.equal(Listen.minutesLeft(until, t0), 10); assert.equal(Listen.minutesLeft(until, t0 + 30000), 10); assert.equal(Listen.minutesLeft(until, t0 + 541000), 1); assert.equal(Listen.minutesLeft(until, t0 + 600000), 0);
  assert.ok(!Listen.paused(0, t0) && !Listen.paused(undefined, t0));
});

// ---- v7: one-letter typo tolerance per word
Check.setKnown(Check.knownFromContent(C));
const R = (typed, ans, o) => Check.check(typed, [].concat(ans), o).result;
t('one substitution passes: cotizacion → cotizaciom', () => assert.equal(R('cotizaciom', 'la cotización'), 'typo'));
t('one deletion passes: mojonera → mojnera', () => assert.equal(R('mojnera', 'mojonera'), 'typo'));
t('one insertion and one adjacent swap pass', () => { assert.equal(R('mercaddo', 'mercado'), 'typo'); assert.equal(R('trámtie', 'el trámite'), 'typo'); assert.equal(R('cotizacoin', 'cotización'), 'typo'); });
t('two typos in one word fail', () => { assert.equal(R('mojnra', 'mojonera'), 'wrong'); assert.equal(R('cotisaciom', 'cotización'), 'wrong'); });
t('3-letter words must be exact', () => { assert.equal(R('lso', 'los'), 'wrong'); assert.equal(R('al', 'el'), 'wrong'); assert.equal(R('mra', 'mar'), 'wrong'); });
t('clitic swaps fail: se los → se las, se lo → se la', () => { assert.equal(R('se las', 'se los'), 'wrong'); assert.equal(R('se la enviaré', 'se lo enviaré'), 'wrong'); });
t('verb-ending changes fail: envió → envíe, aprueben → aprueban, hablan → habla', () => { assert.equal(R('envíe', 'envió'), 'wrong'); assert.equal(R('envie', 'envió'), 'wrong'); assert.equal(R('aprueban', 'aprueben'), 'wrong'); assert.equal(R('habla', 'hablan'), 'wrong'); });
t('gender / number changes fail: interesado → interesada, vendido → vendidos', () => { assert.equal(R('interesada', 'interesado'), 'wrong'); assert.equal(R('vendidos', 'vendido'), 'wrong'); });
t('a typo that makes another real course word fails (quedan → queden is a different form)', () => { assert.equal(R('esta', 'eso'), 'wrong'); assert.equal(R('quedan', 'queden'), 'wrong'); });
t('each word in a multi-word answer gets its own allowance', () => {
  assert.equal(R('el comprobnte de domicillio', 'el comprobante de domicilio'), 'typo');
  assert.equal(R('el vuelo tiene una escla en monterey', 'El vuelo tiene una escala en Monterrey.', { sentence: true }), 'typo');
  assert.equal(R('el comprbnte de domicilio', 'el comprobante de domicilio'), 'wrong', 'two edits in one word');
  assert.equal(R('comprobante domicilio', 'el comprobante de domicilio'), 'wrong', 'missing word');
});
t('accent-only slips keep the old "watch the accents" result', () => assert.equal(R('hablo', 'habló'), 'accent'));
t('English: one-letter typo passes, plural / past -s/-d endings do not', () => { assert.equal(R('prescripton', 'prescription', { lang: 'en' }), 'typo'); assert.equal(R('tires', 'tire', { lang: 'en' }), 'wrong'); });
t('typo feedback highlights the fixed letter in the correct answer', () => {
  const r = Check.check('cotizaciom', ['la cotización']); assert.equal(Check.markFixes('la cotización', r), 'la cotizació<mark>n</mark>');
  const r2 = Check.check('mojnera', ['mojonera']); assert.equal(Check.markFixes('mojonera', r2), 'moj<mark>o</mark>nera');
});

// ---------------- v8 ----------------
global.Check = Check;
const Speech = require('../speech.js'), Voice = require('../voice.js');
const Lsn = require('../listen.js');
const allWords = C.units.flatMap(u => u.words), W8 = id => allWords.find(w => w.id === id);
Check.setKnown(Check.knownFromContent(C)); Check.setSynonyms(C.synonyms);
const A = (typed, w) => Check.checkAlt(typed, [w.es].concat(w.esAlt || []), { lang: 'es' }, w.alt || []);
t('v8 synonyms: reparar for arreglar is correct with a Mexican-usage note', () => {
  const r = A('reparar', W8('arreglar')); assert.equal(r.result, 'alt'); assert.ok(/arreglar is more common/.test(r.note)); assert.equal(r.answer, 'arreglar');
});
t('v8 synonyms: the main answer is still exact, a wrong word is still wrong', () => { assert.equal(A('arreglar', W8('arreglar')).result, 'exact'); assert.equal(A('romper', W8('arreglar')).result, 'wrong'); });
t('v8 synonyms: article and accent tolerance apply to the alternate', () => { assert.equal(A('el neumatico', W8('llanta')).result, 'alt'); assert.equal(A('la reunion', W8('junta')).result, 'alt'); assert.equal(A('el fontanero', W8('plomero')).result, 'alt'); });
t('v8 synonyms: a one-letter slip that lands on another real form is not credited (repara for arreglar)', () => assert.equal(A('repara', W8('arreglar')).result, 'wrong'));
t('v8 synonyms: alternates inside sentences (cloze blanks + swaps), conjugated', () => {
  assert.equal(Check.checkAlt('repararon', ['arreglaron'], { lang: 'es' }, []).result, 'alt');
  assert.equal(Check.checkAlt('alquiláramos', ['rentáramos'], { lang: 'es' }, []).result, 'alt');
  assert.equal(Check.checkAlt('deje el coche en el taller el lunes', ['Dejé el carro en el taller el lunes.'], { lang: 'es', sentence: true }, []).result, 'alt');
  assert.equal(Check.checkAlt('conduje toda la noche', ['Manejé toda la noche.'], { lang: 'es', sentence: true }, []).result, 'alt');
});
t('v8 synonyms: other-gender swaps are never applied inside a sentence (por el demora)', () => {
  assert.equal(Check.checkAlt('demora', ['retraso'], { lang: 'es' }, []).result, 'wrong');
  assert.equal(A('la demora', W8('retraso')).result, 'alt', 'but as the word itself it is fine');
});
t('v8 synonyms: content has alt notes on vocab + sentences, Mexican mains (carro, not coche)', () => {
  const wa = allWords.filter(w => w.alt).reduce((n, w) => n + w.alt.length, 0), sa = C.units.flatMap(u => u.sentences).filter(s => s.alt).length;
  assert.ok(wa >= 20 && sa >= 15, wa + ' / ' + sa);
  allWords.forEach(w => (w.alt || []).forEach(a => { assert.ok(a.w && /^Correct/.test(a.note), w.id); assert.notEqual(Check.stripAcc(a.w), Check.stripAcc(w.es.replace(/^(el|la|los|las) /, '')), w.id); }));
  const es = JSON.stringify(C.units.map(u => [u.sentences.map(s => s.es), u.story.lines.map(l => l.es)]));
  assert.ok(!/\bcoches?\b/.test(es), 'no coche in Spanish text'); assert.ok(/\bcarro\b/.test(es));
  C.synonyms.forEach(d => assert.ok(d.main && d.alt && d.note, JSON.stringify(d)));
});
t('v8 glosses: every Spanish word in sentences, stories and grammar items has a hint', () => {
  const strip = s => Check.stripAcc(String(s).toLowerCase());
  const forms = new Set(); allWords.forEach(w => [w.es, ...(w.esAlt || [])].forEach(f => { const k = strip(f.replace(/^(el|la|los|las) /, '')); forms.add(k); forms.add(k + 's'); forms.add(k + 'es'); const f1 = k.split(' ')[0]; if (f1.length > 3) forms.add(f1); }));
  C.units.forEach(u => u.sentences.forEach(s => { const k = strip(s.f); if (!k.includes(' ')) forms.add(k); }));
  const G = new Set(Object.keys(C.glosses).map(strip)); const miss = new Set();
  const scan = txt => txt.replace(/\([^)]*\)/g, ' ').split(/\s+/).forEach(tok => { const c = tok.replace(/^[¿¡“"(«—]+|[.,;:!?”"»)…—]+$/g, ''); if (!c || !/\p{L}/u.test(c)) return; const k = strip(c); if (!forms.has(k) && !G.has(k)) miss.add(c); });
  C.units.forEach(u => { u.sentences.forEach(s => scan(s.es)); u.story.lines.forEach(l => scan(l.es)); });
  Object.values(C.patterns).forEach(p => p.items.forEach(i => scan(i.q.replace('___', i.o[0]))));
  assert.deepEqual([...miss], []);
  Object.entries(C.glosses).forEach(([k, v]) => assert.ok(v && v.trim(), k));
});
t('v8 speech grading: punctuation, accents and digits ignored', () => {
  assert.equal(Speech.grade(['pague 500 pesos por la consulta'], 'Pagué 500 pesos por la consulta.').result, 'exact');
  assert.equal(Speech.grade(['pagué quinientos pesos por la consulta'], 'Pagué 500 pesos por la consulta.').result, 'exact');
  assert.equal(Speech.grade(['Se los enviaré mañana'], 'Se los enviaré mañana.').result, 'exact');
  assert.equal(Speech.grade(['se los enviare manana'], 'Se los enviaré mañana.').result, 'exact');
});
t('v8 speech grading: best of several alternatives; one dropped word in a long line is "close"', () => {
  assert.equal(Speech.grade(['me lo mandas', 'me lo puedes mandar mañana'], '¿Me lo puedes mandar mañana?').result, 'exact');
  assert.equal(Speech.grade(['pagué quinientos pesos por consulta'], 'Pagué 500 pesos por la consulta.').result, 'close');
  assert.equal(Speech.grade(['me lo mandas mañana'], '¿Me lo puedes mandar mañana?').result, 'wrong', 'short line: no slack');
});
t('v8 speech grading: a clitic slip is never "close" (se lo vs se los)', () => {
  assert.equal(Speech.grade(['si te pide el dinero no se lo des todavía'], 'Si te pide el dinero, no se los des todavía.').result, 'wrong');
  assert.equal(Speech.grade([''], 'Hola.').result, 'wrong'); assert.equal(Speech.grade([], 'Hola.').result, 'wrong');
});
t('v8 speech feature check + blocking errors', () => {
  assert.equal(Speech.available({}), false); assert.equal(Speech.available({ webkitSpeechRecognition: function () {} }), true); assert.equal(Speech.available({ SpeechRecognition: function () {} }), true);
  ['not-allowed', 'service-not-allowed', 'audio-capture', 'network'].forEach(e => assert.ok(Speech.isBlocking(e), e));
  ['no-speech', 'aborted'].forEach(e => assert.ok(!Speech.isBlocking(e), e));
  assert.equal(Speech.numWords(150), 'ciento cincuenta'); assert.equal(Speech.numWords(45), 'cuarenta y cinco'); assert.equal(Speech.numWords(2026), 'dos mil veintiseis');
});
t("v8 can't speak now: 10-minute pause helpers, speak is its own type", () => {
  const now = 1e12, until = Lsn.start(now); assert.equal(until - now, 600000); assert.ok(Lsn.paused(until, now + 599999)); assert.ok(!Lsn.paused(until, now + 600000));
  assert.ok(Lsn.isSpeak('speak') && !Lsn.isSpeak('listen') && !Lsn.isAudio('speak'));
  assert.equal(Lsn.substituteSpeak(true), 'build'); assert.equal(Lsn.substituteSpeak(false), 'en2es');
});
t('v8 voice choice: Angélica Enhanced > es-MX Enhanced > es-MX > es-US > es-*; saved choice wins', () => {
  const v = (name, lang, uri) => ({ name, lang, voiceURI: uri || name, localService: true });
  const list = [v('Mónica', 'es-ES'), v('Paulina', 'es-MX'), v('Angélica', 'es-MX', 'com.apple.voice.compact.es-MX.Angelica'), v('Angélica (Enhanced)', 'es-MX', 'com.apple.voice.enhanced.es-MX.Angelica'), v('Samantha', 'en-US'), v('Juan (Enhanced)', 'es-MX'), v('Google español de Estados Unidos', 'es-US')];
  assert.equal(Voice.best(list).name, 'Angélica (Enhanced)');
  assert.equal(Voice.best(list.filter(x => !/Ang/.test(x.name))).name, 'Juan (Enhanced)');
  assert.equal(Voice.best(list.filter(x => !/Ang|Juan/.test(x.name))).name, 'Paulina');
  assert.equal(Voice.best([v('Mónica', 'es-ES'), v('Google español de Estados Unidos', 'es-US')]).name, 'Google español de Estados Unidos');
  assert.equal(Voice.best([v('Mónica', 'es-ES'), v('Samantha', 'en-US')]).name, 'Mónica');
  assert.equal(Voice.best([v('Samantha', 'en-US')]), null);
  assert.equal(Voice.best([v('Angelica', 'es-MX'), v('Angelica (Premium)', 'es-MX')]).name, 'Angelica (Premium)', 'no-accent name, Premium');
  assert.equal(Voice.choose(list, 'Paulina').name, 'Paulina');
  assert.equal(Voice.choose(list, 'Removed voice').name, 'Angélica (Enhanced)', 'uninstalled saved voice falls back to automatic');
  assert.deepEqual(Voice.spanish(list).map(x => x.lang).filter(l => !l.startsWith('es')), []);
});
console.log(`\n${n} tests passed`);
