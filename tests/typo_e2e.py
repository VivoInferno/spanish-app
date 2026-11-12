"""v7 typo tolerance in the UI: a one-letter slip on a typed Spanish answer is graded correct (score + SRS Good),
shows "Correct, watch the spelling" with the letter highlighted; an ending change (gender/number/verb) is still wrong."""
import asyncio, json, sys, os
from playwright.async_api import async_playwright
URL = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8787/'
ENGINE = sys.argv[2] if len(sys.argv) > 2 else 'chromium'
OUT = '/workspace/spanish-app/screens'
KEY = 'spanish-app-state-v1'
V5 = json.load(open('/workspace/spanish-app/tests/fixtures/v5-export.json'))
ok_all = True
def check(cond, msg):
    global ok_all
    print(('PASS ' if cond else 'FAIL ') + msg); ok_all = ok_all and bool(cond)
MAKE = """(mode) => { const ex = __app.ex; if (!ex || ex.kind !== 'type' || ex.opts.lang !== 'es' || ex.opts.sentence) return null;
  const ans = ex.answers[0], words = ans.split(' '); let k = words.findIndex(w => w.length >= 6); if (k < 0) return null;
  const w = words[k];
  const typed = mode === 'typo' ? w.slice(0, 2) + w.slice(3) : w.slice(0, -1) + ({a: 'o', o: 'a', e: 'a', s: 'n'}[w.slice(-1)] || 's');
  words[k] = typed; const t = words.join(' '); const r = Check.check(t, ex.answers, ex.opts).result;
  return (mode === 'typo' ? r === 'typo' : r === 'wrong') ? t : null; }"""
async def main():
    async with async_playwright() as p:
        b = await (p.webkit if ENGINE == 'webkit' else p.chromium).launch()
        dev = dict(p.devices['iPhone 15']) if ENGINE == 'webkit' else dict(viewport={'width': 390, 'height': 844}, device_scale_factor=3, is_mobile=True, has_touch=True)
        ctx = await b.new_context(**dev, timezone_id='America/Mexico_City')
        raw = {k: v for k, v in V5.items() if k not in ('exportedAt', 'app', 'appVersion')}
        await ctx.add_init_script(f"if (!localStorage.getItem('{KEY}')) localStorage.setItem('{KEY}', {json.dumps(json.dumps(raw))})")
        page = await ctx.new_page(); errors = []; page.on('pageerror', lambda e: errors.append(str(e)))
        await page.goto(URL); await page.wait_for_selector('.stone')
        done = {'typo': False, 'wrong': False}
        for uid in ('u1', 'u2', 'u3', 'u7', 'ta4', 'u4', 'u5', 'u6', 'ta1', 'ta2', 'ta3', 'u8', 'u9'):
            await page.evaluate(f"__app.openStone('{uid}', 3)")
            while await page.evaluate("!!__app.run"):
                mode = 'typo' if not done['typo'] else 'wrong' if not done['wrong'] else None
                t = await page.evaluate(MAKE, mode) if mode else None
                if t:
                    before = await page.evaluate("({score: __app.run.score, total: __app.run.total, id: __app.entry.id, lapses: (__app.state.items[__app.entry.id] || {}).lapses || 0, first: !!__app.run.firstDone[__app.entry.id]})")
                    await page.fill('#ans', t); await page.click('#check'); await page.wait_for_selector('.feedback')
                    after = await page.evaluate("({score: __app.run.score, total: __app.run.total, lapses: (__app.state.items[__app.entry.id] || {}).lapses || 0})")
                    fb = await page.inner_text('.feedback'); good = await page.query_selector('.feedback.good') is not None
                    if mode == 'typo':
                        mark = await page.inner_text('.feedback mark') if await page.query_selector('.feedback mark') else ''
                        check(good and 'watch the spelling' in fb and len(mark) in (1, 2), f'typo "{t}" → correct, highlighted letter "{mark}"')
                        check(after['score'] == before['score'] + 1 and (before['first'] or after['lapses'] == before['lapses']), 'counted as a correct answer, no lapse')
                        await page.wait_for_timeout(500); await page.screenshot(path=f'{OUT}/v7-typo.png' if ENGINE == 'webkit' else f'{OUT}/v7-typo-{ENGINE}.png')
                    else:
                        check(not good and after['score'] == before['score'], f'ending change "{t}" is still wrong')
                    done[mode] = True
                    await page.click('#next'); continue
                await page.click('#quit'); break
            await page.wait_for_selector('.stone')
            if all(done.values()): break
        check(all(done.values()), f'found cards for both cases {done}')
        check(not errors, f'no page errors ({errors[:3]})')
        await b.close()
    print('\nALL PASS' if ok_all else '\nSOME CHECKS FAILED')
asyncio.run(main())
