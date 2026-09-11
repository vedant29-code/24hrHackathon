/* =============================================================================
   wireframe.js — line extraction for transparent-background wireframe renders

   Objects are rendered as pure wireframe technical drawings: every edge drawn
   as a dark stroke, hidden edges dashed, everything else fully transparent
   (alpha 0). This is structural information, not a silhouette — the AI reading
   the shape sees every fold and edge explicitly instead of guessing what's
   hidden behind an outline.

   Two things are extracted:
     lineMask  — exactly the drawn line pixels (alpha above threshold). This is
                 what the fitter compares against the recipe's projected edges.
     solidMask — the line drawing's enclosed interior, filled in, for anything
                 that still wants a plain silhouette (bounding box, alignment,
                 photo-only surface carving).
   ============================================================================= */

export const DEFAULTS = {
  threshold: 40,   // alpha value above which a pixel counts as a drawn line
  bridge: 1,       // px gap to bridge before judging what's enclosed
};

/* Flood fill from the border through non-line pixels. Anything the flood
   cannot reach is enclosed by the wireframe and becomes solid interior. */
function fillEnclosed(lineMask, w, h) {
  const reached = new Uint8Array(w * h);
  const stack = [];
  const tryPush = (i) => { if (!lineMask[i] && !reached[i]) { reached[i] = 1; stack.push(i); } };
  for (let x = 0; x < w; x++) { tryPush(x); tryPush((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { tryPush(y * w); tryPush(y * w + w - 1); }
  while (stack.length) {
    const i = stack.pop();
    const x = i % w, y = (i - x) / w;
    if (x > 0) tryPush(i - 1);
    if (x < w - 1) tryPush(i + 1);
    if (y > 0) tryPush(i - w);
    if (y < h - 1) tryPush(i + w);
  }
  const solid = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) solid[i] = (!lineMask[i] && !reached[i]) ? 1 : 0;
  return solid;
}

function dilate(mask, w, h, r) {
  if (r < 1) return mask;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (mask[y * w + x]) { out[y * w + x] = 1; continue; }
    let found = false;
    for (let dy = -r; dy <= r && !found; dy++) for (let dx = -r; dx <= r && !found; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < w && ny < h && mask[ny * w + nx]) found = true;
    }
    out[y * w + x] = found ? 1 : 0;
  }
  return out;
}

export function extractWireframe(imageData, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const { data: px, width: w, height: h } = imageData;

  const lineMask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) lineMask[i] = px[i * 4 + 3] > o.threshold ? 1 : 0;

  let onLine = 0;
  for (let i = 0; i < w * h; i++) onLine += lineMask[i];

  if (onLine === 0) {
    return {
      lineMask, solidMask: new Uint8Array(w * h), w, h,
      report: { coverage: 0, warnings: ['No wireframe lines detected — export with a transparent background and visible dark strokes.'], ok: false },
    };
  }

  // Bridge hairline gaps before deciding what's enclosed, so a broken line
  // doesn't leak the fill out through a one-pixel hole.
  const bridged = o.bridge > 0 ? dilate(lineMask, w, h, o.bridge) : lineMask;
  const enclosed = fillEnclosed(bridged, w, h);
  const solidMask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) solidMask[i] = (enclosed[i] || lineMask[i]) ? 1 : 0;

  const coverage = onLine / (w * h);
  const warnings = [];
  if (coverage < 0.002) warnings.push('Very few line pixels found — check the drawing has enough visible structure.');
  if (coverage > 0.5) warnings.push('Almost the whole frame is lines — check the background is fully transparent.');

  return { lineMask, solidMask, w, h, report: { coverage, warnings, ok: warnings.length === 0 } };
}
