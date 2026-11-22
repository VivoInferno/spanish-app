#!/usr/bin/env python3
"""v9.6: precompute the other natural word orders for every sentence the learner builds from tiles or types.

Colby's rule: if it's correct, natural Spanish with the same meaning, it gets the mark (the preferred order is shown
quietly underneath). This script writes an `alts` list (same words, other orders) onto:
  - units[].sentences[]        (sentence builders, unit-test builds)
  - units[].story.lines[]      (story "rebuild this line" tiles)
  - patterns[].items[]         (grammar "build it" tiles: the reply part, or the whole line)

Rules (applied within one clause: commas, semicolons, " — " and que / porque / cuando / si / pero / y / o … are walls):
  1. movable adverbials (todavía, ya, también, hoy, mañana, ahora, ahorita, después, luego, pronto, aquí, ahí, por favor,
     otra vez, de nuevo, time phrases like esta semana / el lunes / en la tarde) can sit at the clause start, at the clause
     end, or right before the verb group. The verb group [no] [me/te/se/lo/la/…]* verb [verb…] is never split.
     nunca only moves between the start and the spot before the verb (moving it after the verb needs an extra "no").
     "ya no", "todavía no"-style blocks keep "no" glued to the verb; a word after a preposition (para mañana, desde hoy,
     hasta luego) is part of that phrase and never moves.
  2. subjects: an overt subject pronoun (yo, usted, …) right before the verb group can be dropped or put right after the
     verb; a short noun-phrase subject can follow the verb when nothing else comes after it (llegó el notario).
  3. MANUAL_ADD / MANUAL_BLOCK below: hand-reviewed additions and vetoes.
Everything else stays strict: same words (a dropped subject pronoun aside), no + clitic + verb order, clitic order, person.
Run: python3 tools/gen_word_orders.py [--check]   (--check: report only, don't write)
"""
import json, re, sys, os, collections, unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATH = os.path.join(ROOT, 'content.json')
MAX_ALTS = 24

