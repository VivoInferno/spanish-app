import asyncio, json, sys
from playwright.async_api import async_playwright
URL = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8787/'
OUT = '/workspace/spanish-app/screens'
async def main():
    import os; os.makedirs(OUT, exist_ok=True)
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=3, is_mobile=True, has_touch=True,
            user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')
        page = await ctx.new_page()
        errors = []
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        page.on('pageerror', lambda e: errors.append(str(e)))
        await page.goto(URL); await page.wait_for_selector('#go')
        await page.screenshot(path=f'{OUT}/01-placement-intro.png')
        sw = await page.evaluate("navigator.serviceWorker.ready.then(r => !!r.active)")
        print('service worker active:', sw)
        await page.click('#go')
        # placement: answer right on alternating items, so we get a mix
        k = 0; shot = False
        while True:
            if await page.query_selector('h1:has-text("Placement results")'): break
            ex = await page.evaluate("__app.ex && {kind: __app.ex.kind, answer: __app.ex.answer, answers: __app.ex.answers}")
            right = (k % 3 != 0)
            if ex['kind'] == 'mc':
                if not shot and k > 0:
                    await page.screenshot(path=f'{OUT}/02-placement-mc.png'); shot = True
                opts = await page.query_selector_all('.opt')
                texts = [await o.inner_text() for o in opts]
                idx = texts.index(ex['answer']) if right else next(i for i, t in enumerate(texts) if t != ex['answer'])
                await opts[idx].click()
            else:
                if right: await page.fill('#ans', ex['answers'][0]); await page.click('#check')
                else: await page.click('#skip')
            await page.click('#next'); k += 1
        print('placement items answered:', k)
        await page.screenshot(path=f'{OUT}/03-placement-results.png', full_page=True)
        await page.click('#go')
        # daily session: go through ~25 cards, typing answers without accents to test tolerance
        seen = {}; typed_shot = False; fb_shot = False
        for i in range(40):
            if await page.query_selector('h1:has-text("Done for now")'): break
            e = await page.evaluate("__app.entry")
            if e.get('intro'):
                await page.click('#go'); seen['intro'] = seen.get('intro', 0) + 1; continue
            ex = await page.evaluate("({kind: __app.ex.kind, label: __app.ex.label, answer: __app.ex.answer, answers: __app.ex.answers})")
            seen[ex['label']] = seen.get(ex['label'], 0) + 1
            if ex['kind'] == 'mc':
                opts = await page.query_selector_all('.opt'); texts = [await o.inner_text() for o in opts]
                await opts[texts.index(ex['answer']) if i % 4 else 0].click()
            else:
                if not typed_shot:
                    await page.screenshot(path=f'{OUT}/04-session-typing.png'); typed_shot = True
                import unicodedata
                plain = ''.join(c for c in unicodedata.normalize('NFD', ex['answers'][0]) if unicodedata.category(c) != 'Mn')
                await page.fill('#ans', plain); await page.click('#check')
                if not fb_shot and plain != ex['answers'][0]:
                    await page.screenshot(path=f'{OUT}/05-accent-feedback.png'); fb_shot = True
            await page.click('#next')
        print('session card types seen:', json.dumps(seen, ensure_ascii=False))
        st = await page.evaluate("(() => { const s = __app.state; return {items: Object.keys(s.items).length, placementDone: s.placementDone, summary: s.placementSummary && {weak: s.placementSummary.weak, partial: s.placementSummary.partial, strong: s.placementSummary.strong}}; })()")
        print('state:', json.dumps(st))
        persisted = await page.evaluate("localStorage.getItem('spanish-app-state-v1').length")
        print('saved bytes:', persisted)
        # home + progress
        await page.goto(URL); await page.wait_for_selector('#prog')
        await page.screenshot(path=f'{OUT}/06-home.png')
        await page.click('#prog'); await page.screenshot(path=f'{OUT}/07-progress.png', full_page=True)
        # offline reload
        await ctx.set_offline(True)
        await page.reload(); await page.wait_for_selector('#prog', timeout=5000)
        print('offline reload OK:', await page.title())
        await ctx.set_offline(False)
        print('console errors:', errors or 'none')
        await b.close()
asyncio.run(main())
