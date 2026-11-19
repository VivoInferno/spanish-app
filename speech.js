/* v8: repeat-after-me grading + speech-recognition feature check. Pure helpers (unit-tested) except ctor(). */
(function (root) {
  const C = () => (typeof Check !== 'undefined' ? Check : root.Check);
  // SpeechRecognition (Chrome, Android) or webkitSpeechRecognition (Safari 14.5+). iOS home-screen apps may expose it but refuse to run it.
  const ctor = w => { w = w || (typeof window !== 'undefined' ? window : {}); return w.SpeechRecognition || w.webkitSpeechRecognition || null; };
  const available = w => !!ctor(w);
  // recognisers write numbers as digits ("Pagué 500 pesos" -> "pague 500 pesos"); compare both sides in words
  const U = ['cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciseis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte',
    'veintiuno', 'veintidos', 'veintitres', 'veinticuatro', 'veinticinco', 'veintiseis', 'veintisiete', 'veintiocho', 'veintinueve'];
  const T = { 3: 'treinta', 4: 'cuarenta', 5: 'cincuenta', 6: 'sesenta', 7: 'setenta', 8: 'ochenta', 9: 'noventa' };
  const H = { 1: 'ciento', 2: 'doscientos', 3: 'trescientos', 4: 'cuatrocientos', 5: 'quinientos', 6: 'seiscientos', 7: 'setecientos', 8: 'ochocientos', 9: 'novecientos' };
  function numWords(n) {
    if (n < 30) return U[n];
    if (n < 100) return T[Math.floor(n / 10)] + (n % 10 ? ' y ' + U[n % 10] : '');
    if (n === 100) return 'cien';
    if (n < 1000) return H[Math.floor(n / 100)] + (n % 100 ? ' ' + numWords(n % 100) : '');
    if (n < 1000000) { const k = Math.floor(n / 1000), r = n % 1000; return (k === 1 ? 'mil' : numWords(k) + ' mil') + (r ? ' ' + numWords(r) : ''); }
    return String(n);
  }
  const norm = s => C().stripAcc(C().clean(String(s).replace(/(\d)[,.](\d{3})\b/g, '$1$2').replace(/\d+/g, d => ' ' + numWords(+d) + ' ')));
  // longest common subsequence of words: how much of the target was said, in order
  function lcs(a, b) { const m = a.length, n = b.length, d = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = a[i - 1] === b[j - 1] ? d[i - 1][j - 1] + 1 : Math.max(d[i - 1][j], d[i][j - 1]);
    return d[m][n]; }
  // object pronouns (se los, me lo): me/te/se/nos/le/les/lo always; la/los/las only after another pronoun, "no" or "ya", or first
  // in the line, since otherwise they are usually articles (por la consulta)
  const ALWAYS = new Set(['me', 'te', 'se', 'nos', 'le', 'les', 'lo']), ART = new Set(['la', 'los', 'las']), BEFORE = new Set(['me', 'te', 'se', 'nos', 'no', 'ya']);
  // v9.5: lo/la/los/las gender & number isn't graded, so they compare as one 'L'; person (me/te/se/nos/le) stays strict
  const cl = ws => ws.filter((w, k) => ALWAYS.has(w) || (ART.has(w) && (k === 0 || BEFORE.has(ws[k - 1])))).map(w => /^l(o|a|os|as)$/.test(w) ? 'L' : w).join(' ');
  const sameClitics = (tw, hw) => cl(tw) === cl(hw);
  /**
   * grade(alternatives, target) -> {result:'exact'|'accent'|'typo'|'close'|'wrong', heard}
   * Uses Check.check (punctuation, accents, one-letter slips) on each recogniser alternative; then allows one missed or
   * misheard word in a sentence of 5+ words ("close", graded Hard), because recognisers often drop a short word.
   */
  function grade(alts, target) {
    alts = (alts || []).map(a => String(a || '').trim()).filter(Boolean);
    if (!alts.length) return { result: 'wrong', heard: '' };
    const tw = norm(target).split(' ').filter(Boolean);
    let best = { result: 'wrong', heard: alts[0] }, bestLcs = -1;
    const rank = { exact: 4, accent: 3, typo: 2, close: 1, wrong: 0 };
    for (const a of alts) {
      const r = C().check(norm(a), [norm(target)], { lang: 'es', sentence: true });
      let res = r.result === 'exact' || r.result === 'agree' ? 'exact' : r.result === 'typo' ? 'typo' : r.result === 'accent' ? 'accent' : 'wrong';
      const hw = norm(a).split(' ').filter(Boolean), l = lcs(tw, hw);
      // one dropped / misheard word is fine in a long sentence, but never a clitic (se los vs se lo is the point of the drill)
      if (res === 'wrong' && tw.length >= 5 && l >= tw.length - 1 && hw.length <= tw.length + 1 && sameClitics(tw, hw)) res = 'close';
      if (rank[res] > rank[best.result] || (res === best.result && l > bestLcs)) { best = { result: res, heard: a }; bestLcs = l; }
    }
    // accent differences in a transcript are the recogniser's spelling, not the learner's: count them as exact
    if (best.result === 'accent') best.result = 'exact';
    return best;
  }

  // v9.5 voice build: put the recognised words onto the bank tiles in spoken order. Accents, case and punctuation are ignored,
  // digits read as number words (the recogniser writes "150", a tile may say "ciento cincuenta", or the reverse), multi-word
  // tiles match a run of heard words, and a one-letter slip in a word of 5+ letters (not itself a course word) still finds its tile. Each tile is used
  // once (two "la" tiles need two heard "la"). Words with no tile are returned as unmatched; nothing is guessed.
  function mapToTiles(heard, tiles, lang) {
    const nz = lang === 'en' ? (x => C().stripAcc(C().clean(String(x).replace(/(\d)[,.](\d{3})\b/g, '$1$2')))) : norm;
    const hw = nz(heard || '').split(' ').filter(Boolean);
    const tw = (tiles || []).map(t => nz(t).split(' ').filter(Boolean));
    const used = new Set(), order = [], unmatched = [], words = [];
    // fuzzy only for 5+ letter words, and never when the heard word is itself a real course word (este ≠ está)
    const near = (a, b) => a === b || (b.length >= 5 && a.length >= 4 && !(C().isKnown && C().isKnown(a)) && !!C().oneEdit(a, b));
    let i = 0;
    while (i < hw.length) {
      let best = -1, bestLen = 0, bestExact = false;
      tw.forEach((w, k) => {
        if (used.has(k) || !w.length || i + w.length > hw.length) return;
        let exact = true, ok = true;
        for (let j = 0; j < w.length; j++) { if (hw[i + j] === w[j]) continue; exact = false; if (!near(hw[i + j], w[j])) { ok = false; break; } }
        if (!ok) return;
        // longest run first, then an exact match over a fuzzy one, then the first such tile
        if (w.length > bestLen || (w.length === bestLen && exact && !bestExact)) { best = k; bestLen = w.length; bestExact = exact; }
      });
      if (best < 0) { unmatched.push(hw[i]); words.push({ w: hw[i], ok: false }); i++; continue; }
      used.add(best); order.push(best); for (let j = 0; j < bestLen; j++) words.push({ w: hw[i + j], ok: true }); i += bestLen;
    }
    return { order, unmatched, words, heard: hw.join(' ') };
  }
  // errors that mean "this device can't do speech here": stop offering speaking drills for this session
  const BLOCKING = ['not-allowed', 'service-not-allowed', 'audio-capture', 'network', 'language-not-supported', 'bad-grammar'];
  const isBlocking = err => BLOCKING.includes(err);
  const Speech = { sameClitics, ctor, available, grade, norm, numWords, isBlocking, BLOCKING, mapToTiles };
  if (typeof module !== 'undefined') module.exports = Speech; else root.Speech = Speech;
})(typeof window !== 'undefined' ? window : globalThis);
