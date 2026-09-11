/* =============================================================================
   whitematte.js — silhouette extraction engineered for white backgrounds

   A general "is this pixel background?" test has to hedge. Committing to white
   backgrounds means the hard cases can be attacked head-on instead:

     · A soft shadow is neutral grey and only *moderately* darker than the
       backdrop. A black object is also neutral, but far darker. Separating
       those two by darkness alone is impossible; separating them by darkness
       *and* how much light remains is straightforward.

     · A white or chrome part of the object is, by colour, indistinguishable
       from the backdrop. No threshold can recover it. Enclosure can: anything
       the background cannot reach from outside is object, whatever its colour.

     · A thin antenna sits at the same faint contrast as a shadow edge, so any
       threshold harsh enough to kill shadows also erases it. Two thresholds
       plus connectivity keeps the antenna — it touches solid object — while
       dropping the shadow, which does not.

   Nothing here is binary until the last possible moment. Coverage is carried as
   a continuous 0..1 value so anti-aliased edges keep their sub-pixel position
   for the distance field downstream.
   ============================================================================= */

export const DEFAULTS = {
  sensitivity:   0.50,  // 0 = only strong contrast counts, 1 = grab faint detail
  shadowRemoval: 0.65,  // how hard to reject neutral grey cast on the backdrop
  fillHoles:     true,  // recover white/chrome parts the colour test cannot see
  despeckle:     0.02,  // drop blobs smaller than this fraction of the biggest
  keepLargest:   true,  // a single subject per photo
  bridge:        2,     // px gap to bridge before deciding what is connected
  edgeSoftness:  1.0,   // width in px over which the edge fades, for sub-pixel edges
};

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const LUM_R = 0.2126, LUM_G = 0.7152, LUM_B = 0.0722;

/* -----------------------------------------------------------------------------
   Background model

   Sampling a border band and averaging it fails the moment the subject touches
   an edge — a few dark pixels drag the estimate down and the whole matte
   loosens. The median is unmoved by that, so it anchors the estimate, and
   samples far from it are discarded before anything is fitted.

   What remains is fitted as a gentle plane rather than one flat colour, because
   real backdrops are vignetted, lit from one side, or slightly warm on one
   edge. Comparing each pixel against the backdrop *as it is there* rather than
   against a global average is what stops a corner shading off from being read
   as object.
   ----------------------------------------------------------------------------- */
function estimateBackground(px, w, h) {
  const band = Math.max(2, Math.round(Math.min(w, h) * 0.04));
  const xs = [], ys = [], rs = [], gs = [], bs = [];

  const take = (x, y) => {
    const p = (y * w + x) * 4;
    xs.push(x / w - 0.5); ys.push(y / h - 0.5);
    rs.push(px[p]); gs.push(px[p + 1]); bs.push(px[p + 2]);
  };
  const stride = Math.max(1, Math.round(Math.min(w, h) / 220));
  for (let y = 0; y < band; y += stride) for (let x = 0; x < w; x += stride) take(x, y);
  for (let y = h - band; y < h; y += stride) for (let x = 0; x < w; x += stride) take(x, y);
  for (let y = band; y < h - band; y += stride) {
    for (let x = 0; x < band; x += stride) take(x, y);
    for (let x = w - band; x < w; x += stride) take(x, y);
  }

  const med = (arr) => {
    const s = Float64Array.from(arr).sort();
    return s[s.length >> 1];
  };
  const mr = med(rs), mg = med(gs), mb = med(bs);

  // Median absolute deviation gives a spread that a few object pixels cannot
  // inflate, unlike a standard deviation.
  const devs = rs.map((_, i) =>
    Math.abs(rs[i] - mr) + Math.abs(gs[i] - mg) + Math.abs(bs[i] - mb));
  const mad = med(devs) || 1;
  const cutoff = Math.max(18, mad * 3);

  const keep = [];
  for (let i = 0; i < rs.length; i++) if (devs[i] <= cutoff) keep.push(i);
  const inliers = keep.length >= 12 ? keep : rs.map((_, i) => i);

  const plane = (vals) => fitPlane(xs, ys, vals, inliers, med(vals));
  const model = { r: plane(rs), g: plane(gs), b: plane(bs) };

  // How much of the border the subject is running off the edge of, and how
  // uneven the backdrop is — both are reported so a bad photo can be called out
  // rather than silently producing a bad matte.
  const rejected = 1 - inliers.length / Math.max(1, rs.length);
  let spread = 0;
  for (const i of inliers) {
    const l = LUM_R*rs[i] + LUM_G*gs[i] + LUM_B*bs[i];
    const bl = LUM_R*bgAt(model,'r',xs[i],ys[i]) + LUM_G*bgAt(model,'g',xs[i],ys[i])
             + LUM_B*bgAt(model,'b',xs[i],ys[i]);
    spread += Math.abs(l - bl);
  }
  spread /= Math.max(1, inliers.length);

  return { model, level: LUM_R*mr + LUM_G*mg + LUM_B*mb, rejected, spread };
}

