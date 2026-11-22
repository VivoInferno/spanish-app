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
      if (/\d/.test(aw[k]) || /\d/.test(tw[k])) return null; // v9.5: 1500 vs 1501 is a different number, never a slip
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
  // ---- v9.5: numbers. Digits and Spanish number words are the same answer ("ciento cincuenta" = 150 = $150 = 150 pesos,
  // "mil quinientos" = 1,500 = 1.500, "primero" = 1.º). Both sides are rewritten to digits before comparing, so typo and
  // synonym tolerance still apply to the rest of the sentence. A lone un/una stays a word (it is usually an article).
  const NW = {
    cero: 0, uno: 1, un: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
    once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19, veinte: 20,
    veintiuno: 21, veintiun: 21, veintiuna: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25, veintiseis: 26,
    veintisiete: 27, veintiocho: 28, veintinueve: 29, treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70,
    ochenta: 80, noventa: 90, cien: 100, ciento: 100, doscientos: 200, trescientos: 300, cuatrocientos: 400, quinientos: 500,
    seiscientos: 600, setecientos: 700, ochocientos: 800, novecientos: 900
  };
  ['doscient', 'trescient', 'cuatrocient', 'seiscient', 'setecient', 'ochocient', 'novecient'].forEach((p, k) => { NW[p + 'as'] = [200, 300, 400, 600, 700, 800, 900][k]; });
  NW.quinientas = 500;
  const MULT = { mil: 1e3, millon: 1e6, millones: 1e6 };
  const ORD = { primero: 1, primer: 1, primera: 1, segundo: 2, segunda: 2, tercero: 3, tercer: 3, tercera: 3, cuarto: 4, cuarta: 4,
    quinto: 5, quinta: 5, sexto: 6, sexta: 6, septimo: 7, septima: 7, octavo: 8, octava: 8, noveno: 9, novena: 9, decimo: 10, decima: 10 };
  const FUZZ = Object.keys(NW).concat(Object.keys(MULT)).filter(w => w.length >= 5);
  const tensOf = v => v >= 30 && v <= 90 && v % 10 === 0;
  // raw-string step (before clean() eats "." and ","): $150 -> 150 pesos, 1,500 / 1.500 / 1 500 000 -> 1500, 1.º / 1º / 1er -> ord1
  function numRaw(s) {
    s = String(s).replace(/\$\s*(\d[\d.,]*)(\s*(mxn|pesos?)\b)?/gi, '$1 pesos ');
    let p; do { p = s; s = s.replace(/(\d)[,.](\d{3})(?!\d)/g, '$1$2'); } while (s !== p);
    s = s.replace(/(^|[^\d.,])(\d{1,3}(?: \d{3})+)(?![\d.,])/g, (m, a, b) => a + b.replace(/ /g, ''));
    s = s.replace(/(\d+)\s*\.?\s*[ºª°]/g, ' ord$1 ').replace(/\b(\d+)\.?\s?(er|ro|ra|do|da|to|ta|vo|va|no|na|mo|ma)\b/gi, ' ord$1 ');
    return s;
  }
  // token step: accent-free tokens -> digits. fuzzy: a one-letter slip in a long number word (cincuneta) still reads as the number
  function numTokens(ws, fuzzy) {
    const out = []; let used = false, slip = false, i = 0;
    const val = (w0, allowFuzzy) => {
      const w = stripAcc(w0);
      if (w in NW || w in MULT) return w;
      if (/^\d+$/.test(w)) return w;
      if (allowFuzzy && w.length >= 5 && !KNOWN.has(w)) { const f = FUZZ.find(n => oneEdit(w, n)); if (f) return f; }
      return null;
    };
    while (i < ws.length) {
      const w = ws[i], wa = stripAcc(w);
      if (wa in ORD) { out.push('ord' + ORD[wa]); used = true; i++; continue; }
      let j = i, total = 0, cur = 0, n = 0, lastSmall = null, fz = false, ok = false, start = val(w, fuzzy);
      if (start === null) { out.push(w); i++; continue; }
      while (j < ws.length) {
        let t = val(ws[j], fuzzy); if (t === null && ws[j] !== 'y') break;
        if (ws[j] === 'y') { // treinta y dos: only between a ten and a unit
          const nx = val(ws[j + 1] || '', fuzzy), nv = nx !== null && nx in NW ? NW[nx] : -1;
          if (!(lastSmall !== null && tensOf(lastSmall) && nv >= 1 && nv <= 9)) break;
          j++; continue;
        }
        if (t !== stripAcc(ws[j])) fz = true;
        if (/^\d+$/.test(t)) { if (n && !(ws[j + 1] in MULT)) break; cur += +t; lastSmall = +t; }
        else if (t in MULT) { if (MULT[t] === 1e6) { total = total < 1e6 ? ((total + cur) || 1) * 1e6 : total + (cur || 1) * 1e6; } else { total += (cur || 1) * 1e3; } cur = 0; lastSmall = null; }
        else { const v = NW[t]; if (lastSmall !== null && (v >= lastSmall || (lastSmall % 10 !== 0 && lastSmall < 100) || (lastSmall >= 10 && lastSmall < 30))) {
            if (!(lastSmall >= 100 && v < 100) && !(lastSmall % 100 === 0 && lastSmall >= 100 && v < lastSmall)) break; }
          cur += v; lastSmall = v; }
        n++; j++; ok = true;
      }
      if (!ok) { out.push(w); i++; continue; }
      const span = ws.slice(i, j);
      if (span.length === 1 && /^(un|una)$/.test(stripAcc(span[0]))) { out.push(w); i++; continue; }
      if (span.length === 1 && /^\d+$/.test(span[0])) { out.push(String(+span[0])); i++; continue; }
      out.push(String(total + cur)); used = true; if (fz) slip = true; i = j;
    }
    return { text: out.join(' '), used, slip };
  }
  function numify(s, fuzzy, lang) { if (lang === 'en') { const t = clean(String(s).replace(/\$\s*(\d)/g, '$1').replace(/(\d),(\d{3})(?!\d)/g, '$1$2').replace(/(\d),(\d{3})(?!\d)/g, '$1$2')); return { text: t, used: /\d/.test(t), slip: false }; } const r = numTokens(clean(numRaw(s)).split(' ').filter(Boolean), fuzzy); return r; }
  // the number phrases in an answer, as written ("ciento cincuenta", "$1,500"), for the "Also written" note
  function numberSpans(s) {
    const raw = String(s).split(/\s+/).filter(Boolean), core = raw.map(t => stripAcc(clean(numRaw(t))));
    const isNum = c => c && c.split(' ').every(x => x in NW || x in MULT || x in ORD || /^(ord)?\d+$/.test(x) || x === 'pesos');
    const spans = []; let k = 0;
    while (k < raw.length) {
      if (!isNum(core[k]) || core[k] === 'pesos' || ((core[k] === 'un' || core[k] === 'una' || core[k] === 'uno') && !(core[k + 1] in MULT))) { k++; continue; }
      let j = k + 1; while (j < raw.length && (isNum(core[j]) || (core[j] === 'y' && isNum(core[j + 1]))) && core[j] !== 'pesos') j++;
      spans.push(raw.slice(k, j).join(' ').replace(/[¿?¡!.,;:"“”«»()]+$/, '').replace(/^[¿¡"“«(]+/, '')); k = j;
    }
    return spans;
  }

  // ---- v9.5: gender / number agreement is not graded. An answer that differs only in an article (el/la, un/una, del/de la),
  // an adjective or participle ending (listo/lista, vendidos/vendidas), a possessive / demonstrative (su/sus, este/esta) or the
  // gender / number of lo/la/los/las (se los vs se las, mándamelo vs mándamela) is correct, with a quiet "Natural: …" note.
  // Person and meaning stay strict: se vs me vs te, le vs lo, envié vs envió, usted vs tú commands, noun number (casa/casas).
  const ADJ = new Set(('listo nuevo bueno malo caro barato lleno vacio abierto cerrado roto hecho puesto escrito dicho visto vuelto cubierto ' +
    'mismo otro todo mucho poco tanto cuanto alguno ninguno primero ultimo seguro contento cansado ocupado rico bonito feo limpio sucio ' +
    'largo ancho alto bajo pequeno chico chiquito viejo junto perfecto correcto propio privado publico tranquilo rapido lento claro ' +
    'oscuro plano cercano lejano comodo amplio bello nuestro vuestro suyo tuyo mio americano mexicano extranjero soltero casado ' +
    'divorciado preocupado emocionado encantado equivocado enojado aburrido dormido querido frio humedo seco nublado soleado pagado ' +
    'ubicado situado bienvenido mojado incluido interesado apartado vendido firmado reservado terminado listo maduro moderno antiguo ' +
    'blanco negro rojo amarillo morado precioso hermoso famoso peligroso delicioso sabroso caluroso lluvioso ruidoso cierto concreto').split(' '));
  const ESTAR = /^(esta|estan|estoy|estamos|estaba|estaban|estuvo|estuvieron|este|esten|es|son|era|eran|fue|fueron|sea|sean|queda|quedan|quedo|quedaron|ha|han|he|has|hemos|habia|habian|haya|hayan|muy|mas|tan|menos|bien|mal|ya)$/;
  function agreeKey(text) {
    const ws = text.split(' ');
    return ws.map((w, k) => {
      if (/^(el|la|los|las|lo)$/.test(w)) return 'L';
      if (/^(un|una|unos|unas)$/.test(w)) return 'UN';
      if (w === 'del') return 'de L'; if (w === 'al') return 'a L';
      if (/^(mi|mis|tu|tus|su|sus)$/.test(w)) return w.replace(/s$/, '') + 'S';
      const a = stripAcc(w);
      if (/^(este|esta|estos|estas)$/.test(w)) return 'estO'; // the accented está / esté stay verbs
      if (/^(ese|esa|esos|esas|aquel|aquella|aquellos|aquellas)$/.test(a)) return a.replace(/(e|a|os|as|ella|ellos|ellas|el)$/, '') + 'O';
      // enclitic lo/la/los/las on a command, infinitive or gerund: mándamelo, dáselas, enviarla, mandándola
      if (a.length >= 5 && /(lo|la|los|las)$/.test(a) && (w !== a || /(ar|er|ir)(lo|la|los|las)$/.test(a) || /(me|te|se|nos)(lo|la|los|las)$/.test(a)))
        return a.replace(/(lo|la|los|las)$/, 'L');
      const m = a.match(/^(.+?)(o|a|os|as)$/);
      if (m) {
        const prev = stripAcc(ws[k - 1] || '');
        if (ADJ.has(m[1] + 'o')) return m[1] + 'O';
        if (a.length >= 6 && /ad$/.test(m[1])) return m[1] + 'O'; // -ado/-ada/-ados/-adas participles
        if (/(id|ech|iert|uest|crit|ist|uelt|ot)$/.test(m[1]) && (ESTAR.test(prev) || (ws.length === 1 && m[1].length >= 6))) return m[1] + 'O'; // está vendida, ha roto, vendidos
      }
      return w;
    }).join(' ');
  }
  /**
   * check(input, answers, {lang:'es'|'en', typo:bool (default true), sentence:bool})
   * -> {result:'exact'|'accent'|'typo'|'wrong', answer: canonical answer string, fixes?: [{word, op, pos}]}
   */
  function check(input, answers, opts) {
    opts = opts || {};
    const r = check0(input, answers, opts, false);
    if (r.result === 'exact' || opts.numbers === false) return r;
    const n = check0(input, answers, opts, true);
    const best = RANK[n.result] > RANK[r.result] ? n : r;
    if (best.result !== 'wrong' || (opts.lang || 'es') !== 'es' || opts.agree === false) return best;
    const g = check0(input, answers, Object.assign({}, opts, { typo: false }), true, true); // v9.5 (no typo credit on top: a slip could hide a person change): wrong only on gender / number agreement → correct + note
    return g.result === 'wrong' ? best : { result: 'agree', answer: g.answer, sub: g.result, numbers: g.numbers };
  }
  const RANK = { exact: 3, accent: 2, typo: 1, wrong: 0 };
  function check0(input, answers, opts, nums, agree) {
    const lang = opts.lang || 'es';
    let slip = false, inUsed = false;
    const nf = (s, fz) => { const r = numify(s, fz && lang === 'es', lang); if (fz) { slip = r.slip; inUsed = r.used; } return [r.text, r.used]; };
    const AK = fs => agree ? fs.map(agreeKey) : fs;
    const inF = AK(nums ? forms(nf(input, opts.typo !== false)[0], lang) : forms(input, lang));
    if (!inF[0]) return { result: 'wrong', answer: answers[0] };
    let best = { result: 'wrong', answer: answers[0] };
    for (const ans of answers) {
      let aUsed = false, afs;
      if (nums) { const [t, u] = nf(ans, false); aUsed = u; afs = forms(t, lang); } else afs = forms(ans, lang);
      afs = AK(afs);
      const tag = o => nums ? Object.assign(o, { numbers: true }) : o;
      for (const af of afs) {
        for (const f of inF) {
          if (f === af || stripAcc(f) === stripAcc(af)) {
            if (nums && slip) { if (best.result === 'wrong') best = tag({ result: 'typo', answer: ans, fixes: [], matched: af }); continue; }
            if (f === af) return tag({ result: 'exact', answer: ans });
            if (best.result !== 'accent') best = tag({ result: 'accent', answer: ans }); continue;
          }
          if (opts.typo !== false && best.result === 'wrong') {
            const fixes = wordTypos(f, af, lang);
            if (fixes) best = tag({ result: 'typo', answer: ans, fixes, matched: af });
          }
        }
      }
    }
    return best;
  }
  /**
   * v9.6 checkOrder(input, answers, opts, orders): same as check(), and when that says wrong, the item's other natural word
   * orders (content.json "alts": same words, e.g. "no tiene fecha de entrega todavía") count too -> {…, order: preferred}.
   */
  function checkOrder(input, answers, opts, orders) {
    const r = check(input, answers, opts);
    if (r.result !== 'wrong' || !orders || !orders.length) return r;
    const ro = check(input, orders, opts);
    return ro.result === 'wrong' ? r : Object.assign(ro, { order: answers[0] });
  }
  // ---- v8: synonym credit (reparar for arreglar, coche for carro, ...) with a note on what Mexicans say ----
  let SWAPS = new Map(); // accent-free alternate form -> {main form, note}; from content.json synonyms (sentence-safe rules only)
  function setSynonyms(list) {
    SWAPS = new Map();
    (list || []).forEach(d => {
      // every synonym form is a real Spanish form: a one-letter slip that lands on one (repara for reparar) is a different word
      [d.alt, d.main].concat((d.forms || []).flat()).forEach(f => { if (f && f !== 'xg' && !f.includes(' ')) KNOWN.add(stripAcc(clean(f))); });
      if (d.wordOnly) return;
      (d.forms || []).forEach(([a, m, xg]) => { if (!xg && !a.includes(' ')) { const k = stripAcc(clean(a)); if (!SWAPS.has(k)) SWAPS.set(k, { main: m, note: d.note }); } });
    });
    return SWAPS.size;
  }
  /**
   * checkAlt(input, answers, opts, alts) -> check() result, or {result:'alt', answer, used, note, sub} when the input is a real
   * synonym: one of the item's own alternates (alts: [{w|f, note}]) or the main answer with synonym swaps inside it.
   * Typo / accent tolerance applies to the alternate too. Drills that target a form (dictation, repeat-after-me, tiles) don't call this.
   */
  function checkAlt(input, answers, opts, alts) {
    opts = opts || {};
    const r = check(input, answers, opts);
    if (r.result !== 'wrong') return r;
    for (const a of alts || []) {
      const t = a.w || a.f; const ra = check(input, [t], opts);
      if (ra.result !== 'wrong') return { result: 'alt', answer: answers[0], used: t, note: a.note, sub: ra.result };
    }
    const words = clean(input).split(' '); let note = null, used = [];
    const sw = words.map(w => { const m = SWAPS.get(stripAcc(w)); if (m) { note = note || m.note; used.push(w); return m.main; } return w; });
    if (used.length) { const rs = check(sw.join(' '), answers, opts); if (rs.result !== 'wrong') return { result: 'alt', answer: rs.answer, used: used.join(' '), note, sub: rs.result }; }
    return r;
  }
  function forms(s, lang) { const c = clean(s); const out = [c]; const a = c.replace(ART[lang] || /^$/, ''); if (a !== c) out.push(a); return out; }
  // HTML for the correct answer with the fixed letter(s) highlighted
  function markFixes(answer, r) {
    const esc = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    if (!r || !r.fixes || r.numbers || r.result === 'agree') return esc(answer);
    const words = clean(answer).split(' '), offset = words.length - (r.matched || '').split(' ').length; // skipped leading article
    const marks = {}; r.fixes.forEach(fx => { marks[fx.word + offset] = fx; });
    return words.map((w, k) => {
      const fx = marks[k]; if (!fx) return esc(w);
      const p = Math.min(fx.pos, w.length - 1), len = fx.op === 'swap' ? 2 : 1;
      return esc(w.slice(0, p)) + '<mark>' + esc(w.slice(p, p + len)) + '</mark>' + esc(w.slice(p + len));
    }).join(' ');
  }
  const api = { check, checkAlt, checkOrder, setSynonyms, clean, stripAcc, lev, oneEdit, setKnown, knownFromContent, markFixes, numify, numberSpans, agreeKey, isKnown: w => KNOWN.has(stripAcc(clean(w))) };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Check = api;
})(this);
