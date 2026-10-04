// pwa: generates the SPAN app icons (SVG sources + PNG renders) into assets/icons/app/.
// Usage: node tools/gen-icons.js        (headless Chrome canvas; never opens a window)
// The art: two towers and a suspension cable (gold -> white -> cyan, as on the title logo)
// strung over a big gold "S" (drawn as a stroked path so it does not depend on any font).
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const OUT = path.resolve(__dirname, '..', 'assets', 'icons', 'app');
fs.mkdirSync(OUT, { recursive: true });

const DEFS = `
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b2a48"/><stop offset=".55" stop-color="#101a30"/><stop offset="1" stop-color="#0b1120"/></linearGradient>
    <radialGradient id="glow" cx=".5" cy=".42" r=".55"><stop offset="0" stop-color="#ffb547" stop-opacity=".22"/><stop offset="1" stop-color="#ffb547" stop-opacity="0"/></radialGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1"><stop offset=".12" stop-color="#ffffff"/><stop offset=".58" stop-color="#ffe2a8"/><stop offset="1" stop-color="#ffb547"/></linearGradient>
    <linearGradient id="cable" x1="0" x2="1"><stop offset="0" stop-color="#ffd27a"/><stop offset=".5" stop-color="#ffffff"/><stop offset="1" stop-color="#7fe0ff"/></linearGradient>`;

// 512 x 512 art space
const S_PATH = 'M332 176C318 148 288 134 254 134C210 134 182 160 182 196C182 236 218 250 256 260C298 271 334 286 334 328C334 366 300 390 256 390C220 390 190 374 174 346';
const ART = `
    <path d="${S_PATH}" transform="translate(0 12)" fill="none" stroke="#5a2408" stroke-opacity=".55" stroke-width="66" stroke-linecap="round"/>
    <path d="${S_PATH}" fill="none" stroke="url(#gold)" stroke-width="66" stroke-linecap="round"/>
    <g fill="none" stroke-linecap="round">
      <path d="M136 410V96M376 410V96" stroke="#ffffff" stroke-opacity=".95" stroke-width="16"/>
      <path d="M170 188V410M205 242V410M240 266V410M272 266V410M307 242V410M342 188V410M76 384V410M104 352V410M408 352V410M436 384V410" stroke="#ffffff" stroke-opacity=".6" stroke-width="5"/>
      <path d="M30 396Q104 384 136 100Q256 404 376 100Q408 384 482 396" stroke="#0b1120" stroke-opacity=".55" stroke-width="20"/>
      <path d="M30 396Q104 384 136 100Q256 404 376 100Q408 384 482 396" stroke="url(#cable)" stroke-width="11"/>
      <path d="M22 412H490" stroke="#ffffff" stroke-width="16"/>
    </g>`;

function svg(kind) {
  // any: rounded tile with transparent corners. maskable: full bleed, art inside the 80% safe circle.
  // apple: full bleed (iOS rounds the corners itself), art a little larger than maskable.
  const scale = kind === 'maskable' ? 0.7 : kind === 'apple' ? 0.84 : 0.9;
  const t = `translate(256 256) scale(${scale}) translate(-256 -262)`;
  const tile = kind === 'any' ? '<rect width="512" height="512" rx="112" fill="url(#bg)"/>' : '<rect width="512" height="512" fill="url(#bg)"/>';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>${DEFS}
  </defs>
  ${tile}
  <rect width="512" height="512" fill="url(#glow)"${kind === 'any' ? ' rx="112"' : ''}/>
  <g transform="${t}">${ART}
  </g>
</svg>
`;
}

const SVGS = { any: svg('any'), maskable: svg('maskable'), apple: svg('apple') };
fs.writeFileSync(path.join(OUT, 'icon.svg'), SVGS.any);
fs.writeFileSync(path.join(OUT, 'icon-maskable.svg'), SVGS.maskable);

const RENDERS = [
  ['icon-192.png', 'any', 192], ['icon-512.png', 'any', 512],
  ['icon-maskable-192.png', 'maskable', 192], ['icon-maskable-512.png', 'maskable', 512],
  ['apple-touch-icon.png', 'apple', 180]
];

(async () => {
  const browser = await require('./browser').launch(chromium);
  const page = await browser.newPage();
  await page.setContent('<!doctype html><body></body>');
  for (const [file, kind, size] of RENDERS) {
    const b64 = await page.evaluate(async ([src, size]) => {
      const img = new Image();
      img.src = 'data:image/svg+xml;base64,' + btoa(src);
      await img.decode();
      const c = document.createElement('canvas'); c.width = c.height = size;
      const g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
      g.drawImage(img, 0, 0, size, size);
      return c.toDataURL('image/png').split(',')[1];
    }, [SVGS[kind], size]);
    fs.writeFileSync(path.join(OUT, file), Buffer.from(b64, 'base64'));
    console.log('wrote', path.relative(process.cwd(), path.join(OUT, file)), size + 'px');
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