// Least squares fit of c(x,y) = a + b·x + c·y, solved on the 3x3 normal
// equations. Falls back to a flat colour if the system is degenerate.
function fitPlane(xs, ys, vals, idx, fallback) {
  let n=0, Sx=0, Sy=0, Sxx=0, Sxy=0, Syy=0, Sc=0, Sxc=0, Syc=0;
  for (const i of idx) {
    const x = xs[i], y = ys[i], c = vals[i];
    n++; Sx+=x; Sy+=y; Sxx+=x*x; Sxy+=x*y; Syy+=y*y;
    Sc+=c; Sxc+=x*c; Syc+=y*c;
  }
  const A = [[n,Sx,Sy],[Sx,Sxx,Sxy],[Sy,Sxy,Syy]];
  const rhs = [Sc,Sxc,Syc];
  const sol = solve3(A, rhs);
  if (!sol) return { a: fallback, b: 0, c: 0 };
  return { a: sol[0], b: sol[1], c: sol[2] };
}
function solve3(A, rhs) {
  const m = [[...A[0], rhs[0]], [...A[1], rhs[1]], [...A[2], rhs[2]]];
  for (let col = 0; col < 3; col++) {
    let piv = col;
    for (let r = col+1; r < 3; r++) if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r;
    if (Math.abs(m[piv][col]) < 1e-9) return null;
    [m[col], m[piv]] = [m[piv], m[col]];
    for (let r = 0; r < 3; r++) {
      if (r === col) continue;
      const f = m[r][col] / m[col][col];
      for (let k = col; k < 4; k++) m[r][k] -= f * m[col][k];
    }
  }
  return [m[0][3]/m[0][0], m[1][3]/m[1][1], m[2][3]/m[2][2]];
}
function bgAt(model, ch, nx, ny) {
  const p = model[ch];
  return p.a + p.b * nx + p.c * ny;
}

/* -----------------------------------------------------------------------------
   Coverage

   Two independent pieces of evidence that a pixel is not backdrop:

     darkness — how much light it has lost relative to the backdrop *at that
                position*, which catches dark and mid-tone subjects;
     colour   — how far its hue and saturation sit from the backdrop, which
                catches bright saturated subjects that lose no light at all,
                like a yellow body against white.

   They are combined by taking whichever is more confident, so a subject only
   has to be distinguishable one way, not both.

   Shadow rejection then subtracts from the darkness term alone, weighted by two
   conditions holding at once: the pixel is nearly neutral, and it still retains
   a good share of the backdrop's light. A grey shadow satisfies both. A black
   object is neutral but retains almost none, so it survives. A coloured object
   fails the neutrality test, so it survives too.
   ----------------------------------------------------------------------------- */
export function computeCoverage(imageData, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const { data: px, width: w, height: h } = imageData;
  const bg = estimateBackground(px, w, h);

  const alpha = new Float32Array(w * h);
  const shadowMap = new Float32Array(w * h);   // for the diagnostic overlay

  // Sensitivity moves both thresholds together; the gap between them is what
  // lets connectivity rescue faint-but-attached detail.
  const hi = 0.34 - 0.26 * o.sensitivity;
  const lo = hi * 0.38;

  for (let y = 0; y < h; y++) {
    const ny = y / h - 0.5;
    for (let x = 0; x < w; x++) {
      const i = y * w + x, p = i * 4;
      const nx = x / w - 0.5;

      const r = px[p], g = px[p+1], b = px[p+2], a = px[p+3];
      if (a < 8) { alpha[i] = 0; continue; }   // already transparent

      const br = bgAt(bg.model,'r',nx,ny), bgg = bgAt(bg.model,'g',nx,ny),
            bb = bgAt(bg.model,'b',nx,ny);
      const bLum = Math.max(1, LUM_R*br + LUM_G*bgg + LUM_B*bb);
      const lum  = LUM_R*r + LUM_G*g + LUM_B*b;

      const ratio = clamp01(lum / bLum);
      const darkness = 1 - ratio;

      // Saturation difference, which is independent of how bright the pixel is.
      const mx = Math.max(r,g,b), mn = Math.min(r,g,b);
      const chroma = (mx - mn) / 255;
      const bmx = Math.max(br,bgg,bb), bmn = Math.min(br,bgg,bb);
      const bChroma = (bmx - bmn) / 255;
      const colourDiff = clamp01(Math.abs(chroma - bChroma) * 3.2);

      // 1 when the pixel is perfectly grey, falling away as colour appears.
      const neutral = 1 - clamp01(chroma / 0.10);
      // Rises across the band where shadows live and stays 0 for genuinely
      // dark subjects, so black objects are never mistaken for their own shadow.
      const stillLit = smoothstep(0.42, 0.88, ratio);
      const shadowness = neutral * stillLit;
      shadowMap[i] = shadowness * darkness;

      const darkTerm = darkness * (1 - o.shadowRemoval * shadowness);
      alpha[i] = clamp01(Math.max(darkTerm, colourDiff));
    }
  }

  return { alpha, shadowMap, w, h, hi, lo, bg, opts: o };
}

