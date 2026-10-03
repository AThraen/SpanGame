// SPAN — tiny dependency-free image helpers for tools/screenshots.js (Node only, never shipped).
//   decodePNG(buf)            -> { width, height, data: Uint8Array RGBA }   (8-bit RGB/RGBA, non-interlaced; what Chrome writes)
//   downscale(img, factor)    -> box-filtered image, integer factor
//   encodeGIF(frames, opts)   -> Buffer (GIF89a, looping). frames: [{ width, height, data RGBA }], opts: { delay (ms), loop }
// The GIF uses one global palette (median cut over samples of every frame) and stores each frame as the
// rectangle that changed since the previous one, with unchanged pixels transparent, so static scenery costs
// almost nothing.
'use strict';
const zlib = require('zlib');

// ------------------------------------------------------------------ PNG decode
function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let pos = 8, width = 0, height = 0, depth = 0, ctype = 0, interlace = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), type = buf.toString('ascii', pos + 4, pos + 8);
    const body = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]; ctype = body[9]; interlace = body[12]; }
    else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (depth !== 8 || (ctype !== 2 && ctype !== 6) || interlace) throw new Error('unsupported PNG (depth ' + depth + ', type ' + ctype + ')');
  const bpp = ctype === 6 ? 4 : 3, stride = width * bpp;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const out = new Uint8Array(width * height * 4);
  let prev = new Uint8Array(stride), cur = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let v = src[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[i] = v & 255;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4, s = x * bpp;
      out[o] = cur[s]; out[o + 1] = cur[s + 1]; out[o + 2] = cur[s + 2]; out[o + 3] = bpp === 4 ? cur[s + 3] : 255;
    }
    const t = prev; prev = cur; cur = t;
  }
  return { width, height, data: out };
}

// ------------------------------------------------------------------ downscale (box filter)
function downscale(img, f) {
  if (f <= 1) return img;
  const w = Math.floor(img.width / f), h = Math.floor(img.height / f), out = new Uint8Array(w * h * 4), n = f * f;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0;
    for (let dy = 0; dy < f; dy++) for (let dx = 0; dx < f; dx++) {
      const o = ((y * f + dy) * img.width + x * f + dx) * 4;
      r += img.data[o]; g += img.data[o + 1]; b += img.data[o + 2];
    }
    const o = (y * w + x) * 4;
    out[o] = Math.round(r / n); out[o + 1] = Math.round(g / n); out[o + 2] = Math.round(b / n); out[o + 3] = 255;
  }
  return { width: w, height: h, data: out };
}

// ------------------------------------------------------------------ palette (median cut)
function medianCut(samples, maxColors) {
  // samples: array of [r,g,b]
  let boxes = [samples];
  while (boxes.length < maxColors) {
    let bi = -1, best = -1, axis = 0;
    for (let i = 0; i < boxes.length; i++) {
      const bx = boxes[i];
      if (bx.length < 2) continue;
      const lo = [255, 255, 255], hi = [0, 0, 0];
      for (const p of bx) for (let k = 0; k < 3; k++) { if (p[k] < lo[k]) lo[k] = p[k]; if (p[k] > hi[k]) hi[k] = p[k]; }
      for (let k = 0; k < 3; k++) {
        const score = (hi[k] - lo[k]) * Math.sqrt(bx.length);
        if (score > best) { best = score; bi = i; axis = k; }
      }
    }
    if (bi < 0 || best <= 0) break;
    const bx = boxes[bi].sort((p, q) => p[axis] - q[axis]);
    const mid = bx.length >> 1;
    boxes.splice(bi, 1, bx.slice(0, mid), bx.slice(mid));
  }
  return boxes.map(bx => {
    let r = 0, g = 0, b = 0;
    for (const p of bx) { r += p[0]; g += p[1]; b += p[2]; }
    return [Math.round(r / bx.length), Math.round(g / bx.length), Math.round(b / bx.length)];
  });
}

function makeMapper(palette) {
  const cache = new Int16Array(1 << 18).fill(-1); // 6 bits per channel
  return (r, g, b) => {
    const key = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
    let idx = cache[key];
    if (idx >= 0) return idx;
    let bd = 1e9;
    for (let i = 0; i < palette.length; i++) {
      const p = palette[i], dr = p[0] - r, dg = p[1] - g, db = p[2] - b;
      const d = dr * dr * 2 + dg * dg * 4 + db * db * 3;
      if (d < bd) { bd = d; idx = i; }
    }
    cache[key] = idx;
    return idx;
  };
}

