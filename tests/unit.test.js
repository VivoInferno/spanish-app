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
t('later units recycle earlier words', () => {
  const words = C.units.map(u => u.words.map(w => w.es.replace(/^(el|la) /, '')));
  for (let i = 1; i < C.units.length; i++) {
    const earlier = words.slice(0, i).flat();
    const hits = C.units[i].sentences.filter(s => earlier.some(w => s.es.toLowerCase().includes(w.slice(0, -1))));
    assert.ok(hits.length >= 1, C.units[i].id);
  }
});
t('APP_VERSION matches sw.js CACHE', () => {
  const fs = require('fs'), path = require('path');
  const v = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8').match(/APP_VERSION = '(v\d+)'/)[1];
  const c = fs.readFileSync(path.join(__dirname, '../sw.js'), 'utf8').match(/CACHE = 'espanol-(v\d+)'/)[1];
  assert.equal(v, c); console.log('   version', v);
});
console.log(`\n${n} tests passed`);
