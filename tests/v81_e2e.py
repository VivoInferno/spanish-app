"""v8.1: Mónica is the main voice on Colby's iPhone list (Angélica only if iOS ever exposes her), Paulina is the second story voice,
3+ characters cycle voices with pitch 0.9/1.1, one installed voice = pitch only; 'Second voice' setting with Test; lossless v8 → v8.1."""
import asyncio, json, sys, os
src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'v8_e2e.py')).read().split('async def main')[0]
exec(src)  # URL, ENGINE, shot(), check(), new_ctx() with recogniser + voice mocks

async def ctx_with(b, p, voices, fixture):
    ctx = await new_ctx(b, p, fixture)
    await ctx.add_init_script(f"window.__voiceList = {json.dumps(voices)}")
    pg = await ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    await pg.goto(URL); await pg.wait_for_selector('.stone'); await pg.wait_for_timeout(800)
    return ctx, pg, errs

async def story_voices(pg, uid):
    """walk a story (skipping drills) and return {speaker: set((voice, pitch))} from the lines it auto-played"""
    await pg.evaluate("__spoken.length = 0"); await pg.evaluate(f"__app.openStone('{uid}', 1)"); await pg.wait_for_selector('.story')
    for _ in range(80):
        if await pg.query_selector('.stone'): break
        if await pg.query_selector('#ssay #mic'): await pg.click('#skip'); continue
        if await pg.query_selector('.squestion .opt') and not await pg.query_selector('.squestion .opt.right'): await pg.locator('.squestion .opt').first.click()
        elif await pg.query_selector('#stile') and await pg.query_selector('#skip'): await pg.click('#skip')
        if await pg.query_selector('#next'): await pg.click('#next')
    lines = await pg.evaluate(f"__app.content.units.find(u => u.id === '{uid}').story.lines")
    spoken = await pg.evaluate("__spoken")
    out = {}
    for l in lines:
        hit = [s for s in spoken if s['text'] == l['es']]
        if hit: out.setdefault(l['s'] or '(narrator)', set()).add((hit[0]['voice'], round(hit[0]['pitch'] or 1, 2)))
    return out