/* -----------------------------------------------------------------------------
   Hysteresis

   One threshold cannot serve both jobs. Set it high enough to reject a shadow
   and thin antennas go with it; set it low enough to keep them and the shadow
   returns. Two thresholds separate the questions: the high one decides what is
   definitely subject, the low one decides what is merely plausible, and only
   plausible regions that touch something definite are admitted.

   A shadow is attached to the subject, so being connected is not on its own
   enough — but by this stage shadow pixels have already been pushed below even
   the low threshold by the neutrality test above. Connectivity is what rescues
   faint real detail, not what removes shadow.
   ----------------------------------------------------------------------------- */
function hysteresis(alpha, w, h, hi, lo) {
  const out = new Uint8Array(w * h);
  const stack = [];
  for (let i = 0; i < w*h; i++) {
    if (alpha[i] >= hi) { out[i] = 1; stack.push(i); }
  }
  while (stack.length) {
    const i = stack.pop();
    const x = i % w, y = (i - x) / w;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const qx = x + dx, qy = y + dy;
        if (qx < 0 || qy < 0 || qx >= w || qy >= h) continue;
        const j = qy * w + qx;
        if (out[j] || alpha[j] < lo) continue;
        out[j] = 1; stack.push(j);
      }
    }
  }
  return out;
}

/* Anything the outside cannot reach is interior, whatever colour it is. This is
   what recovers a white fuselage or a blown-out specular highlight — pixels the
   colour test has no way to claim, because they genuinely match the backdrop. */
function fillEnclosed(mask, w, h) {
  const outside = new Uint8Array(w * h);
  const stack = [];
  const push = (i) => { if (!mask[i] && !outside[i]) { outside[i] = 1; stack.push(i); } };
  for (let x = 0; x < w; x++) { push(x); push((h-1)*w + x); }
  for (let y = 0; y < h; y++) { push(y*w); push(y*w + w - 1); }
  while (stack.length) {
    const i = stack.pop();
    const x = i % w, y = (i - x) / w;
    if (x > 0)   push(i - 1);
    if (x < w-1) push(i + 1);
    if (y > 0)   push(i - w);
    if (y < h-1) push(i + w);
  }
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w*h; i++) out[i] = outside[i] ? 0 : 1;
  return out;
}

/* Widen the mask by a couple of pixels purely to decide what counts as joined.
   An antenna, a wire, or a propeller blade is often only one pixel wide, and
   anti-aliasing or JPEG ringing can break it just enough to leave it floating —
   at which point "keep the largest piece" throws away a real part of the
   object. Deciding connectivity on a slightly fattened copy bridges those
   hairline gaps, while the pixels actually kept still come from the original
   mask, so nothing is thickened in the result. */
function dilate(mask, w, h, r) {
  if (r <= 0) return mask;
  const tmp = new Uint8Array(w*h), out = new Uint8Array(w*h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let d = -r; d <= r && !v; d++) {
        const q = x + d;
        if (q >= 0 && q < w && mask[y*w + q]) v = 1;
      }
      tmp[y*w + x] = v;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let d = -r; d <= r && !v; d++) {
        const q = y + d;
        if (q >= 0 && q < h && tmp[q*w + x]) v = 1;
      }
      out[y*w + x] = v;
    }
  }
  return out;
}

// Connected components, largest first.
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

/* -----------------------------------------------------------------------------
   Main entry point
   ----------------------------------------------------------------------------- */
