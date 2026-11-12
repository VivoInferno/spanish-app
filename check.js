/* Answer checking: accent-tolerant, article/"to"-tolerant, small typo tolerance where safe. */
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
  function forms(s, lang) { const c = clean(s); const out = [c]; const a = c.replace(ART[lang] || /^$/, ''); if (a !== c) out.push(a); return out; }
  /**
   * check(input, answers, {lang:'es'|'en', typo:bool, sentence:bool})
   * -> {result:'exact'|'accent'|'typo'|'wrong', answer: canonical answer string}
   */
  function check(input, answers, opts) {
    opts = opts || {}; const lang = opts.lang || 'es';
    const inF = forms(input, lang);
    if (!inF[0]) return { result: 'wrong', answer: answers[0] };
    let best = { result: 'wrong', answer: answers[0], dist: Infinity };
    for (const ans of answers) {
      for (const af of forms(ans, lang)) {
        for (const f of inF) {
          if (f === af) return { result: 'exact', answer: ans };
          if (stripAcc(f) === stripAcc(af)) { if (best.result !== 'accent') best = { result: 'accent', answer: ans, dist: 0 }; continue; }
          const allowed = opts.sentence ? Math.floor(stripAcc(af).length / 15) : (opts.typo && stripAcc(af).length >= 5 ? 1 : 0);
          if (allowed) {
            const d = lev(stripAcc(f), stripAcc(af));
            if (d <= allowed && best.result === 'wrong' && d < best.dist) best = { result: 'typo', answer: ans, dist: d };
          }
        }
      }
    }
    return { result: best.result, answer: best.answer };
  }
  const api = { check, clean, stripAcc, lev };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Check = api;
})(this);