async def main():
    async with async_playwright() as p:
        b = await (p.webkit if ENGINE == 'webkit' else p.chromium).launch()
        V7 = strip_meta(json.load(open(FIX + 'v7-export.json')))
        V8 = dict(V7, settings=dict(V7['settings'], voice='', anim=False)); V8['schema'] = 5; V8['speakPauseUntil'] = 0
        IPHONE = [['Mónica', 'es-ES'], ['Paulina', 'es-MX'], ['Samantha', 'en-US']]
        ctx, pg, errs = await ctx_with(b, p, IPHONE, V8)
        s = await pg.evaluate("__app.state")
        check(await pg.evaluate("__app.version") == 'v9.3' and s['items'] == V8['items'] and s['daily'] == V8['daily'] and s['streak'] == V8['streak'] and s['settings']['voice2'] == '' and s['settings']['anim'] is False and s['schema'] == 5,
              'v8 data → v8.1 losslessly (items, daily, streak, settings kept; voice2 added)')
        check(await pg.evaluate("[__app.voice && __app.voice.name, __app.voice2 && __app.voice2.name]") == ['Mónica', 'Paulina'], 'iPhone list: main voice Mónica, second voice Paulina')
        cast = await pg.evaluate("(() => { __app.openStone('u10', 1); const r = {}; [null, 'Mark', 'Don Rafa', 'Doña Chela'].forEach(s => r[s || '(narrator)'] = __app.storyVoice(s)); return r; })()")
        check(cast['(narrator)'] == {'voice': 'Mónica', 'pitch': 1} and cast['Mark'] == {'voice': 'Mónica', 'pitch': 1} and cast['Don Rafa'] == {'voice': 'Paulina', 'pitch': 1} and cast['Doña Chela'] == {'voice': 'Mónica', 'pitch': 0.9},
              f'cast: narrator + 1st character Mónica, 2nd Paulina, 3rd Mónica at pitch 0.9 ({cast})')
        await pg.click('#quit'); await pg.wait_for_selector('.stone')
        sv = await story_voices(pg, 'u10')
        check(sv.get('Don Rafa') == {('Paulina', 1)} and sv.get('(narrator)') == {('Mónica', 1)} and all(v == {('Mónica', 0.9)} for k, v in sv.items() if k == 'Doña Chela'), f'story lines play with their speaker voices ({sv})')
        sv2 = await story_voices(pg, 'u2')
        check(sv2.get('Plomero') == {('Paulina', 1)} and sv2.get('Andrés') == {('Mónica', 1)}, f'two-character story: Andrés Mónica, Plomero Paulina ({sv2})')
        # tapping a line's speaker button uses the same voice
        await pg.evaluate("__app.openStone('u2', 1)"); await pg.wait_for_selector('.story')
        for _ in range(40):
            if await pg.query_selector('[data-spk="Plomero"]'): break
            if await pg.query_selector('#ssay #mic') or (await pg.query_selector('#stile') and await pg.query_selector('#skip')): await pg.click('#skip')
            elif await pg.query_selector('.squestion .opt') and not await pg.query_selector('.squestion .opt.right'): await pg.locator('.squestion .opt').first.click()
            elif await pg.query_selector('#next'): await pg.click('#next')
            await pg.wait_for_timeout(60)
        btn = pg.locator('[data-spk="Plomero"]').first
        found = await btn.count() > 0
        if found: await btn.click(); await pg.wait_for_timeout(100)
        check(found and await pg.evaluate("__spoken.slice(-1)[0].voice") == 'Paulina', 'tapping 🔊 on the plumber\'s line replays it in Paulina')
        await pg.click('#quit'); await pg.wait_for_selector('.stone')
        # drills stay on the main voice
        await pg.evaluate("__app.openStone('u10', 0)"); await pg.click('#go'); await pg.wait_for_timeout(200)
        check(await pg.evaluate("__spoken.slice(-1)[0].voice") == 'Mónica', 'lesson audio uses Mónica')
        await pg.click('#quit'); await pg.wait_for_selector('.stone')
        # Settings: second voice
        await pg.click('#prog'); await pg.wait_for_selector('#voice2Sel')
        o2 = await pg.evaluate("[...document.querySelectorAll('#voice2Sel option')].map(o => o.textContent.trim())")
        check(len(o2) == 2 and o2[0].startswith('Automatic') and 'Paulina' in o2[0] and o2[1].startswith('Paulina'), f'Second voice picker lists the other Spanish voices ({o2})')
        await pg.click('#voice2Test'); check(await pg.evaluate("__spoken.slice(-1)[0].voice") == 'Paulina', 'Second voice Test plays Paulina')
        await pg.locator('#voiceSel').scroll_into_view_if_needed(); await pg.evaluate("document.getElementById('voiceSel').closest('.set').scrollIntoView({block: 'center'})"); await pg.wait_for_timeout(200)
        if ENGINE == 'webkit': await pg.screenshot(path=f'{OUT}/v81-voices.png')
        await pg.select_option('#voiceSel', 'Paulina'); await pg.wait_for_timeout(150)
        v = await pg.evaluate("[__app.voice.name, __app.voice2 && __app.voice2.name, __app.state.settings.voice2]")
        check(v == ['Paulina', 'Mónica', ''], f'main = Paulina makes the automatic second voice Mónica ({v})')
        await pg.select_option('#voiceSel', ''); await pg.wait_for_timeout(150)
        check(await pg.evaluate("[__app.voice.name, __app.voice2.name]") == ['Mónica', 'Paulina'], 'back to automatic: Mónica + Paulina')
        await pg.reload(); await pg.wait_for_selector('.stone'); await pg.wait_for_timeout(700)
        check(await pg.evaluate("__app.voice2 && __app.voice2.name") == 'Paulina', 'second voice survives reload')
        await ctx.close()
        # one voice installed: pitch only
        ctx, pg, errs2 = await ctx_with(b, p, [['Paulina', 'es-MX']], V8)
        cast = await pg.evaluate("(() => { __app.openStone('u10', 1); const r = {}; [null, 'Mark', 'Don Rafa', 'Doña Chela'].forEach(s => r[s || '(narrator)'] = __app.storyVoice(s)); return r; })()")
        pitches = [cast[k]['pitch'] for k in ['(narrator)', 'Mark', 'Don Rafa', 'Doña Chela']]
        check(all(c['voice'] == 'Paulina' for c in cast.values()) and len(set(pitches)) == 4, f'one voice: everyone Paulina, distinct pitches {pitches}')
        await ctx.close()
        # Angélica if iOS ever exposes her; Monica spelled without accent still wins over Paulina
        ctx, pg, errs3 = await ctx_with(b, p, [['Paulina', 'es-MX'], ['Monica', 'es-ES'], ['Angélica (Enhanced)', 'es-MX']], V8)
        check(await pg.evaluate("[__app.voice.name, __app.voice2.name]") == ['Angélica (Enhanced)', 'Paulina'], 'Angélica first if present, Paulina second')
        await ctx.close()
        ctx, pg, errs4 = await ctx_with(b, p, [['Paulina', 'es-MX'], ['Monica', 'es-ES']], V8)
        check(await pg.evaluate("__app.voice.name") == 'Monica', '"Monica" (no accent) beats Paulina')
        await ctx.close()
        allerr = errs + errs2 + errs3 + errs4
        check(not allerr, f'no page errors {allerr[:3]}')
        await b.close()
    print('\nALL PASS' if ok_all else '\nSOME CHECKS FAILED'); sys.exit(0 if ok_all else 1)
asyncio.run(main())