export function extractMatte(imageData, opts = {}) {
  const cov = computeCoverage(imageData, opts);
  const { alpha, shadowMap, w, h, hi, lo, bg, opts: o } = cov;

  let mask = hysteresis(alpha, w, h, hi, lo);

  const afterThreshold = count(mask);
  if (afterThreshold === 0) {
    return emptyResult(alpha, shadowMap, w, h, bg, o,
      'Nothing stood out from the background. Raise sensitivity.');
  }

  if (o.fillHoles) mask = fillEnclosed(mask, w, h);
  const afterFill = count(mask);

  /* Drop dust and compression speckle, but judge connectivity on a bridged copy
     so hairline appendages stay attached to the body they belong to. Sizes are
     measured on the real mask, so bridging never inflates a speck into
     something that survives the despeckle test. */
  const bridged = dilate(mask, w, h, Math.round(o.bridge));
  const { labels } = components(bridged, w, h);
  const nLabels = labels.reduce((m, v) => Math.max(m, v), -1) + 1;
  const realSize = new Int32Array(Math.max(1, nLabels));
  for (let i = 0; i < w*h; i++) {
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
  for (let i = 0; i < w*h; i++)
    finalMask[i] = (mask[i] && labels[i] >= 0 && keep[labels[i]]) ? 1 : 0;

  /* Soft coverage for the surface builder: inside the subject it is solid, and
     across the boundary it follows the underlying alpha. Keeping that ramp lets
     the distance field place an edge between pixels instead of snapping to the
     nearest one, which is where sub-pixel accuracy at the silhouette comes
     from. */
  const soft = new Float32Array(w * h);
  const k = Math.max(0.001, o.edgeSoftness);
  for (let i = 0; i < w*h; i++) {
    if (!finalMask[i]) { soft[i] = 0; continue; }
    soft[i] = clamp01(0.5 + (alpha[i] - lo) / Math.max(1e-4, (hi - lo)) * 0.5 / k);
  }

  return {
    mask: finalMask,
    alpha,
    soft,
    shadowMap,
    w, h,
    report: buildReport(finalMask, alpha, shadowMap, w, h, bg, o,
                        afterThreshold, afterFill),
  };
}

function count(m) { let n = 0; for (let i = 0; i < m.length; i++) n += m[i]; return n; }

function emptyResult(alpha, shadowMap, w, h, bg, o, warning) {
  return {
    mask: new Uint8Array(w*h), alpha, soft: new Float32Array(w*h), shadowMap, w, h,
    report: { coverage:0, shadowRejected:0, recovered:0, borderTouch:0,
              backgroundLevel: bg.level, uniformity: bg.spread,
              warnings: [warning], ok:false },
  };
}

/* A report the caller can act on. A matte that is technically produced but
   built from a cropped subject or a grey backdrop will quietly poison every
   later stage, so those conditions are named here rather than discovered as a
   strange-looking model three steps downstream. */
function buildReport(mask, alpha, shadowMap, w, h, bg, o, afterThreshold, afterFill) {
  const total = w * h;
  const on = count(mask);
  const coverage = on / total;

  let border = 0, borderOn = 0;
  for (let x = 0; x < w; x++) {
    borderOn += mask[x] + mask[(h-1)*w + x]; border += 2;
  }
  for (let y = 0; y < h; y++) {
    borderOn += mask[y*w] + mask[y*w + w - 1]; border += 2;
  }
  const borderTouch = borderOn / border;

  let shadowSum = 0;
  for (let i = 0; i < total; i++) if (!mask[i]) shadowSum += shadowMap[i];
  const shadowRejected = shadowSum / total;

  const warnings = [];
  if (coverage < 0.015)
    warnings.push('The subject is tiny in frame — move closer or crop in.');
  if (coverage > 0.92)
    warnings.push('Almost the whole frame was taken as subject. Check the background is white.');
  if (borderTouch > 0.06)
    warnings.push('The subject runs off the edge of the photo. Leave a margin all round.');
  if (bg.level < 170)
    warnings.push('The background is not white — this tool is tuned for white backdrops.');
  if (bg.spread > 14)
    warnings.push('The background brightness is uneven. Light the backdrop more evenly.');
  if (bg.rejected > 0.35)
    warnings.push('Much of the border looks like subject, so the background reading may be off.');
  if (shadowRejected > 0.06)
    warnings.push('A large shadow was removed. Check the cut-out kept the whole object.');

  return {
    coverage,
    borderTouch,
    shadowRejected,
    recovered: Math.max(0, (afterFill - afterThreshold) / Math.max(1, afterFill)),
    backgroundLevel: bg.level,
    uniformity: bg.spread,
    warnings,
    ok: warnings.length === 0,
  };
}
