"""v9.6 grammar focus: every practice stone (3rd stone) and every review session picks ONE grammar pattern and gives
about 8 drills on it (2 easy one-contrast drills first, then 3-choice / tiles / typed / say-it), the rest stays vocab.
Session size is fixed (v9.5 cycle-back: misses go to the back, nothing is inserted). A "Today's grammar" header opens the
session: the rule card if it hasn't been seen, otherwise a one-line reminder. Focus choice: this unit's patterns first, then
due, then weakest; no back-to-back repeat unless clearly weakest. Unit test + placement unchanged. Lossless v9.5 → v9.6.
Screenshots (WebKit iPhone 15): screens/v96-grammar-focus.png (session start, rule card), screens/v96-grammar-reminder.png."""
import asyncio, json, sys, os, re
src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'v8_e2e.py')).read().split('async def main')[0]
exec(src)

async def answer(pg, right=True):
    e = await pg.evaluate("__app.run && __app.entry")
    if not e: return None
    if e.get('theme') or e.get('intro') or e.get('rule'):
        await pg.click('#go'); await pg.wait_for_timeout(120); return 'step'
    ex = await pg.evaluate("({kind: __app.ex.kind, answer: __app.ex.answer, answers: __app.ex.answers, tiles: __app.ex.tiles, pk: __app.ex.pk || null, paced: !!__app.ex.paced, n: (__app.ex.options || []).length, label: __app.ex.label})")
    if ex['kind'] == 'mc':
        opts = await pg.query_selector_all('.opt'); texts = [await o.inner_text() for o in opts]
        await opts[texts.index(ex['answer']) if right else next(i for i, t in enumerate(texts) if t != ex['answer'])].click()
    elif ex['kind'] == 'build':
        if right:
            used = set()
            for wtok in re.sub(r'[¿?¡!.,;:]', '', ex['answers'][0]).split():
                for k, t in enumerate(ex['tiles']):
                    if k not in used and t == wtok: used.add(k); await pg.click(f'#tiles .tile[data-k="{k}"]'); break
            await pg.click('#check')
        else: await pg.click('#skip')
    elif ex['kind'] == 'speak': await pg.click('#cantSpeak'); await pg.wait_for_timeout(300); return 'step'
    else:
        if right: await pg.fill('#ans', ex['answers'][0]); await pg.click('#check')
        else: await pg.click('#skip')
    await pg.wait_for_selector('#next'); await pg.click('#next'); await pg.wait_for_timeout(60)
    return dict(ex, id=e['id'], retry=e.get('retry'))