PREP = {'a', 'al', 'de', 'del', 'para', 'por', 'desde', 'hasta', 'en', 'con', 'sin', 'sobre', 'entre', 'hacia', 'antes', 'más', 'menos', 'que', 'tan'}
WALL = {'que', 'porque', 'cuando', 'si', 'pero', 'y', 'e', 'o', 'u', 'aunque', 'donde', 'mientras', 'como', 'pues', 'sino', 'ni', 'quien', 'cual', 'cuanto'}
CLITIC = {'me', 'te', 'se', 'lo', 'la', 'los', 'las', 'le', 'les', 'nos', 'os'}
SUBJ = {'yo', 'tú', 'usted', 'él', 'ella', 'nosotros', 'nosotras', 'ustedes', 'ellos', 'ellas', 'vosotros'}
DET = {'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'mi', 'mis', 'su', 'sus', 'tu', 'tus', 'este', 'esta', 'estos', 'estas', 'ese', 'esa', 'esos', 'esas', 'nuestro', 'nuestra', 'nuestros', 'nuestras', 'aquel', 'aquella'}
DAYS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']
# multi-word adverbials first (longest match wins)
PHRASES = [p.split() for p in sorted(set([
    'por favor', 'otra vez', 'de nuevo', 'hoy mismo', 'ahora mismo', 'ahorita mismo', 'mañana temprano', 'más tarde', 'a veces', 'de vez en cuando',
    'esta semana', 'este mes', 'este año', 'esta mañana', 'esta tarde', 'esta noche', 'este fin de semana', 'el fin de semana', 'la próxima semana',
    'la semana que viene', 'el próximo mes', 'el próximo año', 'el mes que viene', 'la semana pasada', 'el mes pasado', 'el año pasado', 'todos los días',
    'cada semana', 'cada mes', 'cada año', 'en la mañana', 'en la tarde', 'en la noche', 'por la mañana', 'por la tarde', 'por la noche', 'pasado mañana',
    'en este momento', 'mañana en la mañana', 'mañana en la tarde', 'casi siempre', 'hoy en la tarde', 'hoy en la mañana', 'ayer en la tarde', 'anoche',
] + [f'el {d}' for d in DAYS] + [f'este {d}' for d in DAYS] + [f'los {d}' for d in DAYS if d.endswith('s')] + [f'el próximo {d}' for d in DAYS]), key=lambda x: -len(x.split()))]
SINGLE = {'todavía', 'aún', 'ya', 'también', 'siempre', 'nunca', 'hoy', 'mañana', 'ayer', 'ahora', 'ahorita', 'luego', 'después', 'pronto', 'aquí', 'ahí', 'allí', 'acá', 'allá', 'anoche', 'entonces', 'normalmente', 'generalmente', 'seguramente', 'probablemente', 'finalmente'}
# hand-reviewed additions (sentence → extra accepted orders) and vetoes (orders that read wrong even though the rules allow them)
MANUAL_ADD = {
    'La segunda etapa todavía no tiene fecha de entrega.': ['La segunda etapa no tiene fecha de entrega todavía.', 'Todavía no tiene fecha de entrega la segunda etapa.'],
}
MANUAL_BLOCK = set()

TIME_N = {'minutos', 'minuto', 'horas', 'hora', 'días', 'día', 'semanas', 'semana', 'meses', 'mes', 'años', 'año', 'rato', 'poco', 'tiempo', 'mucho', 'dos', 'tres', 'cinco', 'diez', 'quince', 'veinte'}
SER = {'es', 'son', 'fue', 'fueron', 'era', 'eran', 'será', 'serán', 'sería', 'sea', 'sean'}
VERB_EXTRA = set('es son está están estoy estamos era eran fue fueron hay había hubo tiene tengo tienen tenemos tenía va voy van vamos iba puede puedo pueden podemos podría quiero quiere quieren queremos necesito necesita necesitan necesitamos sé sabe saben hace hago hacen hizo hice dice dijo digo da doy dan dio di ve veo ven vio vi viene vengo vienen vino llega llegó llegan llego queda quedan quedó gusta gustan encanta encantan falta faltan parece mando manda mandé mandó envío envía envié envió paso pasa pasó pago paga pagó pagué firma firmó firmé tengamos haya hayan sea sean esté estén vaya vayan pueda tenga tengan he ha han hemos habían había habrá será estará tendrá irá podrá deja dejó dejé mide miden cuesta cuestan vale valen incluye incluyen sale salen salió abre abren cierra cierran'.split())

NOT_VERB = {'café', 'bebé', 'josé', 'pedró', 'adiós', 'después', 'según', 'menú', 'mamá', 'papá', 'sofá', 'quizá', 'allá', 'acá', 'está'}
def is_verbish(w, verbs):
    if w in verbs or w in VERB_EXTRA: return True
    return w not in NOT_VERB and bool(re.search(r"(ó|aron|ieron|aban|ábamos|aste|iste)$", w))  # preterite / imperfect endings

def build_verbs(c):
    v = set()
    gl = c.get('glosses', {})
    pron = re.compile(r"^(to |i |you |he |she |it |we |they |is |are |am |was |were |has |have |had |will |would |can |could |let'?s |there (is|are|was|were)|do |does |did |must |should |may |might |\(he/she\)|s/he |goes|comes)", re.I)
    for k, g in gl.items():
        k = k.lower(); g = str(g)
        if ' ' in k: continue
        if pron.search(g) or '(command' in g or '(usted' in g.lower() and not g.lower().startswith('you (usted)'):
            v.add(k)
        elif re.fullmatch(r"[a-z]{3,}s", g.strip()) and not re.search(r"(ss|us|as|is)$", g.strip()) and re.search(r"(a|e|an|en)$", k) and k not in DET:
            v.add(k)  # "opens" for abre, "changes" for cambia (not gas for gasolina)
    for u in c['units']:
        for w in u['words']:
            es = w['es'].lower(); en = str(w.get('en', ''))
            if ' ' not in es and pron.search(en): v.add(es)
    return v - SUBJ - DET - CLITIC - SINGLE - PREP - WALL - {'no'}

TOK = re.compile(r"[¿¡]|[\wáéíóúñüÁÉÍÓÚÑÜ$%º°]+(?:[.,][0-9]+)*|[^\s\w]")
def tokens(s): return TOK.findall(s)

def segments(words):
    """split a lower-cased word list (punctuation tokens included) into clauses; returns lists of indices"""
    segs, cur = [], []
    for i, w in enumerate(words):
        if not re.match(r"[\wáéíóúñü$%]", w) or w in WALL:
            if cur: segs.append(cur); cur = []
            continue
        cur.append(i)
    if cur: segs.append(cur)
    return segs

def verb_group(seg, words, verbs):
    """(start, end) indices in seg of the verb group: [no] [clitics]* verb [verb/participle/infinitive]*"""
    for k, i in enumerate(seg):
        w = words[i]
        nonfinite = re.search(r"(ar|er|ir|ír|ado|ada|ados|adas|ido|ida|idos|idas|ando|iendo)(me|te|se|lo|la|los|las|le|les|nos)*$", w) and w not in VERB_EXTRA
        if w == 'no' or w in CLITIC or (is_verbish(w, verbs) and not nonfinite):
            j = k
            if words[seg[j]] == 'no': j += 1
            while j < len(seg) and words[seg[j]] in CLITIC: j += 1
            if j >= len(seg): return None
            nx = words[seg[j]]
            if not (is_verbish(nx, verbs) or (k < j and re.search(r"(ó|é|aron|ieron|amos|emos|imos)$", nx))):  # a clitic run must be followed by a verb
                continue
            if w in CLITIC and words[seg[j]] in DET | {'que'}: continue  # "la casa": an article, not a clitic
            e = j
            while e + 1 < len(seg) and (is_verbish(words[seg[e + 1]], verbs) or re.search(r"(ado|ido|ando|iendo|ar|er|ir)(me|te|se|lo|la|los|las|le|les|nos)*$", words[seg[e + 1]]) and words[seg[e + 1]] not in SINGLE): e += 1
            return (k, e)
    return None

def find_movables(seg, words, verbs):
    out = []; k = 0
    while k < len(seg):
        hit = None
        for ph in PHRASES:
            n = len(ph)
            if k + n <= len(seg) and [words[seg[k + m]] for m in range(n)] == ph: hit = n; break
        w = words[seg[k]]
        prev = words[seg[k - 1]] if k else None
        nxt = words[seg[k + 1]] if k + 1 < len(seg) else None
        if hit and seg[k + hit - 1] + 1 < len(words) and re.fullmatch(r"\d+", words[seg[k + hit - 1] + 1]): k += hit; continue  # el sábado 5
        if hit:
            if prev in PREP or prev in SER: k += hit; continue
            out.append((k, k + hit)); k += hit; continue
        if w in SINGLE:
            bad = prev in PREP or prev in SER or prev in DET or prev in {'esta', 'cada', 'toda', 'una', 'muy', 'más', 'tan', 'lo'}
            if w == 'ya' and (nxt in {'no', 'que'} or prev == 'no'): bad = True
            if w in {'todavía', 'aún'} and prev == 'no': bad = True
            if w == 'después' and (nxt in {'de', 'que', 'del'} or prev in TIME_N or (prev or '').isdigit()): bad = True
            if w in {'ahora', 'siempre', 'mañana'} and nxt == 'que': bad = True
            if w == 'también' and prev in SUBJ: bad = True
            if w == 'mañana' and nxt in {'en', 'por'}: bad = True
            if not bad: out.append((k, k + 1))
        k += 1
    return out

def merged_movables(seg, words, verbs):
    ms = find_movables(seg, words, verbs); out = []
    for a, b in ms:
        if out and out[-1][1] == a: out[-1] = (out[-1][0], b)  # el jueves + en la mañana move together
        else: out.append((a, b))
    COORD = {'y', 'e', 'o', 'u', 'ni'}
    res = []
    for a, b in out:
        prev = words[seg[a] - 1] if seg[a] > 0 else None; nxt = words[seg[b - 1] + 1] if seg[b - 1] + 1 < len(words) else None
        if prev in COORD or nxt in COORD: continue  # los martes y los viernes: a coordinated pair stays put
        ph = [words[seg[m]] for m in range(a, b)]
        if ph == ['aquí'] and b < len(seg) and words[seg[b]] in {'tiene', 'tienes', 'está', 'están'}: continue  # "aquí tiene" (here you go)
        res.append((a, b))
    return res

def variants_of(words, verbs):
    """all one-step re-orderings of a lower-cased token list (punctuation kept as tokens)"""
    res = []
    for seg in segments(words):
        vg = verb_group(seg, words, verbs)
        seg_end_next = words[seg[-1] + 1] if seg[-1] + 1 < len(words) else None
        # moves only inside a clause with exactly one finite verb (no verb: a fragment like "El sábado 5."; two: an unmarked
        # clause boundary, e.g. a relative clause "el cliente que vino ayer quiere …")
        fin = [i for i in seg if is_verbish(words[i], verbs) and not re.search(r"(ar|er|ir|ír|ado|ada|ados|adas|ido|ida|idos|idas|ando|iendo)(me|te|se|lo|la|los|las|le|les|nos)*$", words[i])]
        if vg: fin = [i for i in fin if not (seg[vg[0]] <= i <= seg[vg[1]])] + [seg[vg[0]]]
        movable_ok = bool(vg) and len(fin) == 1
        fut = bool(vg) and (any(re.search(r"(ré|rá|rás|rán|remos)$", words[i]) for i in seg[vg[0]:vg[1] + 1]) or any(words[i] in {'voy', 'vas', 'va', 'vamos', 'van'} for i in seg[vg[0]:vg[1] + 1]))
        for (a, b) in (merged_movables(seg, words, verbs) if movable_ok else []):
            span = seg[a:b]; ph = [words[i] for i in span]
            rest = [i for i in seg if i not in span]
            if not rest: continue
            # landing spots, as positions in `rest`
            spots = {0, len(rest)}
            if vg:
                vstart = seg[vg[0]]
                if vstart not in span:
                    p = rest.index(vstart)
                    # before the verb group; if a subject pronoun sits right before it, also before that
                    spots.add(p)
            if ph == ['nunca']: spots = {s for s in spots if s != len(rest)} or spots
            if seg_end_next == 'que': spots.discard(len(rest))
            if ph == ['ya'] and fut: spots.discard(len(rest))  # "ya te vas a acostumbrar" ≠ "te vas a acostumbrar ya"  # never "… ya que …" (since) or across a relative clause
            spots = {x for x in spots if 0 <= x <= len(rest)}
            cur = a  # current position in rest terms
            for s in spots:
                if s == cur: continue
                new_seg = rest[:s] + span + rest[s:]
                nw = words[:]
                full = [words[i] for i in new_seg]
                idx = sorted(seg)
                for pos, val in zip(idx, full): nw[pos] = val
                res.append(nw)
        if vg:
            vs, ve = seg[vg[0]], seg[vg[1]]
            k0 = vg[0]
            # subject pronoun right before the verb group: drop it, or put it right after the verb
            vword = words[ve] if words[ve] not in CLITIC else None
            known = any(is_verbish(words[i], verbs) for i in seg[vg[0]:vg[1] + 1])
            if known and k0 >= 1 and words[seg[k0 - 1]] in SUBJ and (k0 < 2 or words[seg[k0 - 2]] not in PREP):
                pi = seg[k0 - 1]
                res.append(words[:pi] + words[pi + 1:])
                vpos = seg.index(ve)
                order = [i for i in seg if i != pi]; ins = order.index(ve) + 1
                order = order[:ins] + [pi] + order[ins:]
                nw = words[:]
                for pos, val in zip(sorted(seg), [words[i] for i in order]): nw[pos] = val
                res.append(nw)
            # subject pronoun right after the verb: drop it or put it before the verb group
            if known and vg[1] + 1 < len(seg) and words[seg[vg[1] + 1]] in SUBJ and words[seg[vg[1] + 1]] != 'usted' or (vg[1] + 1 < len(seg) and words[seg[vg[1] + 1]] in {'usted', 'ustedes'} and not words[vs] in {'a'}):
                pi = seg[vg[1] + 1]
                res.append(words[:pi] + words[pi + 1:])
                order = [i for i in seg if i != pi]; ins = order.index(vs)
                order = order[:ins] + [pi] + order[ins:]
                nw = words[:]
                for pos, val in zip(sorted(seg), [words[i] for i in order]): nw[pos] = val
                res.append(nw)
            # short noun-phrase subject at the clause start, nothing (or only adverbials) after the verb: verb first
            if known and k0 >= 2 and words[seg[0]] in DET and k0 <= 5 and seg[0] == segments(words)[0][0]:
                after = seg[vg[1] + 1:]
                movs = merged_movables(seg, words, verbs)
                mov_idx = {seg[m] for a, b in movs for m in range(a, b)}
                np_ = seg[:k0]
                if all(i in mov_idx for i in after) and not any(i in mov_idx for i in np_) and not any(is_verbish(words[i], verbs) for i in np_):
                    order = seg[k0:vg[1] + 1] + np_ + after
                    nw = words[:]
                    for pos, val in zip(sorted(seg), [words[i] for i in order]): nw[pos] = val
                    res.append(nw)
    return res

def render(orig, lw):
    """turn a lower-cased token list back into a sentence (capital first letter, Spanish punctuation spacing)"""
    out = ''
    for t in lw:
        if t in {'¿', '¡'}: out += (' ' if out else '') + t; continue
        if re.match(r"[\wáéíóúñü$%]", t):
            out += ('' if (not out or out.endswith(('¿', '¡'))) else ' ') + t
        else: out += t
    out = re.sub(r'\s+([,.;:?!])', r'\1', out).strip()
    out = re.sub(r'([,;:])(?=[^\s])', r'\1 ', out)
    out = re.sub(r'“\s+', '“', out); out = re.sub(r'\s+”', '”', out)
    out = re.sub(r'(^|[.?!…]\s+)([¿¡“]?)(\w)', lambda m: m.group(1) + m.group(2) + m.group(3).upper(), out)
    out = re.sub(r',\s*([.?!])', r'\1', out); out = re.sub(r'^([¿¡]?),\s*', r'\1', out)
    return out

PROPER = None
def gen(sentence, verbs, depth=2):
    toks = tokens(sentence)
    starts, at = set(), True
    for k, t in enumerate(toks):
        if re.match(r"[\wáéíóúñü$%]", t, re.I):
            if at: starts.add(k)
            at = False
        elif t in {'.', '?', '!', '…'}: at = True
    keep_case = {t for k, t in enumerate(toks) if k not in starts and t[:1].isupper()} | {'Agua', 'Dulce', 'Tres', 'Aguas', 'Mérida', 'Colby', 'INE', 'Laura'}
    lw = [t if t in keep_case else t.lower() for t in toks]
    norm = lambda ws: ' '.join(w for w in ws if re.match(r"[\wáéíóúñü$%]", w, re.I)).lower()
    base = norm(lw)
    seen = {base}; frontier = [lw]; out = []
    for _ in range(depth):
        nxt = []
        for ws in frontier:
            for v in variants_of(ws, verbs):
                n = norm(v)
                if n in seen: continue
                seen.add(n); out.append(render(sentence, v)); nxt.append(v)
        frontier = nxt
    out = [o for o in out if o not in MANUAL_BLOCK]
    for m in MANUAL_ADD.get(sentence, []):
        if norm(tokens(m)) not in {norm(tokens(o)) for o in out} and norm(tokens(m)) != base: out.append(m)
    return out[:MAX_ALTS]

def targets(c):
    """(object, text) for every builder / typed target: unit sentences, story lines, grammar item replies"""
    for u in c['units']:
        for s in u['sentences']: yield s, s['es']
        for l in u['story']['lines']: yield l, l['es']
    for p in c['patterns'].values():
        for it in p['items']:
            full = re.sub(r'\s*\([^)]*\)\s*$', '', it['q'].replace('___', it['o'][0])); parts = full.split(' — ')
            yield it, parts[1] if len(parts) == 2 else full

def main():
    check_only = '--check' in sys.argv
    raw = open(PATH, encoding='utf-8').read(); c = json.loads(raw, object_pairs_hook=collections.OrderedDict)
    verbs = build_verbs(c)
    n_items = n_alts = 0; total = 0; sample = []
    for obj, text in targets(c):
        total += 1
        alts = gen(text, verbs)
        if alts: obj['alts'] = alts; n_items += 1; n_alts += len(alts); sample.append((text, alts))
        elif 'alts' in obj: del obj['alts']
    print(f'{n_items} of {total} build/typed targets gained alternatives ({n_alts} alternative orders, {len(verbs)} verb forms known)')
    if '--show' in sys.argv:
        for t, a in sample: print('*', t); [print('   ', x) for x in a]
    if not check_only:
        open(PATH, 'w', encoding='utf-8').write(json.dumps(c, ensure_ascii=False, indent=1) + ('\n' if raw.endswith('\n') else ''))

if __name__ == '__main__': main()
