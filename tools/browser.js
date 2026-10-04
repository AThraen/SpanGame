// SPAN — launches headless Chrome for every browser tool (tests, screenshots, icons). Never opens a window.
// Usage: const browser = await require('./browser').launch(chromium[, extraLaunchOptions]);
//
// Headless Chrome normally draws through the GPU. When the machine's GPU process cannot bring up GL (a busy or
// sleeping GPU, a driver update, a remote session), it produces no frames at all: requestAnimationFrame never fires,
// screenshots time out and every Playwright click waits forever for its element to be "stable". launch() checks that
// frames arrive and, if they do not, relaunches with software rendering (no GL, software compositing). The game only
// draws 2D canvases, so nothing changes on screen, but frame timings are not representative then: software() is true
// and the frame-budget checks report their numbers without failing. SPAN_SOFTWARE_GL=1 forces software rendering.
'use strict';
const SOFTWARE_ARGS = ['--use-gl=disabled', '--disable-gpu-compositing'];
let soft = process.env.SPAN_SOFTWARE_GL === '1';
let noted = false;

function options(extra, software) {
  extra = extra || {};
  return Object.assign({ channel: 'chrome' }, extra, { headless: true, args: (software ? SOFTWARE_ARGS : []).concat(extra.args || []) });
}
async function framesArrive(browser) {
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    await page.setContent('<p>frame check</p>');
    return await page.evaluate(() => new Promise(res => { requestAnimationFrame(() => requestAnimationFrame(() => res(true))); setTimeout(() => res(false), 4000); }));
  } finally { await ctx.close().catch(() => {}); }
}
async function launch(chromium, extra) {
  if (!soft) {
    const b = await chromium.launch(options(extra, false));
    if (await framesArrive(b).catch(() => false)) return b;
    await b.close().catch(() => {});
    soft = true;
  }
  if (!noted) { noted = true; console.log('[browser] headless Chrome gets no GPU frames here: software rendering (frame timings are not checked)'); }
  return chromium.launch(options(extra, true));
}
module.exports = { launch, options, software: () => soft, SOFTWARE_ARGS };
