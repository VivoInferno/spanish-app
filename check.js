/* Answer checking: accent-tolerant, article/"to"-tolerant, and one-letter typo tolerance per word where it is safe. */
(function (root) {
  const stripAcc = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  function clean(s) {
    return String(s).toLowerCase().normalize('NFC')
      .replace(/[’'`´]/g, '')
      .replace(/[¿?¡!.,;:"“”«»()\/\-—–]/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }
  const ART = { es: /^(el|la|los|las|un|una|unos|unas) /, en: /^(to|a|an|the) / };
  function lev(a, b) {
    const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[n];
  }
  // one edit apart? substitution, insertion, deletion or swap of two adjacent letters. Returns the edit or null.
  function oneEdit(typed, want) {
    if (typed === want) return null;
    const a = typed, b = want;
    if (a.length === b.length) {
      const diff = []; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff.push(i);
      if (diff.length === 1) return { op: 'sub', pos: diff[0], typed: a[diff[0]], want: b[diff[0]] };
      if (diff.length === 2 && diff[1] === diff[0] + 1 && a[diff[0]] === b[diff[1]] && a[diff[1]] === b[diff[0]]) return { op: 'swap', pos: diff[0] };
      return null;
    }
    if (Math.abs(a.length - b.length) !== 1) return null;
    const [lng, sht] = a.length > b.length ? [a, b] : [b, a];
    let i = 0; while (i < sht.length && lng[i] === sht[i]) i++;
    if (lng.slice(i + 1) !== sht.slice(i)) return null;
    return a.length > b.length ? { op: 'ins', pos: i, typed: a[i] } : { op: 'del', pos: i, want: b[i] };
  }
  // Spanish inflection guard: an edit at the end of a word that swaps vowels or adds/drops s / n usually changes
  // gender, number, person or mood (interesado/interesada, envió/envíe, aprueban/aprueben, vendido/vendidos).
  const VOW = 'aeiou', END = 'aeiosn';
  function inflectionEdit(e, want) {
    const n = want.length, nearEnd = e.pos >= n - 3;
    if (e.op === 'sub') return (e.pos === n - 1 && END.includes(e.typed) && END.includes(e.want)) || (nearEnd && VOW.includes(e.typed) && VOW.includes(e.want));
    if (e.op === 'ins') return e.pos >= n - 1 && END.includes(e.typed);
    if (e.op === 'del') return e.pos >= n - 1 && END.includes(e.want);
    return e.op === 'swap' && e.pos >= n - 2 && (VOW.includes(want[e.pos]) || VOW.includes(want[e.pos + 1])) && END.includes(want[n - 1]) && e.pos === n - 2;
  }
  let KNOWN = new Set(); // accent-free Spanish word forms from the course (words, sentences, stories, grammar answers)
  function setKnown(words) { KNOWN = new Set([...words].map(w => stripAcc(clean(w))).filter(Boolean)); return KNOWN.size; }
  function knownFromContent(C) {
    const out = new Set(), add = t => clean(t).split(' ').forEach(w => w && out.add(w));
    (C.units || []).forEach(u => {
      u.words.forEach(w => [w.es, ...(w.esAlt || [])].forEach(add));
      u.sentences.forEach(s => add(s.es));
      if (u.story) u.story.lines.forEach(l => add(l.es));
    });
    Object.values(C.patterns || {}).forEach(p => p.items.forEach(it => { it.o.forEach(add); add(it.q.replace('___', ' ')); }));
    return out;
  }
  // per-word tolerance: same number of words; each word may have one safe edit
  function wordTypos(f, af, lang) {
    const tw = stripAcc(f).split(' '), aw = stripAcc(af).split(' ');
    if (tw.length !== aw.length) return null;
    const fixes = [];
    for (let k = 0; k < aw.length; k++) {
      if (tw[k] === aw[k]) continue;
      if (aw[k].length <= 3) return null; // short words (lo/la, el/al, los/las, se) must be exact
      const e = oneEdit(tw[k], aw[k]); if (!e) return null;
      if (lang === 'es') {
        if (KNOWN.has(tw[k])) return null; // the typo is itself a real form in the course: a different word, not a slip
        if (inflectionEdit(e, aw[k])) return null;
      } else if (e.op !== 'swap' && e.pos >= aw[k].length - 1 && 'sd'.includes(e.typed || e.want || '')) return null; // tire/tires, use/used
      fixes.push(Object.assign({ word: k }, e));
    }
    return fixes.length ? fixes : null;
  }
  /**
   * check(input, answers, {lang:'es'|'en', typo:bool (default true), sentence:bool})
   * -> {result:'exact'|'accent'|'typo'|'wrong', answer: canonical answer string, fixes?: [{word, op, pos}]}
   */
  function check(input, answers, opts) {
    opts = opts || {}; const lang = opts.lang || 'es';
    const inF = forms(input, lang);
    if (!inF[0]) return { result: 'wrong', answer: answers[0] };
    let best = { result: 'wrong', answer: answers[0] };
    for (const ans of answers) {
      for (const af of forms(ans, lang)) {
        for (const f of inF) {
          if (f === af) return { result: 'exact', answer: ans };
          if (stripAcc(f) === stripAcc(af)) { if (best.result !== 'accent') best = { result: 'accent', answer: ans }; continue; }
          if (opts.typo !== false && best.result === 'wrong') {
            const fixes = wordTypos(f, af, lang);
            if (fixes) best = { result: 'typo', answer: ans, fixes, matched: af };
          }
        }
      }
    }
    return best;
  }
  function forms(s, lang) { const c = clean(s); const out = [c]; const a = c.replace(ART[lang] || /^$/, ''); if (a !== c) out.push(a); return out; }
  // HTML for the correct answer with the fixed letter(s) highlighted
  function markFixes(answer, r) {
    const esc = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    if (!r || !r.fixes) return esc(answer);
    const words = clean(answer).split(' '), offset = words.length - (r.matched || '').split(' ').length; // skipped leading article
    const marks = {}; r.fixes.forEach(fx => { marks[fx.word + offset] = fx; });
    return words.map((w, k) => {
      const fx = marks[k]; if (!fx) return esc(w);
      const p = Math.min(fx.pos, w.length - 1), len = fx.op === 'swap' ? 2 : 1;
      return esc(w.slice(0, p)) + '<mark>' + esc(w.slice(p, p + len)) + '</mark>' + esc(w.slice(p + len));
    }).join(' ');
  }
  const api = { check, clean, stripAcc, lev, oneEdit, setKnown, knownFromContent, markFixes };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Check = api;
})(this);
