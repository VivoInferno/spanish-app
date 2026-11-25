"""v9.7 new-word repetition: a unit has 5 stones — New words, Word practice, Story, Practice, Unit test.
New words: meet each new word + a quick check, then 12-18 drills on ONLY the new words (each comes back 3+ times in
different formats: picker, listen-and-pick, tiles, typed, say-it…). No grammar there any more. Word practice: 14 drills,
~65% this unit's words / ~35% earlier words (due + weak first), sentence level, no grammar. Grammar is introduced in
Practice (v9.6 focus). Migration: units already past New words get Word practice marked done; nobody is sent backward.
Screenshots (WebKit iPhone 15): screens/v97-path.png (5-stone path), screens/v97-new-words-drill.png."""
import asyncio, json, sys, os, re
src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'v8_e2e.py')).read().split('async def main')[0]
exec(src)

async def answer(pg, right=True):
    e = await pg.evaluate("__app.run && __app.entry")
    if not e: return None
    if e.get('theme') or e.get('intro') or e.get('rule'):
        await pg.click('#go'); await pg.wait_for_timeout(120); return 'step'
    ex = await pg.evaluate("({kind: __app.ex.kind, answer: __app.ex.answer, answers: __app.ex.answers, tiles: __app.ex.tiles, pk: __app.ex.pk || null, label: __app.ex.label, listenPick: !!__app.ex.listenPick})")
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
    return dict(ex, id=e['id'], retry=e.get('retry'), ex=e.get('ex'))

