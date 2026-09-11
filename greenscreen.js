/* =============================================================================
   greenscreen.js — silhouette extraction for green-background wireframe renders

   Objects are rendered as white solids with black wireframe lines on a pure
   green (#00FF00) background. Extraction is simple chroma keying: any pixel
   where green dominates is background, everything else is object.

   This replaces whitematte.js for the wireframe pipeline.
   ============================================================================= */

export const DEFAULTS = {
  sensitivity:   0.50,  // 0 = strict green only, 1 = generous green detection
  fillHoles:     true,  // fill enclosed regions the green leaked into via wireframe gaps
  despeckle:     0.02,  // drop blobs smaller than this fraction of the biggest
  keepLargest:   true,  // a single subject per photo
  bridge:        2,     // px gap to bridge before deciding what is connected
};

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/* -----------------------------------------------------------------------------
   Green-screen chroma key

   A pixel is "green background" when:
     1. Its green channel is significantly higher than both red and blue.
     2. The green channel is above a minimum brightness floor.

   The sensitivity slider moves the threshold for "how much greener" a pixel
   needs to be. At sensitivity 0 only pure #00FF00 is background; at 1 even
   moderately green pixels are treated as background.
   ----------------------------------------------------------------------------- */
function computeGreenMask(imageData, opts) {
  const o = { ...DEFAULTS, ...opts };
  const { data: px, width: w, height: h } = imageData;

  // The threshold sets how much the green channel must exceed R and B.
  // sensitivity 0 → margin 100 (strict), sensitivity 1 → margin 15 (generous).
  const margin = Math.round(100 - 85 * o.sensitivity);
  const minGreen = 80; // green channel must be at least this bright

  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const p = i * 4;
    const r = px[p], g = px[p + 1], b = px[p + 2], a = px[p + 3];

    if (a < 8) continue; // transparent → background

    // Is this pixel NOT green? Then it's object.
    const isGreen = g >= minGreen && (g - r) >= margin && (g - b) >= margin;
    mask[i] = isGreen ? 0 : 1;
  }

  return { mask, w, h };
}

/* -----------------------------------------------------------------------------
   Flood-fill hole filling

   After chroma keying, wireframe gaps may let the green background leak into
   the interior of the object. We fix this by flood-filling from every border
   pixel that is background. Anything the flood can't reach is enclosed and
   must be object.
   ----------------------------------------------------------------------------- */
function fillEnclosed(mask, w, h) {
  const out = new Uint8Array(mask);
  // Mark all background-connected-to-border pixels
  const visited = new Uint8Array(w * h);
  const stack = [];

  // Seed from all border pixels that are background
  for (let x = 0; x < w; x++) {
    if (!out[x]) { visited[x] = 1; stack.push(x); }
    const bot = (h - 1) * w + x;
    if (!out[bot]) { visited[bot] = 1; stack.push(bot); }
  }
  for (let y = 1; y < h - 1; y++) {
    const left = y * w;
    if (!out[left]) { visited[left] = 1; stack.push(left); }
    const right = y * w + w - 1;
    if (!out[right]) { visited[right] = 1; stack.push(right); }
  }

  // Flood fill
  while (stack.length) {
    const i = stack.pop();
    const x = i % w, y = (i - x) / w;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (visited[j] || out[j]) continue;
        visited[j] = 1;
        stack.push(j);
      }
    }
  }

  // Any background pixel NOT reached from the border is enclosed → fill it
  for (let i = 0; i < w * h; i++) {
    if (!out[i] && !visited[i]) out[i] = 1;
  }
  return out;
}

/* -----------------------------------------------------------------------------
   Morphological dilation for bridge-then-component analysis
   ----------------------------------------------------------------------------- */
function dilate(mask, w, h, r) {
  if (r < 1) return mask;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x]) { out[y * w + x] = 1; continue; }
      let found = false;
      for (let dy = -r; dy <= r && !found; dy++) {
        for (let dx = -r; dx <= r && !found; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < w && ny < h && mask[ny * w + nx]) found = true;
        }
      }
      if (found) out[y * w + x] = 1;
    }
  }
  return out;
}

/* Connected components via union-find */
function components(mask, w, h) {
  const parent = new Int32Array(w * h).fill(-1);
  const find = (i) => { while (parent[i] >= 0) i = parent[i]; return i; };
  const union = (a, b) => {
    a = find(a); b = find(b);
    if (a === b) return;
    if (parent[a] < parent[b]) { parent[a] += parent[b]; parent[b] = a; }
    else { parent[b] += parent[a]; parent[a] = b; }
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (!mask[i]) continue;
    if (x > 0 && mask[i - 1]) union(i, i - 1);
    if (y > 0 && mask[i - w]) union(i, i - w);
  }
  const labels = new Int32Array(w * h).fill(-1);
  const sizes = [];
  const labelMap = new Map();
  for (let i = 0; i < w * h; i++) {
    if (!mask[i]) continue;
    const root = find(i);
    if (!labelMap.has(root)) { labelMap.set(root, sizes.length); sizes.push(0); }
    const lbl = labelMap.get(root);
    labels[i] = lbl;
    sizes[lbl]++;
  }
  return { labels, sizes };
}

/* -----------------------------------------------------------------------------
   Main entry point
   ----------------------------------------------------------------------------- */
export function extractGreenScreen(imageData, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const { mask: rawMask, w, h } = computeGreenMask(imageData, o);

  let mask = rawMask;
  let count = 0;
  for (let i = 0; i < w * h; i++) count += mask[i];
  if (count === 0) {
    return {
      mask: new Uint8Array(w * h), w, h,
      report: { coverage: 0, warnings: ['Nothing stood out from the green background. Raise sensitivity.'], ok: false },
    };
  }

  // Fill holes created by wireframe gaps
  if (o.fillHoles) mask = fillEnclosed(mask, w, h);

  // Despeckle: bridge small gaps, find components, drop small ones
  const bridged = dilate(mask, w, h, Math.round(o.bridge));
  const { labels } = components(bridged, w, h);
  const nLabels = labels.reduce((m, v) => Math.max(m, v), -1) + 1;
  const realSize = new Int32Array(Math.max(1, nLabels));
  for (let i = 0; i < w * h; i++) {
    if (mask[i] && labels[i] >= 0) realSize[labels[i]]++;
  }
  let biggest = 0;
  for (let i = 1; i < realSize.length; i++) if (realSize[i] > realSize[biggest]) biggest = i;
  const minSize = realSize[biggest] * o.despeckle;
  const keep = new Uint8Array(realSize.length);
  for (let i = 0; i < realSize.length; i++) {
    keep[i] = o.keepLargest ? (i === biggest ? 1 : 0) : (realSize[i] >= minSize ? 1 : 0);
  }

  const finalMask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    finalMask[i] = (mask[i] && labels[i] >= 0 && keep[labels[i]]) ? 1 : 0;
  }

  const total = w * h;
  let on = 0;
  for (let i = 0; i < total; i++) on += finalMask[i];
  const coverage = on / total;

  const warnings = [];
  if (coverage < 0.015)
    warnings.push('The subject is tiny in frame — move closer or crop in.');
  if (coverage > 0.92)
    warnings.push('Almost the whole frame was taken as subject. Check the background is green.');

  return {
    mask: finalMask, w, h,
    report: { coverage, warnings, ok: warnings.length === 0 },
  };
}
