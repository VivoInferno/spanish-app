import re
import asyncio, json, sys
from playwright.async_api import async_playwright
URL = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8787/'
ENGINE = sys.argv[2] if len(sys.argv) > 2 else 'chromium'
OUT = '/workspace/spanish-app/screens'
async def main():
    async with async_playwright() as p:
        if ENGINE == 'webkit':
            b = await p.webkit.launch(); dev = dict(p.devices['iPhone 15']); ctx = await b.new_context(**dev)
        else:
            b = await p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
            ctx = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=3, is_mobile=True, has_touch=True)
        print('engine:', ENGINE, b.version)
        page = await ctx.new_page(); errors = []
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        page.on('pageerror', lambda e: errors.append(str(e)))
        await page.goto(URL); await page.wait_for_selector('#go')
        # simulate an existing v1 user: old settings without sound/anim keys
        old = await page.evaluate("""(() => { const s = __app.state; s.placementDone = true; s.items['w:fuga'] = {s: 50, d: 3, reps: 4, lapses: 0, last: Date.now(), due: Date.now() + 40*864e5};
            ['tramite','cita','recibo','entregar','comprobante'].forEach(w => s.items['w:' + w] = {s: 2, d: 5, reps: 1, lapses: 0, last: Date.now() - 3*864e5, due: Date.now() - 1000});
            s.items['p:por_para'] = {s: 2, d: 5, reps: 1, lapses: 0, last: Date.now() - 3*864e5, due: Date.now() - 1000};
            const o = JSON.parse(JSON.stringify(s)); delete o.settings.sound; delete o.settings.anim; localStorage.setItem('spanish-app-state-v1', JSON.stringify(o)); return Object.keys(o.items).length; })()""")
        await page.reload(); await page.wait_for_selector('#review')
        st = await page.evaluate("({items: Object.keys(__app.state.items).length, fuga: __app.state.items['w:fuga'].s, sound: __app.state.settings.sound, anim: __app.state.settings.anim})")
        print('migrated old state:', st, '(items before:', old, ')')
        await page.click('#review')
        audio = await page.evaluate("typeof FX === 'object'")
        shots = {'ok': False, 'bad': False}; k = 0
        for i in range(300):
            if await page.query_selector('h1:has-text("Done for now")'): break
            e = await page.evaluate("__app.entry")
            if e and e.get('intro'): await page.click('#go'); continue
            ex = await page.evaluate("({kind: __app.ex.kind, answer: __app.ex.answer, answers: __app.ex.answers})")
            right = (k % 4 != 1); k += 1
            if ex['kind'] == 'mc':
                opts = await page.query_selector_all('.opt'); texts = [await o.inner_text() for o in opts]
                await opts[texts.index(ex['answer']) if right else next(j for j, t in enumerate(texts) if t != ex['answer'])].click()
            elif ex['kind'] == 'build':  # v7: tile drills now show up in review too
                if right:
                    tl = await page.evaluate("__app.ex.tiles"); used = []
                    for wt in re.sub(r'[¿?¡!.,;:“”"]', '', ex['answers'][0]).split():
                        for j, t in enumerate(tl):
                            if j not in used and t == wt: used.append(j); await page.click(f'#tiles .tile[data-k="{j}"]'); break
                    await page.click('#check')
                else: await page.click('#skip')
            else:
                if right: await page.fill('#ans', ex['answers'][0]); await page.click('#check')
                else: await page.click('#skip')
            tag = 'ok' if right else 'bad'
            live = await page.evaluate("document.getAnimations().map(a => a.animationName).filter(Boolean)")
            if not shots[tag]: print(f'{tag} running animations:', sorted(set(live)))
            if not shots[tag]:
                await page.wait_for_timeout(120); await page.screenshot(path=f'{OUT}/fx-{ENGINE}-{tag}.png'); shots[tag] = True
                cls = await page.evaluate("document.querySelector('main.card').className")
                print(f'{tag} card classes:', cls)
            await page.click('#next')
            if k == 1:
                anim = await page.evaluate("(() => { const c = document.querySelector('main.card'); return {reduced: matchMedia('(prefers-reduced-motion: reduce)').matches, noAnimClass: document.documentElement.classList.contains('no-anim'), cardAnimations: c.getAnimations().map(a => a.animationName || a.constructor.name)}; })()")
                print('animations on next card:', anim)
        done = await page.query_selector('h1:has-text("Done for now")')
        await page.wait_for_timeout(250)
        layer = await page.query_selector('.fx-layer')
        await page.screenshot(path=f'{OUT}/fx-{ENGINE}-done-confetti.png')
        await page.wait_for_timeout(1000)
        gone = not await page.query_selector('.fx-layer')
        print('session finished:', bool(done), '| confetti shown:', bool(layer), '| confetti removed <1s after:', gone)
        ac = await page.evaluate("(() => { try { return !!(window.AudioContext||window.webkitAudioContext); } catch(e) { return false } })()")
        print('FX loaded:', audio, '| AudioContext available:', ac)
        # toggles
        await page.click('#prog'); await page.uncheck('#anim'); await page.uncheck('#snd')
        print('toggles persisted:', await page.evaluate("JSON.parse(localStorage.getItem('spanish-app-state-v1')).settings"), '| no-anim class:', await page.evaluate("document.documentElement.classList.contains('no-anim')"))
        await page.check('#anim'); await page.check('#snd')
        sw = await page.evaluate("navigator.serviceWorker.ready.then(r => r.active && r.active.scriptURL)")
        print('SW:', sw, '| console errors:', errors or 'none')
        await b.close()
asyncio.run(main())
