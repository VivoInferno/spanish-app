/* v8: Spanish voice choice. Pure ranking helpers (unit-tested); the app feeds them speechSynthesis.getVoices(). */
(function (root) {
  const isEs = v => /^es([-_]|$)/i.test(v.lang || '');
  const fold = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  // iOS names downloaded voices "Angélica (Enhanced)" / "(Premium)" (or "Mejorada" in Spanish UI) and puts enhanced/premium in voiceURI
  const quality = v => /enhanced|premium|mejorad|neural|natural/i.test((v.name || '') + ' ' + (v.voiceURI || '')) ? 1 : 0;
  const isMX = v => /^es[-_]MX/i.test(v.lang || '');
  const isAngelica = v => fold(v.name).includes('angelica') || fold(v.voiceURI).includes('angelica');
  const isNamed = (v, n) => fold(v.name).includes(n) || fold(v.voiceURI).includes(n);
  // higher is better (v8.1): Angélica (if iOS ever exposes her) > Mónica > Paulina > other es-MX Enhanced/Premium > es-MX >
  // es-US / es-419 > any es-*. Enhanced/Premium variants of a named voice beat the compact one.
  function score(v) {
    if (!isEs(v)) return -1;
    let s = 0;
    if (isAngelica(v)) s = 700;
    else if (isNamed(v, 'monica')) s = 600;
    else if (isNamed(v, 'paulina')) s = 500;
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
  // second story voice: the saved one if installed and different from the main voice, else Paulina, else the next best Spanish voice
  function second(voices, main, saved) {
    const others = spanish(voices).filter(v => !main || key(v) !== key(main));
    if (saved) { const v = others.find(x => key(x) === saved || x.name === saved); if (v) return v; }
    return others.find(v => isNamed(v, 'paulina')) || others[0] || null;
  }
  // story cast: narrator (untagged lines) and the first character use the main voice; the second character the second voice;
  // further characters cycle through the remaining Spanish voices, and every extra lap shifts the pitch (0.9, 1.1, 0.85, 1.15…)
  const PITCH = [1, 0.9, 1.1, 0.85, 1.15];
  function cast(speakers, voices, main, sec) {
    const pool = [main, sec].concat(spanish(voices).filter(v => (!main || key(v) !== key(main)) && (!sec || key(v) !== key(sec)))).filter(Boolean);
    const out = {}; const chars = [...new Set(speakers.filter(Boolean))];
    out[''] = { voice: main || null, pitch: 1 };
    chars.forEach((name, k) => {
      if (!pool.length) { out[name] = { voice: null, pitch: PITCH[k % PITCH.length] }; return; }
      const lap = Math.floor(k / pool.length);
      out[name] = { voice: pool[k % pool.length], pitch: PITCH[lap % PITCH.length] };
    });
    // one voice only: narrator 1.0, first character 1.0 would be identical to narrator; give characters pitch variety
    if (pool.length === 1) chars.forEach((name, k) => { out[name].pitch = PITCH[(k + 1) % PITCH.length]; });
    return out;
  }
  const label = v => `${v.name} (${v.lang})${quality(v) ? '' : ''}`;
  const Voice = { second, cast, PITCH, isEs, quality, score, key, spanish, best, choose, label };
  if (typeof module !== 'undefined') module.exports = Voice; else root.Voice = Voice;
})(typeof window !== 'undefined' ? window : globalThis);
