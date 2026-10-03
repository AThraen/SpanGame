/* SPAN — terrain-fix: the waterline is a build limit.
 * BG.Model.validate rejects user joints below level.terrain.waterY (error type 'underwater'); only anchors
 * and pier tops may sit under water. In edit mode this draws that limit on levels whose build area reaches
 * below the water surface: a dashed waterline plus a hatched "piers only" band down to the build-area floor.
 * Called by BG.Renderer (one hook line in R.render's edit overlays). Classic script, no DOM access. */
(function (root) {
  'use strict';
  const BG = (root.BG = root.BG || {});
  const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

  /** The underwater no-joint band of a level in world units, or null when there is none to show. */
  function limitBand(level) {
    const t = (level && level.terrain) || {};
    const ba = level && level.buildArea;
    if (typeof t.waterY !== 'number' || !isFinite(t.waterY) || !ba) return null;
    if (!(ba.y0 < t.waterY - 1e-6) || !(ba.y1 > t.waterY)) return null; // build area ends at/above the water
    const x0 = Math.max(Math.min(ba.x0, ba.x1), typeof t.leftEdge === 'number' ? t.leftEdge : -1e9);
    const x1 = Math.min(Math.max(ba.x0, ba.x1), typeof t.rightEdge === 'number' ? t.rightEdge : 1e9);
    if (!(x1 > x0)) return null;
    return { x0, x1, y0: Math.max(ba.y0, typeof t.floorY === 'number' ? t.floorY : ba.y0), y1: t.waterY };
  }

  /** Draws the limit (screen space). r: BG.Renderer instance, ctx: its 2D context. */
  function drawWaterLimit(r, ctx, state) {
    const L = r && r.level;
    const band = limitBand(L);
    if (!band || ((state && state.mode) || 'edit') !== 'edit') return;
    const lava = !!(r.theme && r.theme.lava);
    const p0 = r.worldToScreen(band.x0, band.y1), p1 = r.worldToScreen(band.x1, band.y0);
    const w = p1.x - p0.x, h = p1.y - p0.y;
    if (w < 2) return;
    r._screenXf(ctx);
    ctx.save();
    // hatched band below the waterline: no joints here
    if (h > 1) {
      ctx.beginPath(); ctx.rect(p0.x, p0.y, w, h); ctx.clip();
      ctx.fillStyle = 'rgba(10,30,60,0.16)'; ctx.fillRect(p0.x, p0.y, w, h);
      ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      const sp = 12;
      for (let x = p0.x - h - sp; x < p1.x + sp; x += sp) { ctx.moveTo(x, p1.y); ctx.lineTo(x + h, p0.y); }
      ctx.stroke();
    }
    ctx.restore();
    // the waterline itself
    const y = Math.round(p0.y) + 0.5;
    ctx.save();
    ctx.setLineDash([10, 5]);
    ctx.lineDashOffset = -(r.time || 0) * 8;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(p0.x, y); ctx.lineTo(p1.x, y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    // label at the left end, just under the line (pier-zone labels sit above it)
    if (w > 140) {
      const text = lava ? 'LAVA LINE · PIERS ONLY BELOW' : 'WATERLINE · PIERS ONLY BELOW';
      if (typeof r._label === 'function') r._label(ctx, p0.x + 12 + measure(ctx, text, 10) / 2 + 8, y + 14, text, 'rgba(8,28,52,0.8)', '#bfe6ff', 10);
    }
  }
  function measure(ctx, text, size) { ctx.font = '700 ' + size + 'px ' + FONT; return ctx.measureText(text).width; }

  BG.TerrainFix = { limitBand, drawWaterLimit };
})(typeof window !== 'undefined' ? window : globalThis);
