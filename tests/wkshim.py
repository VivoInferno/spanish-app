"""The box's headless WebKit build has no GStreamer MP3 decoder and crashes the page when an <audio> loads an MP3
(real iOS Safari plays them fine). Importing this module makes every WebKit context created by a test stub media loading:
setting src just stores it and play() resolves. Chromium tests keep real audio."""
from playwright.async_api import Browser
SHIM = """(() => { const P = HTMLMediaElement.prototype;
  Object.defineProperty(P, 'src', { configurable: true, get() { return this.__src || ''; }, set(v) { this.__src = String(v); } });
  P.load = function () {}; P.play = function () { return Promise.resolve(); }; P.pause = function () {}; })();"""
_orig = Browser.new_context
async def _new_context(self, *a, **kw):
    ctx = await _orig(self, *a, **kw)
    if self.browser_type.name == 'webkit': await ctx.add_init_script(SHIM)
    return ctx
if not getattr(Browser, '_wkshim', False):
    Browser.new_context = _new_context; Browser._wkshim = True
