// VAULT RAIDER - canvas primitives. SPEC v0.6 sections 1, 17.6.
//
// Owns: canvas init, viewport maths, scaling, letter/pillarboxing, and drawing
// primitives. Owns NOTHING about what a floor or a room looks like - scene
// composition is game/render.js (section 13).
//
// computeViewport is pure and DOM-free so it can be tested headless; every
// other function here takes an initialised gfx object and touches the canvas.

import { TUNING } from '../data/tuning.js';

// Pure. Logical 320x240 into a CSS-pixel box.
//
// Desktop uses integer scaling so nearest-neighbour upscaling stays crisp.
// allowFractional exists for mobile (section 17.6): integer-only scaling wastes
// too much of a phone screen. Nearest-neighbour still applies either way.
export function computeViewport(cssW, cssH, allowFractional) {
  const raw = Math.min(cssW / TUNING.logicalW, cssH / TUNING.logicalH);
  let scale = allowFractional ? raw : Math.floor(raw);
  if (scale < 1) scale = allowFractional ? Math.max(raw, 0) : 1;

  const width = TUNING.logicalW * scale;
  const height = TUNING.logicalH * scale;
  return {
    scale,
    width,
    height,
    // Floored so the blit lands on whole device pixels.
    offsetX: Math.floor((cssW - width) / 2),
    offsetY: Math.floor((cssH - height) / 2)
  };
}

export function initGfx(canvas, allowFractional) {
  const ctx = canvas.getContext('2d', { alpha: false });
  const gfx = {
    canvas,
    ctx,
    allowFractional: !!allowFractional,
    viewport: { scale: 1, width: TUNING.logicalW, height: TUNING.logicalH, offsetX: 0, offsetY: 0 },
    dpr: 1
  };
  return gfx;
}

export function resizeGfx(gfx, cssW, cssH, devicePixelRatio) {
  const dpr = devicePixelRatio || 1;
  const viewport = computeViewport(cssW, cssH, gfx.allowFractional);

  gfx.dpr = dpr;
  gfx.viewport = viewport;
  gfx.canvas.width = Math.round(viewport.width * dpr);
  gfx.canvas.height = Math.round(viewport.height * dpr);
  gfx.canvas.style.width = viewport.width + 'px';
  gfx.canvas.style.height = viewport.height + 'px';

  // Set after every resize: assigning to canvas.width resets all context state.
  gfx.ctx.imageSmoothingEnabled = false;
  return viewport;
}

export function gfxBeginFrame(gfx, clearColor) {
  const { ctx } = gfx;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = clearColor;
  ctx.fillRect(0, 0, gfx.canvas.width, gfx.canvas.height);
  // Everything after this point draws in logical 320x240 coordinates.
  const s = gfx.viewport.scale * gfx.dpr;
  ctx.setTransform(s, 0, 0, s, 0, 0);
}

export function gfxFillRect(gfx, x, y, w, h, color) {
  gfx.ctx.fillStyle = color;
  gfx.ctx.fillRect(x, y, w, h);
}

export function gfxStrokeRect(gfx, x, y, w, h, color, lineWidth) {
  gfx.ctx.strokeStyle = color;
  gfx.ctx.lineWidth = lineWidth;
  gfx.ctx.strokeRect(x, y, w, h);
}

// Debug text only. Shipped HUD text renders from the sprite atlas at M8;
// canvas fillText is here so M1 has something legible to validate against.
export function gfxDrawDebugText(gfx, text, x, y, color, sizePx) {
  gfx.ctx.fillStyle = color;
  gfx.ctx.font = sizePx + 'px monospace';
  gfx.ctx.textBaseline = 'top';
  gfx.ctx.fillText(text, x, y);
}

export function gfxEndFrame(gfx) {
  gfx.ctx.setTransform(1, 0, 0, 1, 0, 0);
}
