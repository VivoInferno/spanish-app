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
  const cl = ws => ws.filter((w, k) => ALWAYS.has(w) || (ART.has(w) && (k === 0 || BEFORE.has(ws[k - 1])))).join(' ');
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
      let res = r.result === 'exact' ? 'exact' : r.result === 'typo' ? 'typo' : r.result === 'accent' ? 'accent' : 'wrong';
      const hw = norm(a).split(' ').filter(Boolean), l = lcs(tw, hw);
      // one dropped / misheard word is fine in a long sentence, but never a clitic (se los vs se lo is the point of the drill)
      if (res === 'wrong' && tw.length >= 5 && l >= tw.length - 1 && hw.length <= tw.length + 1 && sameClitics(tw, hw)) res = 'close';
      if (rank[res] > rank[best.result] || (res === best.result && l > bestLcs)) { best = { result: res, heard: a }; bestLcs = l; }
    }
    // accent differences in a transcript are the recogniser's spelling, not the learner's: count them as exact
    if (best.result === 'accent') best.result = 'exact';
    return best;
  }
  // errors that mean "this device can't do speech here": stop offering speaking drills for this session
  const BLOCKING = ['not-allowed', 'service-not-allowed', 'audio-capture', 'network', 'language-not-supported', 'bad-grammar'];
  const isBlocking = err => BLOCKING.includes(err);
  const Speech = { sameClitics, ctor, available, grade, norm, numWords, isBlocking, BLOCKING };
  if (typeof module !== 'undefined') module.exports = Speech; else root.Speech = Speech;
})(typeof window !== 'undefined' ? window : globalThis);
