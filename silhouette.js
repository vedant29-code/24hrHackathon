/* =============================================================================
   silhouette.js — plain solid-object extraction.

   No wireframe, no chroma key. Handles whatever you throw at it:
     - a transparent background (alpha used)     → alpha above threshold = object
     - a solid light background, dark object      → auto-detected from the border
     - a solid dark background, light object      → auto-detected from the border
   The border is sampled to find the background's own brightness, then any
   pixel that differs enough from it is the object. No assumption about which
   way round the contrast runs.
   ============================================================================= */

export const DEFAULTS = {
  sensitivity: 0.5,  // 0 = only strong contrast counts, 1 = grab faint detail
  fillHoles: true,
  despeckle: 0.02,
  keepLargest: true,
  bridge: 2,
};

function fillEnclosed(mask, w, h) {
  const reached = new Uint8Array(w * h);
  const stack = [];
  const tryPush = (i) => { if (!mask[i] && !reached[i]) { reached[i] = 1; stack.push(i); } };
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
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = (mask[i] || !reached[i]) ? 1 : 0;
  return out;
}

function dilate(mask, w, h, r) {
  if (r < 1) return mask;
  const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = 0;
    for (let d = -r; d <= r && !v; d++) { const q = x + d; if (q >= 0 && q < w && mask[y*w+q]) v = 1; }
    tmp[y*w+x] = v;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = 0;
    for (let d = -r; d <= r && !v; d++) { const q = y + d; if (q >= 0 && q < h && tmp[q*w+x]) v = 1; }
    out[y*w+x] = v;
  }
  return out;
}

function components(mask, w, h) {
  const labels = new Int32Array(w * h).fill(-1);
  const sizes = [];
  for (let seed = 0; seed < w*h; seed++) {
    if (!mask[seed] || labels[seed] !== -1) continue;
    const id = sizes.length;
    let size = 0;
    const st = [seed];
    labels[seed] = id;
    while (st.length) {
      const i = st.pop(); size++;
      const x = i % w, y = (i - x) / w;
      if (x > 0   && mask[i-1] && labels[i-1] === -1) { labels[i-1] = id; st.push(i-1); }
      if (x < w-1 && mask[i+1] && labels[i+1] === -1) { labels[i+1] = id; st.push(i+1); }
      if (y > 0   && mask[i-w] && labels[i-w] === -1) { labels[i-w] = id; st.push(i-w); }
      if (y < h-1 && mask[i+w] && labels[i+w] === -1) { labels[i+w] = id; st.push(i+w); }
    }
    sizes.push(size);
  }
  return { labels, sizes };
}

function borderLuminance(px, w, h) {
  const band = Math.max(2, Math.round(Math.min(w, h) * 0.03));
  let sum = 0, count = 0;
  const add = (x, y) => { const p = (y*w+x)*4; sum += (px[p]+px[p+1]+px[p+2])/3; count++; };
  const stride = Math.max(1, Math.round(Math.min(w, h) / 200));
  for (let y = 0; y < band; y += stride) for (let x = 0; x < w; x += stride) add(x, y);
  for (let y = h-band; y < h; y += stride) for (let x = 0; x < w; x += stride) add(x, y);
  for (let y = band; y < h-band; y += stride) { add(0, y); add(w-1, y); }
  return count ? sum / count : 255;
}

export function extractSilhouette(imageData, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const { data: px, width: w, height: h } = imageData;

  let hasAlpha = false;
  for (let i = 0; i < w*h; i += 37) if (px[i*4+3] < 250) { hasAlpha = true; break; }

  const mask = new Uint8Array(w * h);
  if (hasAlpha) {
    const cutoff = Math.round(255 * (1 - o.sensitivity) * 0.5 + 20);
    for (let i = 0; i < w*h; i++) mask[i] = px[i*4+3] > cutoff ? 1 : 0;
  } else {
    const bgLum = borderLuminance(px, w, h);
    // How different a pixel must be from the background to count as object.
    // Lower sensitivity = stricter (needs stronger contrast).
    const cutoff = 60 - 45 * o.sensitivity;
    for (let i = 0; i < w*h; i++) {
      const p = i*4;
      const lum = (px[p]+px[p+1]+px[p+2])/3;
      mask[i] = Math.abs(lum - bgLum) > cutoff ? 1 : 0;
    }
  }

  let onCount = 0;
  for (let i = 0; i < w*h; i++) onCount += mask[i];
  if (onCount === 0) {
    return { mask: new Uint8Array(w*h), w, h,
      report: { coverage: 0, warnings: ['Nothing stood out from the background. Raise sensitivity.'], ok: false } };
  }

  let m = mask;
  if (o.fillHoles) m = fillEnclosed(m, w, h);

  const bridged = dilate(m, w, h, Math.round(o.bridge));
  const { labels } = components(bridged, w, h);
  const nLabels = labels.reduce((mx, v) => Math.max(mx, v), -1) + 1;
  const realSize = new Int32Array(Math.max(1, nLabels));
  for (let i = 0; i < w*h; i++) if (m[i] && labels[i] >= 0) realSize[labels[i]]++;
  let biggest = 0;
  for (let i = 1; i < realSize.length; i++) if (realSize[i] > realSize[biggest]) biggest = i;
  const minSize = realSize[biggest] * o.despeckle;
  const keep = new Uint8Array(realSize.length);
  for (let i = 0; i < realSize.length; i++)
    keep[i] = o.keepLargest ? (i === biggest ? 1 : 0) : (realSize[i] >= minSize ? 1 : 0);

  const finalMask = new Uint8Array(w * h);
  for (let i = 0; i < w*h; i++) finalMask[i] = (m[i] && labels[i] >= 0 && keep[labels[i]]) ? 1 : 0;

  const coverage = onCount / (w*h);
  const warnings = [];
  if (coverage < 0.015) warnings.push('The subject is tiny in frame — move closer or crop in.');
  if (coverage > 0.92) warnings.push('Almost the whole frame was taken as subject. Check the background contrast.');

  return { mask: finalMask, w, h, report: { coverage, warnings, ok: warnings.length === 0 } };
}