async def main():
    async with async_playwright() as p:
        b = await (p.webkit if ENGINE == 'webkit' else p.chromium).launch()
        V7 = strip_meta(json.load(open(FIX + 'v7-export.json')))
        V95 = dict(V7, settings=dict(V7['settings'], voice='', voice2='', voiceMode='recorded', anim=True)); V95['schema'] = 5; V95['speakPauseUntil'] = 0
        V95['parked'] = {'g:costera': {'at': 1, 'word': 'costera'}}; V95['rulesSeen'] = {}; V95['pace'] = {}
        V95['hidden'] = [{'id': 'w:x', 'kind': 'easy', 'at': 1}]
        ctx = await new_ctx(b, p, V95, sr=False)
        pg = await ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(URL); await pg.wait_for_selector('.stone'); await pg.wait_for_timeout(400)
        s = await pg.evaluate("__app.state")
        check(await pg.evaluate("__app.version") == 'v9.6' and s['items'] == V95['items'] and s['path'] == V95['path'] and s['daily'] == V95['daily']
              and s['streak'] == V95['streak'] and s['parked'] == V95['parked'] and s['hidden'] == V95['hidden'] and s['focusLog'] == [],
              'v9.5 data → v9.6 losslessly (items, path, daily, streak, parks, hidden; focusLog = [])')

        # ---------- 1. every practice session: exactly one grammar pattern, 8 drills, fixed size ----------
        units = await pg.evaluate("__app.content.sections[0].units || __app.content.units.map(u => u.id)")
        units = await pg.evaluate("__app.content.units.map(u => u.id)")
        # make every unit's words + patterns studied so the pools are full
        await pg.evaluate("""(() => { const S = __app.state, C = __app.content, now = Date.now();
          C.units.forEach(u => { u.words.forEach(w => { const id = 'w:' + w.id; if (!S.items[id]) S.items[id] = { s: 5, d: 5, due: now + 864e5 * 3, reps: 3, lapses: 0, last: now - 864e5, state: 2 }; });
            u.focus.forEach(p => { const id = 'p:' + p; if (!S.items[id]) S.items[id] = { s: 5, d: 5, due: now + 864e5 * 3, reps: 3, lapses: 0, last: now - 864e5, state: 2 }; }); }); })()""")
        stats = await pg.evaluate("""(() => { const out = { bad: [], n: {}, formats: {}, sizes: new Set(), lead: 0, runs: 0, unitFirst: 0 };
          __app.content.units.forEach(u => { for (let r = 0; r < 12; r++) {
            const q = __app.practiceQueue(u.id), ps = q.filter(e => e.id.startsWith('p:')), pats = [...new Set(ps.map(e => e.id))];
            out.runs++; { const L = ((__app.content.sections || []).find(s => s.units) || {}).units || __app.content.units.map(x => x.id), nw = L.slice(0, L.indexOf(u.id) + 1).reduce((a, id) => a + __app.content.units.find(x => x.id === id).words.filter(w => !__app.state.parked[w.id]).length, 0); out.sizes.add(q.length === Math.min(14, 8 + nw) ? 'ok' : u.id + ':' + q.length); }
            if (pats.length !== 1 || ps.length !== 8) out.bad.push(u.id + ':' + pats.join('+') + '/' + ps.length);
            if (ps.slice(0, 2).every(e => e.ex === 'paced') && ps.slice(2).every(e => e.ex !== 'paced')) out.lead++;
            if (q.slice(0, 4).every(e => e.id === pats[0])) out.unitFirst += u.focus.includes(pats[0].slice(2)) ? 1 : 0;
            ps.slice(2).forEach(e => out.formats[e.ex] = (out.formats[e.ex] || 0) + 1);
            if (q.some(e => e.focus && e.id !== pats[0])) out.bad.push('other');
          } });
          out.sizes = [...out.sizes]; return out; })()""")
        check(not stats['bad'], f"{stats['runs']} practice sessions over all units: each has exactly ONE grammar pattern × 8 drills ({stats['bad'][:5]})")
        check(stats['sizes'] == ['ok'], f"session size N fixed at 14 (8 grammar + 6 vocab; u1 has only 5 words → 13) ({stats['sizes']})")
        check(stats['lead'] == stats['runs'], 'the first 2 grammar drills are the easy one-contrast ones (count toward the 8)')
        check(stats['unitFirst'] == stats['runs'], "focus is one of this unit's patterns, and the session opens with its block")
        check(all(stats['formats'].get(f, 0) > 0 for f in ['mc', 'ptiles', 'ptype', 'pspeak']), f"varied formats after the contrasts: {stats['formats']}")
        # every pattern can fill 8 drills without another pattern, reusing items in a different format when short
        fill = await pg.evaluate("""(() => { const bad = []; Object.keys(__app.content.patterns).forEach(pk => { const u = __app.content.units.find(x => x.focus.includes(pk)); if (!u) return;
            __app.state.focusLog = []; for (let r = 0; r < 4; r++) { const q = __app.practiceQueue(u.id).filter(e => e.focus); const f = q[0].id; if (q.length !== 8 || q.some(e => e.id !== f)) bad.push(pk); } }); return bad; })()""")
        check(not fill, f'every pattern fills its 8 drills by itself ({fill})')
        dup = await pg.evaluate("""(() => { let worst = 0; for (let r = 0; r < 30; r++) { const q = __app.practiceQueue('u2').filter(e => e.focus), seen = {};
            q.forEach(e => { const k = e.itemIdx + '|' + e.ex; seen[k] = (seen[k] || 0) + 1; worst = Math.max(worst, seen[k]); }); } return worst; })()""")
        check(dup == 1, f'no item repeats in the same format inside a session (max {dup})')

        # ---------- 2. how the focus is chosen ----------
        ch = await pg.evaluate("""(() => { const S = __app.state, now = Date.now(), r = {};
          const set = (pk, o) => S.items['p:' + pk] = Object.assign({ s: 5, d: 5, due: now + 864e5 * 5, reps: 10, lapses: 0, last: now - 864e5, state: 2 }, o);
          S.pstats = {}; S.focusLog = [];
          ['ser_estar', 'por_para', 'subj', 'relative'].forEach(pk => set(pk, {}));
          r.unit = new Set(Array.from({ length: 20 }, () => __app.chooseFocus(['ser_estar', 'por_para', 'subj', 'relative'], ['relative']))).size === 1 && __app.chooseFocus(['ser_estar', 'subj', 'relative'], ['relative']) === 'relative';
          set('subj', { due: now - 1000 });
          r.due = __app.chooseFocus(['ser_estar', 'por_para', 'subj'], []) === 'subj';
          set('subj', {}); set('por_para', { lapses: 4, reps: 10 });
          r.weak = __app.chooseFocus(['ser_estar', 'por_para', 'subj'], []) === 'por_para';
          S.pstats = { ser_estar: { seen: 10, correct: 3 } };
          r.weakStats = __app.chooseFocus(['ser_estar', 'por_para', 'subj'], []) === 'ser_estar';
          S.pstats = {}; set('por_para', { lapses: 1, reps: 10 }); S.focusLog = ['relative'];
          r.rotate = Array.from({ length: 20 }, () => __app.chooseFocus(['relative', 'subj'], ['relative', 'subj'])).every(x => x === 'subj');
          S.pstats = { relative: { seen: 10, correct: 2 } };
          r.clearlyWeak = __app.chooseFocus(['relative', 'subj'], ['relative', 'subj']) === 'relative';
          S.pstats = {}; S.focusLog = []; return r; })()""")
        check(ch['unit'], "this unit's pattern comes first")
        check(ch['due'], 'then a pattern that is due today (FSRS)')
        check(ch['weak'] and ch['weakStats'], 'then the weakest pattern (highest lapse rate / miss rate)')
        check(ch['rotate'], "the same pattern isn't chosen two sessions in a row…")
        check(ch['clearlyWeak'], '…unless it is clearly the weakest')
        rot = await pg.evaluate("""(() => { __app.state.focusLog = []; const a = __app.practiceQueue('u4').find(e => e.focus).id; __app.state.focusLog = [a.slice(2)];
            const b = __app.practiceQueue('u4').find(e => e.focus).id; return [a, b]; })()""")
        check(rot[0] != rot[1], f'u4 (two patterns): back-to-back practice rotates {rot}')

        # ---------- 3. review: one due pattern, the others wait ----------
        rv = await pg.evaluate("""(() => { const S = __app.state, now = Date.now(); ['subj', 'por_para', 'ser_estar'].forEach(pk => S.items['p:' + pk].due = now - 5000);
            ['casa', 'lote'].forEach(w => { if (S.items['w:' + w]) S.items['w:' + w].due = now - 5000; });
            const q = __app.reviewQueue(), ps = q.filter(e => e.id.startsWith('p:')); return { pats: [...new Set(ps.map(e => e.id))], n: ps.length, first: q.slice(0, 2).map(e => e.ex) }; })()""")
        check(len(rv['pats']) == 1 and rv['n'] == 8 and rv['first'] == ['paced', 'paced'], f'review with 3 due patterns: one focus pattern × 8 drills ({rv})')
        # ---------- 4. unit test and placement unchanged ----------
        tq = await pg.evaluate("(() => { const q = __app.testQueue('u4'); return { focus: q.some(e => e.focus), n: q.length, pats: q.filter(e => e.id.startsWith('p:')).length }; })()")
        check(not tq['focus'] and tq['n'] == 15 and tq['pats'] == 0, f'unit test unchanged: 12 + 3, no grammar focus ({tq})')

        # ---------- 5. UI: session start with the rule card (not seen yet) ----------
        await pg.evaluate("__app.state.rulesSeen = {}; __app.state.pace = {}; __app.state.focusLog = []")
        reps0 = await pg.evaluate("(__app.state.items['p:subj'] || {}).reps || 0")
        await pg.evaluate("__app.openStone('u3', 2)"); await pg.wait_for_selector('.card'); await pg.wait_for_timeout(300)
        st = await pg.evaluate("({ rule: !!(__app.entry && __app.entry.rule), head: (document.querySelector('.focus-head .focus-title') || {}).textContent, card: !!document.querySelector('.rule-card'), focus: __app.run.focus, n: __app.counts().n })")
        check(st['rule'] and st['card'] and st['focus'] == 'subj' and 'Today’s grammar:' in (st['head'] or '') and 'esté' in st['head'], f"session opens with “Today’s grammar: …” + the rule card ({st['head']})")
        check(st['n'] == 14, f'bar counts 14 drills from the start ({st["n"]})')
        if ENGINE == 'webkit': await pg.wait_for_timeout(500); await pg.screenshot(path=f'{OUT}/v96-grammar-focus.png')
        else: await pg.screenshot(path=f'{OUT}/v96-grammar-focus-{ENGINE}.png')
        # play the whole session; miss two grammar drills once
        seen = []; missed = 0; ns = set()
        for _ in range(80):
            e = await pg.evaluate("__app.run && __app.entry")
            if not e: break
            ns.add(await pg.evaluate("__app.counts().n"))
            right = True
            if e.get('id', '').startswith('p:') and not e.get('rule') and not e.get('retry') and missed < 2 and (await pg.evaluate("__app.ex && __app.ex.kind")) == 'mc': right = False; missed += 1
            r = await answer(pg, right)
            if isinstance(r, dict): seen.append(r)
        g = [x for x in seen if x['id'].startswith('p:')]; g1 = [x for x in g if not x['retry']]
        check(await pg.query_selector('.stone') is not None and not await pg.evaluate("!!__app.run"), 'the session finishes once every drill is right')
        check(len({x['id'] for x in g}) == 1 and len(g1) == 8, f'one grammar pattern only ({ {x["id"] for x in g} }), 8 grammar drills on first pass ({len(g1)})')
        check(g1[0]['paced'] and g1[1]['paced'] and g1[0]['n'] == 2 and len({x['kind'] + str(x['paced']) for x in g1}) >= 3, f'starts with 2 easy contrasts, then mixed formats ({[x["kind"] for x in g1]})')
        check(ns == {14} and len([x for x in g if x['retry']]) == missed, f'N stays 14; the {missed} misses came back at the end, nothing inserted ({ns})')
        reps1 = await pg.evaluate("(__app.state.items['p:subj'] || {}).reps || 0")
        check(reps1 == reps0 + 1, f'8 drills on one pattern still grade its FSRS card once (first non-contrast attempt) ({reps0} → {reps1})')
        st = await pg.evaluate("__app.state.focusLog")
        check(st[0] == 'subj', f'focus remembered for rotation ({st})')

        # ---------- 6. UI: rule already seen → one-line reminder on the first drill ----------
        await pg.evaluate("__app.state.focusLog = []")
        await pg.evaluate("__app.openStone('u3', 2)"); await pg.wait_for_selector('.card'); await pg.wait_for_timeout(300)
        st = await pg.evaluate("({ rule: !!(__app.entry && __app.entry.rule), line: (document.querySelector('.focus-head .focus-line') || {}).textContent, btn: !!document.querySelector('.focus-head [data-rule]'), paced: !!(__app.ex && __app.ex.paced), opts: (__app.ex && __app.ex.options || []).length })")
        check(not st['rule'] and st['line'] and 'esté' in st['line'] and st['btn'] and st['paced'] and st['opts'] == 2, f'card seen → header with a one-line rule reminder + 📘 Rule, then the easy contrast ({st["line"]})')
        if ENGINE == 'webkit': await pg.wait_for_timeout(400); await pg.screenshot(path=f'{OUT}/v96-grammar-reminder.png')
        await pg.click('.focus-head [data-rule]'); await pg.wait_for_selector('#ruleModal')
        check(await pg.evaluate("!!document.querySelector('#ruleModal .rule-card[data-p=\"subj\"]')"), '📘 in the header opens the full rule card')
        await pg.click('#ruleClose')
        # typed grammar format: the missing part, accents not graded
        await pg.evaluate("(() => { const r = __app.run; r.answered = false; r.queue[r.i] = Object.assign({}, r.queue[r.i], { itemIdx: 0 }); __app.forceEx('ptype'); })()"); await pg.wait_for_selector('#ans')
        ty = await pg.evaluate("({ kind: __app.ex.kind, a: __app.ex.answers[0], blank: !!document.querySelector('.prompt .blank'), mic: true })")
        await pg.fill('#ans', ty['a']); await pg.click('#check'); await pg.wait_for_selector('#fb .feedback')
        check(ty['kind'] == 'type' and ty['blank'] and await pg.query_selector('#fb .feedback.good') is not None and await pg.query_selector('#fb .why') is not None, f'typed grammar drill (type the missing part) grades + explains why ({ty["a"]})')
        await pg.click('#quit'); await pg.wait_for_selector('.stone')

        # ---------- 7. review session UI ----------
        await pg.evaluate("__app.state.focusLog = []; __app.startReview()"); await pg.wait_for_timeout(300)
        st = await pg.evaluate("({ mode: __app.run && __app.run.mode, focus: __app.run && __app.run.focus, head: !!document.querySelector('.focus-head') })")
        check(st['mode'] == 'review' and st['focus'] and st['head'], f'review opens with the same “Today’s grammar” header ({st["focus"]})')
        await pg.click('#quit')
        # ---------- 8. word order: Colby's unit-test tile build (ta2) ----------
        async def build(words):
            tiles = await pg.evaluate("__app.ex.tiles"); used = set()
            for wtok in words.split():
                k = next(k for k, t in enumerate(tiles) if k not in used and t.lower() == wtok.lower()); used.add(k)
                await pg.click(f'#tiles .tile[data-k="{k}"]')
            await pg.click('#check'); await pg.wait_for_selector('#fb .feedback')
        sent = await pg.evaluate("__app.content.units.find(u => u.id === 'ta2').sentences.find(s => s.es.startsWith('La segunda etapa'))")
        await pg.evaluate("__app.openStone('ta2', 3)"); await pg.wait_for_selector('.card'); await pg.wait_for_timeout(200)
        await pg.evaluate(f"(() => {{ const r = __app.run; r.queue[r.i] = {{ id: 'w:etapa', ex: 'build', sent: {json.dumps(sent)}, key: 999001 }}; __app.forceEx('build', {json.dumps(sent)}); }})()")
        await pg.wait_for_selector('#tiles .tile')
        await build('La segunda etapa no tiene fecha de entrega todavía')
        wo = await pg.evaluate("({ good: !!document.querySelector('#fb .feedback.good'), note: (document.querySelector('#fb .also-common') || {}).textContent, score: __app.run.score, total: __app.run.total, mode: __app.run.mode })")
        check(wo['mode'] == 'test' and wo['good'] and wo['score'] == 1 and wo['total'] == 1 and (wo['note'] or '').startswith('Also common: La segunda etapa todavía no tiene fecha de entrega'),
              f"unit test: “La segunda etapa no tiene fecha de entrega todavía” gets the mark + “{wo['note']}”")
        if ENGINE == 'webkit': await pg.wait_for_timeout(900); await pg.screenshot(path=f'{OUT}/v96-word-order.png')
        await pg.click('#next'); await pg.wait_for_timeout(200)
        await pg.evaluate(f"(() => {{ const r = __app.run; r.answered = false; r.queue[r.i] = {{ id: 'w:etapa', ex: 'build', sent: {json.dumps(sent)}, key: 999002 }}; __app.forceEx('build', {json.dumps(sent)}); }})()")
        await pg.wait_for_selector('#tiles .tile')
        await build('La segunda etapa tiene no fecha de entrega todavía')
        check(await pg.query_selector('#fb .feedback.miss') is not None, 'a broken “no + verb” order is still wrong')
        await pg.click('#next'); await pg.wait_for_timeout(150); await pg.click('#quit'); await pg.wait_for_selector('.stone')
        check(not errs, f'no page errors {errs[:3]}')
        await b.close()
    print('ALL PASS' if ok_all else 'SOME FAILED'); sys.exit(0 if ok_all else 1)

asyncio.run(main())
