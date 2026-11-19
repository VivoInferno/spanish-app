"""v9.5 audit: grammar distractors that differ from the right answer only by gender / number agreement
(articles, adjective / participle endings, lo/la/los/las). Prints every such item. Used to rewrite content.json."""
import json, re, sys, unicodedata
ADJ = set('listo nuevo bueno malo caro barato lleno abierto cerrado hecho roto puesto escrito vacio mismo otro todo este ese aquel ' \
          'nuestro vuestro suyo tuyo mio primero ultimo cuanto mucho poco tanto alguno ninguno seguro contento cansado ocupado'.split())
def acc(s): return ''.join(c for c in unicodedata.normalize('NFD', s) if unicodedata.category(c) != 'Mn')
def key(w):
    w = w.lower()
    if w in ('el', 'la', 'los', 'las', 'lo'): return 'L'
    if w in ('un', 'una', 'unos', 'unas', 'uno'): return 'UN'
    if w == 'del': return 'de L'
    if w == 'al': return 'a L'
    a = acc(w)
    if a != w and a in ('esta', 'este', 'estas', 'estos', 'esten'): return w  # está / esté are verbs
    m = re.match(r'^(.{3,}?)(me|te|se|nos)?(lo|la|los|las)$', a)          # enclitic: mandamelo / dáselas / mandarla
    if m and len(a) >= 6 and re.search(r'(a|e|i|ar|er|ir|ndo)(me|te|se|nos)?(lo|la|los|las)$', a): return m.group(1) + (m.group(2) or '') + 'L'
    m = re.match(r'^(.*(?:ad|id|ech|iert|uest|crit|ot))(o|a|os|as)$', a)   # participles
    if m: return m.group(1) + 'O'
    m = re.match(r'^(.+?)(o|a|os|as|e|es)$', a)
    if m and (m.group(1) + 'o' in ADJ or m.group(1) + 'e' in ADJ or a in ADJ): return m.group(1) + 'O'
    if a in ('esta', 'estas', 'estos', 'este'): return 'estO' if w == a else w
    return a
def k(phrase): return ' '.join(key(w) for w in re.findall(r"[\wáéíóúñü]+", phrase))
def gender_only(a, b): return a.strip().lower() != b.strip().lower() and k(a) == k(b)
if __name__ == '__main__':
    C = json.load(open(sys.argv[1] if len(sys.argv) > 1 else 'content.json'))
    n = 0
    for pk, p in C['patterns'].items():
        for i, it in enumerate(p['items']):
            bad = [o for o in it['o'][1:] if gender_only(it['o'][0], o)]
            if bad: n += 1; print(f'{pk}[{i}] {it["q"][:60]} | right: {it["o"][0]} | gender-only: {bad} | all: {it["o"]}')
    for u in C['units']:
        for q in (u.get('story') or {}).get('qs', []):
            if q.get('p'):
                bad = [o for o in q['o'][1:] if gender_only(q['o'][0], o)]
                if bad: n += 1; print(f'story {u["id"]} {q.get("q","")[:50]} | {q["o"]} | gender-only: {bad}')
    print(n, 'items with gender/number-only distractors')
