import asyncio, json, sys
from playwright.async_api import async_playwright
URL = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8787/'
OUT = '/workspace/spanish-app/screens'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=3, is_mobile=True, has_touch=True)
        page = await ctx.new_page(); errors = []
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        page.on('pageerror', lambda e: errors.append(str(e)))
        await page.goto(URL); await page.wait_for_selector('#go')
        # simulate an existing v1 user: old settings without sound/anim keys
        old = await page.evaluate("""(() => { const s = __app.state; s.placementDone = true; s.items['w:fuga'] = {s: 50, d: 3, reps: 4, lapses: 0, last: Date.now(), due: Date.now() + 40*864e5};
            const o = JSON.parse(JSON.stringify(s)); delete o.settings.sound; delete o.settings.anim; localStorage.setItem('spanish-app-state-v1', JSON.stringify(o)); return Object.keys(o.items).length; })()""")
        await page.reload(); await page.wait_for_selector('#go')
        st = await page.evaluate("({items: Object.keys(__app.state.items).length, fuga: __app.state.items['w:fuga'].s, sound: __app.state.settings.sound, anim: __app.state.settings.anim})")
        print('migrated old state:', st, '(items before:', old, ')')
        await page.click('#go')
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
            else:
                if right: await page.fill('#ans', ex['answers'][0]); await page.click('#check')
                else: await page.click('#skip')
            tag = 'ok' if right else 'bad'
            if not shots[tag]:
                await page.wait_for_timeout(120); await page.screenshot(path=f'{OUT}/fx-{tag}.png'); shots[tag] = True
                cls = await page.evaluate("document.querySelector('main.card').className")
                print(f'{tag} card classes:', cls)
            await page.click('#next')
        done = await page.query_selector('h1:has-text("Done for now")')
        await page.wait_for_timeout(250)
        layer = await page.query_selector('.fx-layer')
        await page.screenshot(path=f'{OUT}/fx-done-confetti.png')
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
