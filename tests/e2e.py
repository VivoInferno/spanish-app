import asyncio, sys
from playwright.async_api import async_playwright
import os as _os, sys as _sys; _sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__))); import wkshim  # box WebKit can't decode MP3
URL = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8787/'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); ctx = await b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True); await ctx.add_init_script("delete window.SpeechRecognition; delete window.webkitSpeechRecognition")
        page = await ctx.new_page(); errors = []
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        page.on('pageerror', lambda e: errors.append(str(e)))
        await page.goto(URL); await page.wait_for_selector('#go')
        print('service worker active:', await page.evaluate("navigator.serviceWorker.ready.then(r => !!r.active)"))
        await page.click('#go'); k = 0
        while not await page.query_selector('h1:has-text("Placement results")'):
            ex = await page.evaluate("({kind: __app.ex.kind, answer: __app.ex.answer})")
            if ex['kind'] == 'mc':
                opts = await page.query_selector_all('.opt'); texts = [await o.inner_text() for o in opts]; await opts[texts.index(ex['answer'])].click()
            else: await page.click('#skip')
            await page.click('#next'); k += 1
        print('placement items answered:', k)
        await page.click('#go'); await page.wait_for_selector('.stone')
        await ctx.set_offline(True); await page.reload(); await page.wait_for_selector('.stone', timeout=8000)
        print('offline reload OK:', await page.title(), await page.evaluate("__app.version"))
        await ctx.set_offline(False)
        print('console errors:', errors or 'none')
        await b.close()
asyncio.run(main())
