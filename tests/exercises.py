import asyncio, json
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); page = await b.new_page()
        errs=[]; page.on('pageerror', lambda e: errs.append(str(e)))
        await page.goto('http://127.0.0.1:8787/'); await page.wait_for_function("window.__app && __app.content")
        r = await page.evaluate("""(() => { const out = []; const C = __app.content;
          for (const u of C.units) for (const w of u.words) for (const ex of ['es2en','en2es','cloze','listen','listenS']) {
            const e = __app.makeExercise({id:'w:'+w.id, ex}); out.push([w.id, ex, e.label, (e.clozeEs||e.listen||e.big||'').slice(0,60), e.answers[0]]); }
          for (const p of Object.keys(C.patterns)) out.push([p, 'mc', __app.makeExercise({id:'p:'+p}).label]);
          return out; })()""")
        for row in r[:12] + r[-3:]: print(row)
        print(len(r), 'exercises built; errors:', errs or 'none')
        await b.close()
asyncio.run(main())
