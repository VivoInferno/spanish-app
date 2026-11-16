"""v9.4 grammar teaching layer: a rule card on a pattern's first exposure (intro or later), then easy one-contrast drills
before the full mix; a 📘 Rule button on grammar drills; a Grammar rules list in Progress; "why" after every grammar answer,
plus why the pick was wrong. None of it in placement or the unit test except the why after answering. Lossless v9.x → v9.4.
Screenshots (WebKit iPhone 15): screens/v94-rule-card.png, screens/v94-why.png."""
import asyncio, json, sys, os, re
src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'v8_e2e.py')).read().split('async def main')[0]
exec(src)

async def tap(pg, loc):
    await loc.scroll_into_view_if_needed(); bb = await loc.bounding_box()
    await pg.mouse.click(bb['x'] + bb['width'] / 2, bb['y'] + bb['height'] / 2); await pg.wait_for_timeout(120)

async def put(pg, entry):  # put an entry on the current card and go through nextCard (as a real session would)
    await pg.evaluate(f"(() => {{ const r = __app.run; r.answered = false; r.queue[r.i] = {json.dumps(entry)}; __app.nextCard(); }})()")
    await pg.wait_for_timeout(200)

async def main():
    async with async_playwright() as p:
        b = await (p.webkit if ENGINE == 'webkit' else p.chromium).launch()
        V7 = strip_meta(json.load(open(FIX + 'v7-export.json')))
        V9 = dict(V7, settings=dict(V7['settings'], voice='', voice2='', voiceMode='recorded', anim=True)); V9['schema'] = 5; V9['speakPauseUntil'] = 0
        ctx = await new_ctx(b, p, V9, sr=False)
        pg = await ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(URL); await pg.wait_for_selector('.stone'); await pg.wait_for_timeout(400)
        s = await pg.evaluate("__app.state")
        check(await pg.evaluate("__app.version") == 'v9.4' and s['items'] == V9['items'] and s['path'] == V9['path'] and s['daily'] == V9['daily'] and s['streak'] == V9['streak']
              and s['rulesSeen'] == {} and s['pace'] == {}, 'v9.x data → v9.4 losslessly (no rule cards seen yet)')
        n_rules = await pg.evaluate("Object.values(__app.content.patterns).filter(p => p.rule).length")
        n_pat = await pg.evaluate("Object.keys(__app.content.patterns).length")
        check(n_rules == n_pat, f'{n_rules} rule cards for {n_pat} grammar patterns')

        # ---------- 1. first exposure in practice → rule card, then paced drills ----------
        await pg.evaluate("__app.openStone('u3', 2)"); await pg.wait_for_selector('.card'); await pg.wait_for_timeout(200)
        await put(pg, {'id': 'p:subj'})
        rc = await pg.evaluate("(() => { const c = document.querySelector('.rule-step .rule-card'); return c && { title: c.querySelector('.rule-title').textContent, f: c.querySelector('.rule-formula').textContent, ex: c.querySelectorAll('.example').length, trap: !!c.querySelector('.rule-trap'), go: !!document.getElementById('go'), opts: document.querySelectorAll('.opt').length }; })()")
        check(await pg.evaluate("!!__app.entry.rule"), '__app.entry reports the rule step')
        check(rc and 'Está vs esté' in rc['title'] and 'WEIRDO' in rc['f'] and rc['ex'] >= 2 and rc['trap'] and rc['go'] and rc['opts'] == 0,
              f'first time subj comes up: its rule card shows before any drill ({rc and rc["title"]}, {rc and rc["ex"]} examples, trap note)')
        if ENGINE == 'webkit': await pg.wait_for_timeout(600); await pg.screenshot(path=f'{OUT}/v94-rule-card.png')
        await pg.click('#go'); await pg.wait_for_selector('.opt'); await pg.wait_for_timeout(200)
        st = await pg.evaluate("({ seen: !!__app.state.rulesSeen.subj, pace: __app.state.pace.subj, kind: __app.ex.kind, paced: !!__app.ex.paced, n: __app.ex.options.length, easy: !!__app.ex.item.easy, label: document.querySelector('.label').textContent, next: __app.run.queue.slice(__app.run.i, __app.run.i + 3).map(e => e.id) })")
        check(st['seen'] and st['paced'] and st['n'] == 2 and st['easy'] and 'one contrast' in st['label'] and st['next'] == ['p:subj'] * 3,
              f'Continue → an easy one-contrast drill (2 options), with 3 subj drills in a row ({st})')
        # answer it wrong → why + why the pick was wrong
        wrong = await pg.evaluate("__app.ex.options.find(o => o !== __app.ex.answer)")
        await pg.click(f'.opt[data-lp="{wrong}"]'); await pg.wait_for_selector('#fb .feedback')
        fb = await pg.evaluate("(() => { const f = document.querySelector('#fb .feedback'); return { why: (f.querySelector('.why') || {}).textContent, wrong: (f.querySelector('.why-wrong') || {}).textContent, rule: !!f.querySelector('.rule-link'), n: __app.ex.item.n, w: __app.ex.item.w[" + json.dumps(wrong) + "] }; })()")
        check(fb['why'] == 'Why: ' + fb['n'] and fb['wrong'] and wrong in fb['wrong'] and fb['w'] in fb['wrong'] and fb['rule'],
              f'wrong answer: “Why: …” for the sentence + why “{wrong}” was wrong + 📘 Rule ({fb["wrong"]})')
        if ENGINE == 'webkit': await pg.wait_for_timeout(900); await pg.screenshot(path=f'{OUT}/v94-why.png')
        await pg.wait_for_timeout(500); await pg.click('#next'); await pg.wait_for_selector('.opt'); await pg.wait_for_timeout(200)
        st2 = await pg.evaluate("({ pace: __app.state.pace.subj, paced: !!__app.ex.paced, n: __app.ex.options.length })")
        check(st2['paced'] and st2['n'] == 2 and st2['pace'] == 1, f'second drill is still one-contrast ({st2})')
        await pg.click(f'.opt[data-lp="{await pg.evaluate("__app.ex.answer")}"]'); await pg.wait_for_selector('#fb .feedback')
        okfb = await pg.evaluate("({ why: !!document.querySelector('#fb .why'), wrong: !!document.querySelector('#fb .why-wrong') })")
        check(okfb['why'] and not okfb['wrong'], 'right answer: still a one-line why (no "your pick" line)')
        await pg.wait_for_timeout(500); await pg.click('#next'); await pg.wait_for_timeout(300)
        st3 = await pg.evaluate("({ pace: __app.state.pace.subj, paced: !!(__app.ex && __app.ex.paced), kind: __app.ex && __app.ex.kind, n: __app.ex && __app.ex.options ? __app.ex.options.length : null, id: __app.entry.id })")
        check(st3['id'] == 'p:subj' and st3['pace'] == 0 and not st3['paced'] and (st3['kind'] != 'mc' or st3['n'] == 4), f'third drill mixes again (full options / tiles / say it) ({st3})')
        # the 📘 Rule button on a drill opens the card again
        await pg.evaluate("(() => { const r = __app.run; r.answered = false; r.queue[r.i] = { id: 'p:subj' }; __app.forceEx('mc'); })()"); await pg.wait_for_selector('#ruleBtn')
        await pg.click('#ruleBtn'); await pg.wait_for_selector('#ruleModal .rule-card')
        check('Está vs esté' in await pg.inner_text('#ruleModal .rule-title') and await pg.evaluate("!__app.run.answered"), '📘 Rule on a drill opens the rule card (nothing answered)')
        await pg.click('#ruleClose'); check(await pg.query_selector('#ruleModal') is None, 'Got it closes it')
        # seen once → no card the next time
        await put(pg, {'id': 'p:subj'})
        check(await pg.query_selector('.rule-step') is None and await pg.evaluate("!!__app.ex && __app.ex.pk === 'subj' && !__app.entry.rule"), 'second exposure: straight to the drill')
        # tiles reply with the wrong pronoun → why + reason for that option
        idx = await pg.evaluate("__app.content.patterns.clitic_usted.items.findIndex(it => it.q.startsWith('¿Me manda el contrato?'))")
        await pg.evaluate("__app.state.rulesSeen.clitic_usted = 1")
        await pg.evaluate(f"(() => {{ const r = __app.run; r.answered = false; r.queue[r.i] = {{ id: 'p:clitic_usted', itemIdx: {idx} }}; __app.forceEx('ptiles'); }})()"); await pg.wait_for_selector('#tiles .tile')
        tiles = await pg.evaluate("__app.ex.tiles")
        d = next((x for x in ('te', 'le', 'la') if x in tiles), None)
        seq = ['Sí', 'ahorita'] + ([d, 'lo'] if d in ('te', 'le') else ['se', d]) + ['mando']
        for wd in seq:
            k = await pg.evaluate(f"__app.ex.tiles.findIndex((t, k) => t === {json.dumps(wd)} && !__app.ex.order.includes(k))")
            await tap(pg, pg.locator(f'#tiles .tile[data-k="{k}"]'))
        await pg.wait_for_timeout(300); await pg.click('#check'); await pg.wait_for_selector('#fb .feedback')
        ww = await pg.evaluate("(document.querySelector('#fb .why-wrong') || {}).textContent || ''")
        opt = ' '.join(seq[2:4])
        check(await pg.query_selector('#fb .feedback.miss') is not None and opt in ww and len(ww) > 25, f'tiles: building “{" ".join(seq)}” explains why “{opt}” is wrong ({ww})')
        await pg.click('#quit'); await pg.wait_for_selector('.stone')

        # ---------- 2. a new pattern in a unit's intro → the rule card is the teach step ----------
        await pg.evaluate("__app.openStone('u1', 0)"); await pg.wait_for_timeout(300)
        await pg.evaluate("(() => { const r = __app.run; r.queue.splice(r.i, 0, { id: 'p:clitic_future', intro: true }, { id: 'p:clitic_future' }, { id: 'p:clitic_future', practice: true }); __app.nextCard(); })()")
        await pg.wait_for_selector('.rule-step')
        t = await pg.evaluate("document.querySelector('.rule-step .rule-title').textContent")
        check('Se vs le' in t, f'intro: new pattern clitic_future shows its rule card ({t})')
        await pg.click('#go'); await pg.wait_for_selector('.opt'); await pg.wait_for_timeout(150)
        st = await pg.evaluate("({ paced: !!__app.ex.paced, opts: __app.ex.options, run: __app.run.queue.slice(__app.run.i, __app.run.i + 3).map(e => e.id) })")
        check(st['paced'] and len(st['opts']) == 2 and st['run'] == ['p:clitic_future'] * 3, f'…then the easy se vs le contrast first ({st["opts"]})')
        await pg.click('#quit'); await pg.wait_for_selector('.stone')

        # ---------- 3. unit test: no rule card / Rule button before answering, why after ----------
        await pg.evaluate("delete __app.state.rulesSeen.comparatives")
        await pg.evaluate("__app.openStone('ta5', 3)"); await pg.wait_for_selector('.card'); await pg.wait_for_timeout(200)
        await put(pg, {'id': 'p:comparatives'})
        tt = await pg.evaluate("({ step: !!document.querySelector('.rule-step'), btn: !!document.getElementById('ruleBtn'), opts: document.querySelectorAll('.opt').length })")
        check(not tt['step'] and not tt['btn'] and tt['opts'] == 4, f'unit test: no rule card and no 📘 Rule before answering ({tt})')
        await pg.click(f'.opt[data-lp="{await pg.evaluate("__app.ex.answer")}"]'); await pg.wait_for_selector('#fb .feedback')
        check(await pg.query_selector('#fb .why') is not None, 'unit test: the why still shows after answering')
        await pg.click('#quit'); await pg.wait_for_selector('.stone')

        # ---------- 4. Progress: Grammar rules list ----------
        await pg.click('#prog'); await pg.wait_for_selector('.rules-list')
        n = await pg.evaluate("document.querySelectorAll('.rules-list [data-rule]').length")
        await pg.click('.rules-list [data-rule="ser_estar"]'); await pg.wait_for_selector('#ruleModal .rule-card')
        check(n == n_pat and 'Ser vs estar' in await pg.inner_text('#ruleModal .rule-title'), f'Progress → 📘 Grammar rules lists all {n} cards; tapping one opens it')
        await pg.click('#ruleClose')

        # ---------- 5. story grammar question: why + why the pick was wrong ----------
        await pg.click('#back'); await pg.wait_for_selector('.stone')
        await pg.evaluate("__app.openStone('ta1', 1)"); await pg.wait_for_timeout(400)
        qs = await pg.evaluate("__app.content.units.find(u => u.id === 'ta1').story.qs")
        got = None
        for _ in range(60):
            if await pg.query_selector('.squestion .opt') and not await pg.query_selector('.squestion .opt.right'):
                opts = await pg.evaluate("[...document.querySelectorAll('.squestion .opt')].map(b => b.dataset.o)")
                q = next(x for x in qs if sorted(x['o']) == sorted(opts))
                if q.get('p'):
                    await pg.click(f'.squestion .opt[data-o="{q["o"][1]}"]'); await pg.wait_for_selector('.sq-why')
                    got = (q['o'][1], await pg.inner_text('.sq-why')); break
                await pg.click(f'.squestion .opt[data-o="{q["o"][0]}"]'); await pg.wait_for_timeout(200)
            nx = await pg.query_selector('#next')
            if not nx: break
            await pg.wait_for_timeout(450); await nx.click(); await pg.wait_for_timeout(250)
        check(got and 'Why:' in got[1] and f'Not “{got[0]}”' in got[1], f'story grammar question: why + why “{got and got[0]}” is wrong ({got and got[1][:120]})')
        check(not errs, f'no page errors {errs[:2]}')
        await b.close()
    print('\nALL PASS' if ok_all else '\nSOME CHECKS FAILED'); sys.exit(0 if ok_all else 1)
asyncio.run(main())
