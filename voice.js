/* v8: Spanish voice choice. Pure ranking helpers (unit-tested); the app feeds them speechSynthesis.getVoices(). */
(function (root) {
  const isEs = v => /^es([-_]|$)/i.test(v.lang || '');
  const fold = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  // iOS names downloaded voices "Angélica (Enhanced)" / "(Premium)" (or "Mejorada" in Spanish UI) and puts enhanced/premium in voiceURI
  const quality = v => /enhanced|premium|mejorad|neural|natural/i.test((v.name || '') + ' ' + (v.voiceURI || '')) ? 1 : 0;
  const isMX = v => /^es[-_]MX/i.test(v.lang || '');
  const isAngelica = v => fold(v.name).includes('angelica') || fold(v.voiceURI).includes('angelica');
  // higher is better: Angélica (Enhanced/Premium first) > other es-MX Enhanced/Premium > es-MX > es-US / es-419 > any es-*
  function score(v) {
    if (!isEs(v)) return -1;
    let s = 0;
    if (isAngelica(v)) s = 500;
    else if (isMX(v) && quality(v)) s = 400;
    else if (isMX(v)) s = 300;
    else if (/^es[-_](US|419)/i.test(v.lang)) s = 200;
    else s = 100;
    return s + quality(v) * 50 + (v.localService ? 1 : 0);
  }
  const key = v => v ? (v.voiceURI || v.name) : '';
  const spanish = voices => (voices || []).filter(isEs).sort((a, b) => score(b) - score(a) || String(a.name).localeCompare(String(b.name)));
  function best(voices) { const l = spanish(voices); return l[0] || null; }
  // saved = the key stored in settings ('' = automatic). A saved voice that is no longer installed falls back to automatic.
  function choose(voices, saved) {
    if (saved) { const v = (voices || []).find(x => key(x) === saved || x.name === saved); if (v) return v; }
    return best(voices);
  }
  const label = v => `${v.name} (${v.lang})${quality(v) ? '' : ''}`;
  const Voice = { isEs, quality, score, key, spanish, best, choose, label };
  if (typeof module !== 'undefined') module.exports = Voice; else root.Voice = Voice;
})(typeof window !== 'undefined' ? window : globalThis);