async def main():
    async with async_playwright() as p:
        b = await (p.webkit if ENGINE == 'webkit' else p.chromium).launch()
        V7 = strip_meta(json.load(open(FIX + 'v7-export.json')))
        V96 = dict(V7, settings=dict(V7['settings'], voice='', voice2='', voiceMode='recorded', anim=True)); V96['schema'] = 5; V96['speakPauseUntil'] = 0
        V96['parked'] = {'g:costera': {'at': 1, 'word': 'costera'}}; V96['rulesSeen'] = {}; V96['pace'] = {}; V96['focusLog'] = ['ser_estar']
        V96['path'] = json.loads(json.dumps(V7['path'])); V96['path']['done']['ta1'] = [True, True, True, True]  # path order: u1 u2 ta1 u3 u4 ta2 u5 …
        V96['hidden'] = [{'id': 'w:x', 'kind': 'easy', 'at': 1}]
        ctx = await new_ctx(b, p, V96, sr=False)
        pg = await ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(URL); await pg.wait_for_selector('.stone'); await pg.wait_for_timeout(400)

        # ---------- 1. migration ----------
        s = await pg.evaluate("__app.state")
        check(await pg.evaluate("__app.version") == 'v9.7' and s['items'] == V96['items'] and s['path'] == V96['path'] and s['daily'] == V96['daily']
              and s['streak'] == V96['streak'] and s['parked'] == V96['parked'] and s['hidden'] == V96['hidden'] and s['focusLog'] == ['ser_estar'],
              'v9.6 data → v9.7 losslessly (items, path, tests, daily, streak, parks, hidden, focusLog untouched)')
        check(sorted(s['wordPractice'].keys()) == ['ta1', 'u1', 'u2', 'u3', 'u4'] and s['wpMigrated'] == 1,
              f"units already past New words (u1 u2 ta1 u3 done, u4 on Story) get Word practice marked done ({sorted(s['wordPractice'].keys())})")
        cur = await pg.evaluate("__app.currentPos()")
        check(cur == {'uid': 'u4', 'stone': 1}, f'u4 keeps its place: Story is still the current stone, not sent back to Word practice ({cur})')
        ui = await pg.evaluate("""(() => { const st = u => [...document.querySelectorAll('#unit-' + u + ' .stone')].map(b => b.className.replace('stone ', '').trim());
            return { n: document.querySelectorAll('#unit-u1 .stone').length, labels: [...document.querySelectorAll('#unit-u4 .stone-label')].map(x => x.textContent.split(' · ')[0]), u4: st('u4'), u5: st('u5'), ds: [...document.querySelectorAll('#unit-u4 .stone')].map(b => b.dataset.s) }; })()""")
        check(ui['n'] == 5 and ui['labels'] == ['New words', 'Word practice', 'Story', 'Practice', 'Unit test'], f"every unit shows 5 stones in order ({ui['labels']})")
        check(ui['u4'] == ['done', 'done', 'current', 'locked', 'locked'] and all(x == 'locked' for x in ui['u5']), f"u4: ✓ ✓ Story(current) 🔒 🔒 ({ui['u4']})")
        await pg.evaluate("__app.state.wordPractice = { u1: 1, u2: 1, ta1: 1, u3: 1 }; __app.persist && __app.persist(); localStorage.setItem('spanish-app-state-v1', JSON.stringify(__app.state))")
        await pg.reload(); await pg.wait_for_selector('.stone'); await pg.wait_for_timeout(300)
        s2 = await pg.evaluate("({ wp: __app.state.wordPractice, cur: __app.currentPos() })")
        check(sorted(s2['wp'].keys()) == ['ta1', 'u1', 'u2', 'u3'] and s2['cur'] == {'uid': 'u4', 'stone': 'w'}, f"migration runs once: a later state is kept as saved ({s2['cur']})")
        # a unit still on New words gets the new stone next (fresh install / never migrated)
        mig = await pg.evaluate("""(() => { const raw = JSON.parse(localStorage.getItem('spanish-app-state-v1')); return raw.wpMigrated; })()""")
        check(mig == 1, 'migration flag saved')
        await pg.click('#prog'); await pg.wait_for_timeout(250)
        prog = await pg.evaluate("[...document.querySelectorAll('.rowline > span:last-child')].slice(0, 5).map(x => x.textContent)")
        check(prog == ['5/5', '5/5', '5/5', '5/5', '1/5'], f'Progress counts stones out of 5 ({prog})')
        await pg.evaluate("document.querySelector('#quit, #back, .icon') && document.querySelector('#quit, #back, .icon').click()"); await pg.wait_for_timeout(200)

        # ---------- 2. New words queue (all units, nothing known) ----------
        nw = await pg.evaluate("""(() => { const S = __app.state, C = __app.content, saved = S.items; S.items = {}; const out = { bad: [], drills: [], fmts: {}, minRep: 99, adj: 0, checks: 0 };
          C.units.forEach(u => { for (let r = 0; r < 6; r++) {
            const q = __app.introQueue(u.id), ws = u.words.filter(w => !S.parked[w.id]).map(w => 'w:' + w.id);
            if (q.some(e => e.id && e.id.startsWith('p:'))) out.bad.push(u.id + ' grammar');
            if (q.some(e => e.id && !e.theme && !ws.includes(e.id))) out.bad.push(u.id + ' foreign word');
            const d = q.filter(e => e.words); out.drills.push(d.length);
            ws.forEach(id => { const n = d.filter(e => e.id === id).length; out.minRep = Math.min(out.minRep, n); const f = d.filter(e => e.id === id).map(e => e.ex); if (new Set(f).size < Math.min(3, f.length)) out.bad.push(u.id + ' same format ' + id); });
            d.forEach(e => out.fmts[e.ex] = (out.fmts[e.ex] || 0) + 1);
            for (let k = 1; k < d.length; k++) if (d[k].id === d[k - 1].id) out.adj++;
            ws.forEach(id => { const k = q.findIndex(e => e.id === id && e.intro); if (!(k > 0 && q[k + 1].id === id && /^pick/.test(q[k + 1].ex))) out.bad.push(u.id + ' no check after ' + id); });
          } }); S.items = saved; return out; })()""")
        check(not [x for x in nw['bad'] if 'grammar' in x], f"New words has NO grammar items (rule cards / pattern drills) in any unit")
        check(not [x for x in nw['bad'] if 'foreign' in x], 'New words drills use only this unit\'s new words')
        check(not [x for x in nw['bad'] if 'check' in x], 'each new word is introduced one at a time with a quick check right after')
        check(nw['minRep'] >= 3, f"every new word gets at least 3 drills after its intro + check (min {nw['minRep']})")
        check(min(nw['drills']) >= 12 and max(nw['drills']) <= 18, f"12-18 word drills per stone ({min(nw['drills'])}-{max(nw['drills'])})")
        check(not [x for x in nw['bad'] if 'format' in x] and all(nw['fmts'].get(f, 0) > 0 for f in ['pickListen', 'pick', 'pickEn', 'build', 'flip', 'speak']), f"each word comes back in different formats; all formats used ({nw['fmts']})")
        check(nw['adj'] == 0, f"the same word never twice in a row ({nw['adj']})")

        # ---------- 3. Word practice mix ----------
        wp = await pg.evaluate("""(() => { const S = __app.state, C = __app.content, now = Date.now(); const out = { bad: [], share: [], sizes: new Set() };
          C.units.forEach(u => { S.items = {}; C.units.forEach(x => x.words.forEach(w => S.items['w:' + w.id] = { s: 5, d: 5, due: now + 864e5 * 3, reps: 3, lapses: 0, last: now - 864e5, state: 2 }));
            for (let r = 0; r < 6; r++) { const q = __app.wordPracticeQueue(u.id), mine = new Set(u.words.map(w => 'w:' + w.id));
              out.sizes.add(q.length); if (q.some(e => e.id.startsWith('p:') || e.focus)) out.bad.push(u.id);
              if (C.units.indexOf(u) > 0) out.share.push(q.filter(e => mine.has(e.id)).length / q.length); } });
          out.sizes = [...out.sizes]; return out; })()""")
        check(wp['sizes'] == [14] and not wp['bad'], f"Word practice: always 14 drills, no grammar ({wp['sizes']}, {wp['bad'][:3]})")
        check(min(wp['share']) >= 0.6 and max(wp['share']) <= 0.7, f"~64% this unit's words, ~36% earlier words ({min(wp['share']):.2f}-{max(wp['share']):.2f})")
        pr = await pg.evaluate("""(() => { const S = __app.state, now = Date.now(), L = __app.content.sections.find(x => x.units).units; const C = __app.content, due = [C.units.find(u => u.id === 'u3').words[1].id, C.units.find(u => u.id === 'u1').words[2].id, C.units.find(u => u.id === 'ta1').words[0].id];
          due.forEach(w => Object.assign(S.items['w:' + w], { due: now - 5000 }));
          let hit = 0; for (let r = 0; r < 10; r++) { const q = __app.wordPracticeQueue('ta2').map(e => e.id.slice(2)); hit += due.every(w => q.includes(w)) ? 1 : 0; }
          const fm = {}; for (let r = 0; r < 10; r++) __app.wordPracticeQueue('ta2').forEach(e => fm[e.ex] = (fm[e.ex] || 0) + 1);
          return { due, hit, fm }; })()""")
        check(pr['hit'] == 10 and len(pr['due']) >= 2, f"earlier words that are due come first ({pr['due']})")
        sentLvl = sum(pr['fm'].get(f, 0) for f in ['build', 'buildEn', 'cloze', 'listenS', 'speak']) / sum(pr['fm'].values())
        check(sentLvl >= 0.55, f"mostly sentence level (tiles, cloze, sentence listening, say it): {sentLvl:.0%} {pr['fm']}")

        # ---------- 4. play New words on u5 in the UI ----------
        await pg.evaluate("""(() => { const S = __app.state; S.items = JSON.parse(JSON.stringify(%s)); S.path.done.u4 = [true, true, true, true]; S.wordPractice.u4 = 1; S.path.done.ta2 = [true, true, true, true]; S.wordPractice.ta2 = 1; S.rulesSeen = {}; localStorage.setItem('spanish-app-state-v1', JSON.stringify(S)); })()""" % json.dumps(V96['items']))
        await pg.reload(); await pg.wait_for_selector('.stone.current'); await pg.wait_for_timeout(500)
        cur = await pg.evaluate("__app.currentPos()")
        check(cur == {'uid': 'u5', 'stone': 0}, f'next unit starts at New words ({cur})')
        if ENGINE == 'webkit': await pg.wait_for_timeout(500); await pg.screenshot(path=f'{OUT}/v97-path.png')
        else: await pg.screenshot(path=f'{OUT}/v97-path-{ENGINE}.png')
        await pg.click('.stone.current'); await pg.wait_for_timeout(300)
        theme = await pg.evaluate("document.querySelector('main').innerText")
        check('Grammar focus' not in theme and 'comes later, in Practice' in theme, 'unit intro screen says grammar comes later, in Practice')
        reps0 = await pg.evaluate("Object.keys(__app.state.items).length")
        seen = []; rules = 0; shot_done = False; ns = set(); missed = 0
        for _ in range(120):
            e = await pg.evaluate("__app.run && __app.entry")
            if not e: break
            if e.get('rule') or (e.get('id', '').startswith('p:')): rules += 1
            if e.get('words'): ns.add(await pg.evaluate("__app.counts().n"))
            if not shot_done and e.get('words') and e.get('ex') in ('pickListen', 'build'):
                await pg.wait_for_timeout(400)
                if ENGINE == 'webkit': await pg.screenshot(path=f'{OUT}/v97-new-words-drill.png')
                else: await pg.screenshot(path=f'{OUT}/v97-new-words-drill-{ENGINE}.png')
                shot_done = True
            right = not (e.get('words') and not e.get('retry') and missed < 1 and (await pg.evaluate("__app.ex && __app.ex.kind")) == 'mc')
            if not right: missed += 1
            r = await answer(pg, right)
            if isinstance(r, dict): seen.append(r)
        check(rules == 0, f'no grammar rule card or grammar drill during New words ({rules})')
        check(len(ns) == 1 and missed == 1 and any(x.get('retry') for x in seen), f'fixed N with cycle-back: the miss came back at the end, N unchanged ({ns})')
        ids = [x['id'] for x in seen if not x.get('retry')]
        u5 = await pg.evaluate("__app.content.units.find(u => u.id === 'u5').words.filter(w => !__app.state.parked[w.id]).map(w => 'w:' + w.id)")
        fresh = [w for w in u5 if w in ids]
        check(fresh and min(ids.count(w) for w in fresh) >= 4, f'each new word answered 4+ times (check + 3 drills) ({ {w: ids.count(w) for w in fresh} })')
        check(any(x.get('listenPick') for x in seen) or await pg.evaluate("__app.listenPaused()"), 'listen-and-pick appeared')
        cur = await pg.evaluate("__app.currentPos()")
        check(cur == {'uid': 'u5', 'stone': 'w'} and await pg.query_selector('.stone.just-done') is not None, f'after New words, Word practice is next ({cur})')

        # ---------- 5. play Word practice ----------
        await pg.click('.stone.current'); await pg.wait_for_timeout(300)
        st = await pg.evaluate("({ mode: __app.run.mode, n: __app.counts().n })")
        check(st['mode'] == 'words' and st['n'] == 14, f'Word practice session: 14 drills ({st})')
        gseen = 0; missed = 0
        for _ in range(80):
            e = await pg.evaluate("__app.run && __app.entry")
            if not e: break
            if e.get('rule') or e.get('id', '').startswith('p:'): gseen += 1
            right = not (not e.get('retry') and missed < 1 and (await pg.evaluate("__app.ex && __app.ex.kind")) == 'mc')
            if not right: missed += 1
            await answer(pg, right)
        cur = await pg.evaluate("__app.currentPos()")
        check(gseen == 0 and cur == {'uid': 'u5', 'stone': 1}, f'no grammar in Word practice; Story is next ({cur})')

        # ---------- 6. grammar now introduced in Practice ----------
        await pg.evaluate("__app.state.focusLog = []")
        await pg.evaluate("__app.openStone('u5', 2)"); await pg.wait_for_timeout(300)
        st = await pg.evaluate("({ rule: !!(__app.entry && __app.entry.rule), focus: __app.run.focus, unitF: __app.content.units.find(u => u.id === 'u5').focus, q: __app.run.queue.filter(e => e.id && e.id.startsWith('w:')).map(e => e.id.slice(2)) })")
        u5w = await pg.evaluate("__app.content.units.find(u => u.id === 'u5').words.map(w => w.id)")
        check(st['rule'] and st['focus'] in st['unitF'], f"Practice opens with this unit's grammar rule card ({st['focus']})")
        check(sum(1 for w in st['q'] if w in u5w) >= 3, f"practice vocab favours this unit's new words ({sum(1 for w in st['q'] if w in u5w)}/{len(st['q'])})")
        await pg.click('#quit'); await pg.wait_for_selector('.stone')
        # review teaches a pattern still waiting when none is due
        rv = await pg.evaluate("""(() => { const S = __app.state, now = Date.now(); Object.keys(S.items).forEach(id => S.items[id].due = id.startsWith('p:') ? now + 864e5 * 9 : now - 1000);
            const C = __app.content, u = C.units.find(x => x.id === 'u4'); u.focus.forEach(p => delete S.items['p:' + p]); S.path.done.u4[2] = true;
            const q = __app.reviewQueue(); const f = q.find(e => e.focus); return { f: f && f.id.slice(2), uf: u.focus }; })()""")
        check(rv['f'] is not None, f"review with no pattern due teaches a pattern still waiting from a finished Practice ({rv})")
        check(not errs, f'no page errors {errs[:3]}')
        await b.close()
    print('ALL PASS' if ok_all else 'SOME FAILED'); sys.exit(0 if ok_all else 1)

asyncio.run(main())