// ------------------------------------------------------------------ LZW
function lzw(indices, minCode) {
  const out = [];
  let bitBuf = 0, bitCnt = 0;
  const clear = 1 << minCode, eoi = clear + 1;
  let codeSize = minCode + 1, next = eoi + 1;
  let dict = new Map();
  const emit = code => {
    bitBuf |= code << bitCnt; bitCnt += codeSize;
    while (bitCnt >= 8) { out.push(bitBuf & 255); bitBuf >>>= 8; bitCnt -= 8; }
  };
  emit(clear);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i], key = prefix * 4096 + k;
    const hit = dict.get(key);
    if (hit !== undefined) { prefix = hit; continue; }
    emit(prefix);
    if (next < 4096) {
      dict.set(key, next++);
      if (next > (1 << codeSize) && codeSize < 12) codeSize++;
    } else {
      emit(clear); dict = new Map(); codeSize = minCode + 1; next = eoi + 1;
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (bitCnt > 0) out.push(bitBuf & 255);
  // sub-blocks
  const blocks = [];
  for (let i = 0; i < out.length; i += 255) { const n = Math.min(255, out.length - i); blocks.push(n, ...out.slice(i, i + n)); }
  blocks.push(0);
  return blocks;
}

// ------------------------------------------------------------------ GIF encode
function encodeGIF(frames, opts) {
  opts = opts || {};
  const W = frames[0].width, H = frames[0].height;
  const delayCs = Math.max(2, Math.round((opts.delay || 80) / 10));
  // palette: 255 colours from samples of every frame; index 255 = transparent
  const samples = [];
  const step = Math.max(1, Math.floor((W * H * frames.length) / 60000));
  frames.forEach(fr => { for (let p = 0; p < W * H; p += step) { const o = p * 4; samples.push([fr.data[o], fr.data[o + 1], fr.data[o + 2]]); } });
  const pal = medianCut(samples, 255);
  while (pal.length < 256) pal.push([0, 0, 0]);
  const TRANS = 255, map = makeMapper(pal.slice(0, 255));
  const bytes = [];
  const u16 = v => bytes.push(v & 255, (v >> 8) & 255);
  bytes.push(...Buffer.from('GIF89a'));
  u16(W); u16(H);
  bytes.push(0xf7, 0, 0); // global colour table, 8 bits, 256 entries
  pal.forEach(c => bytes.push(c[0], c[1], c[2]));
  bytes.push(0x21, 0xff, 11, ...Buffer.from('NETSCAPE2.0'), 3, 1); u16(opts.loop == null ? 0 : opts.loop); bytes.push(0);
  let prevIdx = null;
  frames.forEach((fr, fi) => {
    const idx = new Uint8Array(W * H);
    for (let p = 0; p < W * H; p++) { const o = p * 4; idx[p] = map(fr.data[o], fr.data[o + 1], fr.data[o + 2]); }
    // changed rectangle
    let x0 = 0, y0 = 0, x1 = W - 1, y1 = H - 1;
    if (prevIdx) {
      x0 = W; y0 = H; x1 = -1; y1 = -1;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const p = y * W + x;
        if (idx[p] !== prevIdx[p]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      }
      if (x1 < 0) { x0 = y0 = 0; x1 = y1 = 0; }
    }
    const rw = x1 - x0 + 1, rh = y1 - y0 + 1, sub = new Uint8Array(rw * rh);
    for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
      const p = (y + y0) * W + x + x0;
      sub[y * rw + x] = prevIdx && idx[p] === prevIdx[p] ? TRANS : idx[p];
    }
    const lastDelay = fi === frames.length - 1 && opts.lastDelay ? Math.round(opts.lastDelay / 10) : delayCs;
    bytes.push(0x21, 0xf9, 4, (1 << 2) | (prevIdx ? 1 : 0)); u16(lastDelay); bytes.push(TRANS, 0); // dispose: leave in place
    bytes.push(0x2c); u16(x0); u16(y0); u16(rw); u16(rh); bytes.push(0);
    bytes.push(8);
    const data = lzw(sub, 8);
    for (let i = 0; i < data.length; i++) bytes.push(data[i]);
    prevIdx = idx;
  });
  bytes.push(0x3b);
  return Buffer.from(bytes);
}

module.exports = { decodePNG, downscale, encodeGIF };
