/* recipe.js — the AI's shape recipe: simple parts in the shared cube, turned
   into one smooth distance function, then fitted against the photo outlines. */
import { viewBasis, toImage, sampleMask, sampleSDF, unsignedDistance, breathe } from './geom.js';

export const SHAPES = ['ellipsoid', 'box', 'cylinder', 'capsule', 'plate'];
const DIRS = { '+x':[1,0,0], '-x':[-1,0,0], '+y':[0,1,0], '-y':[0,-1,0], '+z':[0,0,1], '-z':[0,0,-1] };
const MIRROR_DIR = { '+x':'-x', '-x':'+x' };

const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
const num = (v, d) => (typeof v === 'number' && isFinite(v)) ? v : d;

/* ---- Cleaning whatever the AI returned ---------------------------------- */
export function normalizeRecipe(raw) {
  let cleanRaw = typeof raw === 'string' ? raw.trim() : raw;
  if (typeof cleanRaw === 'string' && cleanRaw.startsWith('```')) {
    cleanRaw = cleanRaw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  }
  const r = typeof cleanRaw === 'string' ? JSON.parse(cleanRaw) : cleanRaw;
  if (!r || !Array.isArray(r.parts)) throw new Error('The recipe has no "parts" list.');
  const parts = r.parts.filter((p) => p && SHAPES.includes(p.shape)).map((p, i) => ({
    name: String(p.name || `part ${i+1}`),
    shape: p.shape,
    operation: p.operation === 'subtract' ? 'subtract' : 'add',
    center: [0,1,2].map((k) => clamp(num(p.center?.[k], 0), -0.6, 0.6)),
    size: [0,1,2].map((k) => clamp(Math.abs(num(p.size?.[k], 0.2)), 0.005, 1.2)),
    direction: DIRS[p.direction] ? p.direction : '+z',
    length: clamp(Math.abs(num(p.length, 0.3)), 0.005, 1.4),
    diameter: clamp(Math.abs(num(p.diameter, 0.1)), 0.005, 1.2),
    taper: clamp(num(p.taper, 1), 0, 1),
    span: clamp(Math.abs(num(p.span, 0.3)), 0.005, 1.2),
    root_chord: clamp(Math.abs(num(p.root_chord, 0.2)), 0.005, 1.2),
    tip_chord: clamp(Math.abs(num(p.tip_chord, 0.1)), 0, 1.2),
    thickness: clamp(Math.abs(num(p.thickness, 0.02)), 0.004, 0.5),
    sweep: clamp(num(p.sweep, 0), -1, 1),
    rounding: clamp(num(p.rounding, 0), 0, 1),
    mirror: !!p.mirror,
  }));
  if (!parts.length) throw new Error('The recipe has no usable parts.');
  const fit = r.fit || {};
  const partNames = new Set(parts.map((p) => p.name));
  const constraints = Array.isArray(r.constraints) ? r.constraints
    .filter((c) => c && ['equal_length', 'symmetric', 'planar'].includes(c.type)
      && Array.isArray(c.parts) && c.parts.filter((n) => partNames.has(n)).length >= 2)
    .map((c) => ({ type: c.type, parts: c.parts.filter((n) => partNames.has(n)) }))
    : [];
  return {
    object_name: String(r.object_name || 'object'),
    summary: String(r.summary || ''),
    parts,
    constraints,
    fit: {
      scale: clamp(num(fit.scale, 1), 0.2, 3),
      offset: [0,1,2].map((k) => clamp(num(fit.offset?.[k], 0), -0.5, 0.5)),
    },
  };
}

/* ---- Distance functions (negative inside) ------------------------------- */
function sdEllipsoid(x, y, z, rx, ry, rz) {
  const k0 = Math.hypot(x/rx, y/ry, z/rz);
  const k1 = Math.hypot(x/(rx*rx), y/(ry*ry), z/(rz*rz));
  return k1 > 1e-9 ? k0*(k0-1)/k1 : -Math.min(rx, ry, rz);
}
function sdRoundBox(x, y, z, bx, by, bz, r) {
  const qx = Math.abs(x)-bx+r, qy = Math.abs(y)-by+r, qz = Math.abs(z)-bz+r;
  return Math.hypot(Math.max(qx,0), Math.max(qy,0), Math.max(qz,0))
       + Math.min(Math.max(qx, qy, qz), 0) - r;
}
// Cone/cylinder along local y: radius r1 at y=-h, r2 at y=+h.
function sdCappedCone(px, py, pz, h, r1, r2) {
  const qx = Math.hypot(px, pz), qy = py;
  const k2x = r2 - r1, k2y = 2*h;
  const cax = qx - Math.min(qx, qy < 0 ? r1 : r2), cay = Math.abs(qy) - h;
  const t = clamp(((r2 - qx)*k2x + (h - qy)*k2y) / (k2x*k2x + k2y*k2y), 0, 1);
  const cbx = qx - r2 + k2x*t, cby = qy - h + k2y*t;
  const s = (cbx < 0 && cay < 0) ? -1 : 1;
  return s * Math.sqrt(Math.min(cax*cax + cay*cay, cbx*cbx + cby*cby));
}
function sdCapsule(px, py, pz, h, r) {
  const y = py - clamp(py, -h, h);
  return Math.hypot(px, y, pz) - r;
}
function smin(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h*h*k*0.25;
}

function axisFrame(dir) {
  const D = DIRS[dir];
  if (D[1] !== 0) return { D, A:[1,0,0], B:[0,0,1] };
  if (D[0] !== 0) return { D, A:[0,1,0], B:[0,0,1] };
  return { D, A:[1,0,0], B:[0,1,0] };
}
// Plate: span along D, chord along +Z (front), thickness along the third axis.
function plateFrame(dir) {
  const D = DIRS[dir];
  const C = D[2] !== 0 ? [1,0,0] : [0,0,1];
  const W = [D[1]*C[2]-D[2]*C[1], D[2]*C[0]-D[0]*C[2], D[0]*C[1]-D[1]*C[0]];
  return { D, C, W };
}
const dot = (x, y, z, v) => x*v[0] + y*v[1] + z*v[2];

function partSDF(p) {
  const [cx, cy, cz] = p.center;
  switch (p.shape) {
    case 'ellipsoid': {
      const rx = p.size[0]/2, ry = p.size[1]/2, rz = p.size[2]/2;
      return (x, y, z) => sdEllipsoid(x-cx, y-cy, z-cz, rx, ry, rz);
    }
    case 'box': {
      const bx = p.size[0]/2, by = p.size[1]/2, bz = p.size[2]/2;
      const r = p.rounding * Math.min(bx, by, bz);
      return (x, y, z) => sdRoundBox(x-cx, y-cy, z-cz, bx, by, bz, r);
    }
    case 'cylinder': {
      const { D, A, B } = axisFrame(p.direction);
      const h = p.length/2, r1 = p.diameter/2, r2 = r1*p.taper;
      return (x, y, z) => {
        const dx = x-cx, dy = y-cy, dz = z-cz;
        return sdCappedCone(dot(dx,dy,dz,A), dot(dx,dy,dz,D), dot(dx,dy,dz,B), h, r1, r2);
      };
    }
    case 'capsule': {
      const { D, A, B } = axisFrame(p.direction);
      const r = p.diameter/2, h = Math.max(0, p.length/2 - r);
      return (x, y, z) => {
        const dx = x-cx, dy = y-cy, dz = z-cz;
        return sdCapsule(dot(dx,dy,dz,A), dot(dx,dy,dz,D), dot(dx,dy,dz,B), h, r);
      };
    }
    case 'plate': {
      // Trapezoid in (span s, chord q) extruded by thickness. Root edge from
      // (0, ±R/2); tip edge centred at q = -sweep, half-length T/2.
      const { D, C, W } = plateFrame(p.direction);
      const S = Math.max(p.span, 0.005), R = p.root_chord, T = p.tip_chord;
      const sw = p.sweep, th = p.thickness;
      const leq = -sw + T/2 - R/2, leL = Math.hypot(S, leq);
      const nL0 = -leq/leL, nL1 = S/leL;
      const teq = -sw - T/2 + R/2, teL = Math.hypot(S, teq);
      const nT0 = teq/teL, nT1 = -S/teL;
      return (x, y, z) => {
        const dx = x-cx, dy = y-cy, dz = z-cz;
        const s = dot(dx,dy,dz,D), q = dot(dx,dy,dz,C), w = dot(dx,dy,dz,W);
        const d2 = Math.max(-s, s - S, s*nL0 + (q - R/2)*nL1, s*nT0 + (q + R/2)*nT1);
        const wy = Math.abs(w) - th/2;
        return Math.min(Math.max(d2, wy), 0) + Math.hypot(Math.max(d2, 0), Math.max(wy, 0));
      };
    }
  }
  return () => 1e9;
}

function expand(parts) {
  const out = [];
  for (const p of parts) {
    out.push(p);
    if (p.mirror) out.push({ ...p, center: [-p.center[0], p.center[1], p.center[2]],
                             direction: MIRROR_DIR[p.direction] || p.direction });
  }
  return out;
}

// One distance function for the whole recipe: parts blended smoothly, holes
// carved, then the fitted scale and offset applied.
export function compileRecipe(recipe, blend = 0.015) {
  const adds = [], subs = [];
  for (const p of expand(recipe.parts)) (p.operation === 'subtract' ? subs : adds).push(partSDF(p));
  const s = recipe.fit.scale, [ox, oy, oz] = recipe.fit.offset;
  return (x, y, z) => {
    const px = (x-ox)/s, py = (y-oy)/s, pz = (z-oz)/s;
    let d = 1e9;
    for (let i = 0; i < adds.length; i++) d = smin(d, adds[i](px, py, pz), blend);
    for (let i = 0; i < subs.length; i++) d = Math.max(d, -subs[i](px, py, pz));
    return d * s;
  };
}

/* ---- Matching against the photos -----------------------------------------
   Each view's outline is resampled onto a G×G grid in the cube's own units.
   The recipe is ray-marched along each view's axis to get its outline on the
   same grid, and the two are compared by overlap (IoU). */
export function makeTargets(slots, G) {
  return slots.map((s) => {
    const B = viewBasis(s);
    const mask = new Uint8Array(G*G);
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
      const a = -0.5 + (i + 0.5)/G, b = 0.5 - (j + 0.5)/G;
      const im = toImage(s, { u: a, v: b });
      mask[j*G + i] = sampleMask(s.sil, im.u, im.v);
    }
    return { B, mask };
  });
}

function hits(f, a, b, B) {
  const { U, V, T } = B;
  const ox = a*U[0] + b*V[0], oy = a*U[1] + b*V[1], oz = a*U[2] + b*V[2];
  let t = -0.8;
  for (let k = 0; k < 80; k++) {
    const d = f(ox + t*T[0], oy + t*T[1], oz + t*T[2]);
    if (d < 0.0015) return true;
    t += Math.max(d*0.9, 0.003);
    if (t > 0.8) return false;
  }
  return false;
}

export function scoreRecipe(recipe, targets, G) {
  const f = compileRecipe(recipe);
  let sum = 0;
  for (const { B, mask } of targets) {
    let inter = 0, uni = 0;
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
      const m = mask[j*G + i];
      const h = hits(f, -0.5 + (i + 0.5)/G, 0.5 - (j + 0.5)/G, B);
      if (h && m) inter++;
      if (h || m) uni++;
    }
    sum += uni ? inter/uni : 1;
  }
  return sum / targets.length;
}

export function scoreRecipePerView(recipe, targets, G) {
  const f = compileRecipe(recipe);
  return targets.map(({ B, mask }) => {
    let inter = 0, uni = 0;
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
      const m = mask[j*G + i];
      const h = hits(f, -0.5 + (i + 0.5)/G, 0.5 - (j + 0.5)/G, B);
      if (h && m) inter++;
      if (h || m) uni++;
    }
    return uni ? inter/uni : 1;
  });
}

/* ---- Edge-alignment fitting -----------------------------------------------
   Wireframe drawings carry no filled area to overlap, only lines. Instead of
   IoU, the recipe's own silhouette boundary (computed by ray-marching, same as
   scoreRecipe) is compared against the drawn wireframe lines by a symmetric
   chamfer distance on a small grid: every recipe-boundary cell wants a nearby
   drawn line, and every drawn line wants a nearby recipe-boundary cell. That
   second direction is what stops the recipe from matching only part of the
   drawing. */
function recipeBoundaryGrid(f, B, G) {
  const grid = new Uint8Array(G*G);
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
    const a = -0.5 + (i + 0.5)/G, b = 0.5 - (j + 0.5)/G;
    grid[j*G + i] = hits(f, a, b, B) ? 1 : 0;
  }
  const boundary = new Uint8Array(G*G);
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
    const v = grid[j*G + i];
    const l = i > 0 ? grid[j*G + i - 1] : v, r = i < G-1 ? grid[j*G + i + 1] : v;
    const u = j > 0 ? grid[(j-1)*G + i] : v, d = j < G-1 ? grid[(j+1)*G + i] : v;
    boundary[j*G + i] = (v !== l || v !== r || v !== u || v !== d) ? 1 : 0;
  }
  return boundary;
}

// One slot's wireframe lines, reduced to a distance field on the SAME G×G
// grid as the recipe boundary. Built from an exact Euclidean distance
// transform of the full-resolution line mask, then BILINEARLY sampled down
// to the grid — never point-sampled. A wireframe stroke is only a few pixels
// wide on a ~1000px render; at a 32-cell fitting grid each cell spans ~30px,
// so nearest-pixel sampling would miss the line entirely most of the time and
// silently score every shape as "no match anywhere". Sampling a continuous
// distance field instead means every grid cell gets the true distance to the
// nearest line, however thin, with no aliasing.
export function makeTargetsWireframe(slots, G) {
  return slots.map((s) => {
    const B = viewBasis(s);
    const fullDist = unsignedDistance(s.lineMask, s.sil.w, s.sil.h);
    // Approximate px-per-grid-cell so the sampled distance lands in the same
    // units (grid cells) as the recipe boundary's own distance field below.
    const pxPerCell = Math.max(1e-6, (s.xform.sx * s.sil.w) / G);
    const lineDist = { data: new Float32Array(G*G), w: G, h: G };
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
      const a = -0.5 + (i + 0.5)/G, b = 0.5 - (j + 0.5)/G;
      const im = toImage(s, { u: a, v: b });
      lineDist.data[j*G + i] = sampleSDF(fullDist, im.u, im.v) / pxPerCell;
    }
    return { B, lineDist };
  });
}

function chamferScore(recipe, targets, G, f) {
  const decay = Math.max(1, G * 0.06);
  const scores = [];
  for (const { B, lineDist } of targets) {
    const boundary = recipeBoundaryGrid(f, B, G);
    const boundaryDist = unsignedDistance(boundary, G, G);
    let a = 0, na = 0, wSum = 0, wScored = 0;
    for (let k = 0; k < G*G; k++) {
      if (boundary[k]) { a += Math.exp(-lineDist.data[k] / decay); na++; }
      // Soft "is this a drawn line" weight from the continuous distance field,
      // replacing a hard binary test that thin lines would fail under aliasing.
      const w = Math.exp(-lineDist.data[k] / decay);
      wSum += w;
      wScored += w * Math.exp(-boundaryDist.data[k] / decay);
    }
    const scoreA = na ? a/na : 0, scoreB = wSum > 1e-6 ? wScored / wSum : 0;
    scores.push((scoreA + scoreB) / 2);
  }
  return scores;
}

export function scoreRecipeEdges(recipe, targets, G) {
  const scores = chamferScore(recipe, targets, G, compileRecipe(recipe));
  return scores.reduce((s, v) => s + v, 0) / Math.max(1, scores.length);
}

export function scoreRecipePerViewEdges(recipe, targets, G) {
  return chamferScore(recipe, targets, G, compileRecipe(recipe));
}

/* ---- Geometric constraints (the doc's L_geometry) --------------------------
   The AI can state relationships between named parts — "these two arms should
   be equal length", "these three struts are symmetric" — that a silhouette
   alone can't enforce, because a photo's outline is consistent with many
   slightly-mismatched interpretations. Each constraint is scored 0..1, 1 being
   perfectly satisfied, and averaged. */
function partMetric(p) {
  switch (p.shape) {
    case 'ellipsoid': case 'box': return Math.hypot(p.size[0], p.size[1], p.size[2]);
    case 'cylinder': case 'capsule': return p.length;
    case 'plate': return p.span;
    default: return 0;
  }
}
export function constraintScore(recipe) {
  const cons = recipe.constraints || [];
  if (!cons.length) return 1;
  let total = 0;
  for (const c of cons) {
    const parts = c.parts.map((n) => recipe.parts.find((p) => p.name === n)).filter(Boolean);
    if (parts.length < 2) { total += 1; continue; }
    if (c.type === 'equal_length' || c.type === 'symmetric') {
      const vals = parts.map(partMetric);
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      const variance = vals.reduce((a, v) => a + (v - mean) ** 2, 0) / vals.length;
      const relDev = mean > 1e-6 ? Math.sqrt(variance) / mean : 0;
      total += Math.exp(-relDev * 8);
    } else if (c.type === 'planar') {
      // Least-squares plane through the part centers; score by how far they
      // sit from it relative to the group's own spread.
      const pts = parts.map((p) => p.center);
      const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length;
      const cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
      const cz = pts.reduce((a, p) => a + p[2], 0) / pts.length;
      let sumSq = 0, spread = 0;
      // Normal = smallest-variance axis direction, approximated by the axis
      // with least spread among the three — good enough for a handful of points.
      const spreads = [0, 1, 2].map((k) => pts.reduce((a, p) => a + (p[k] - [cx, cy, cz][k]) ** 2, 0));
      const axis = spreads.indexOf(Math.min(...spreads));
      for (const p of pts) {
        const d = p[axis] - [cx, cy, cz][axis];
        sumSq += d * d;
        spread += (p[0]-cx)**2 + (p[1]-cy)**2 + (p[2]-cz)**2;
      }
      const relDev = spread > 1e-6 ? Math.sqrt(sumSq / pts.length) / Math.sqrt(spread / pts.length) : 0;
      total += Math.exp(-relDev * 8);
    } else {
      total += 1;
    }
  }
  return total / cons.length;
}

/* ---- Regularization (the doc's L_regularization) ---------------------------
   Keeps the optimizer from chasing one loss term into a bizarre shape: every
   parameter is penalized for drifting far from the AI's own initial guess,
   relative to that parameter's own scale. */
export function regularizationScore(recipe, initial) {
  if (!initial) return 1;
  const cur = fitParams(recipe), init = fitParams(initial);
  if (!cur.length) return 1;
  let sum = 0;
  for (let i = 0; i < cur.length; i++) {
    const c = cur[i].get(), b = init[i] ? init[i].get() : c;
    const scale = Math.max(1e-3, Math.abs(b));
    sum += ((c - b) / scale) ** 2;
  }
  const rms = Math.sqrt(sum / cur.length);
  return Math.exp(-rms * 2);
}

/* ---- Combined objective (the doc's L = wS·silhouette + wG·geometry + wR·reg)
   Landmark and depth terms are left out for v0.1 — they need a landmark
   detector or a depth model this app doesn't have yet. Silhouette (edge
   alignment against the wireframe drawings) carries almost all the weight;
   geometry and regularization are light correctives, not primary evidence. */
export function scoreRecipeCombined(recipe, targets, G, { wEdge = 1, wGeom = 0.15, wReg = 0.05, initial = null } = {}) {
  const edge = scoreRecipeEdges(recipe, targets, G);
  const geom = constraintScore(recipe);
  const reg = regularizationScore(recipe, initial);
  return (wEdge*edge + wGeom*geom + wReg*reg) / (wEdge + wGeom + wReg);
}

function fitParams(r) {
  const P = [];
  const add = (obj, key, step, min, max, name) =>
    P.push({ get: () => obj[key], set: (v) => { obj[key] = clamp(v, min, max); }, step, name });
  add(r.fit, 'scale', 0.06, 0.2, 3, 'overall scale');
  const axis = ['x','y','z'];
  for (let k = 0; k < 3; k++) add(r.fit.offset, k, 0.02, -0.5, 0.5, `offset ${axis[k]}`);
  for (const p of r.parts) {
    for (let k = 0; k < 3; k++) add(p.center, k, 0.02, -0.6, 0.6, `${p.name} center ${axis[k]}`);
    switch (p.shape) {
      case 'ellipsoid':
      case 'box':
        add(p.size, 0, 0.03, 0.005, 1.2, `${p.name} width`);
        add(p.size, 1, 0.03, 0.005, 1.2, `${p.name} height`);
        add(p.size, 2, 0.03, 0.005, 1.2, `${p.name} depth`);
        if (p.shape === 'box') add(p, 'rounding', 0.1, 0, 1, `${p.name} rounding`);
        break;
      case 'cylinder':
        add(p, 'length', 0.03, 0.005, 1.4, `${p.name} length`); add(p, 'diameter', 0.02, 0.005, 1.2, `${p.name} diameter`);
        add(p, 'taper', 0.1, 0, 1, `${p.name} taper`);
        break;
      case 'capsule':
        add(p, 'length', 0.03, 0.005, 1.4, `${p.name} length`); add(p, 'diameter', 0.02, 0.005, 1.2, `${p.name} diameter`);
        break;
      case 'plate':
        add(p, 'span', 0.03, 0.005, 1.2, `${p.name} span`); add(p, 'root_chord', 0.03, 0.005, 1.2, `${p.name} root chord`);
        add(p, 'tip_chord', 0.02, 0, 1.2, `${p.name} tip chord`); add(p, 'sweep', 0.03, -1, 1, `${p.name} sweep`);
        add(p, 'thickness', 0.01, 0.004, 0.5, `${p.name} thickness`);
        break;
    }
  }
  return P;
}

/* Coordinate descent: nudge one number at a time and keep moving the same way
   while the outlines keep matching better, then halve the step each pass. A
   single step per pass would cap how far any number can travel, so an AI guess
   that starts well off would never reach the photos. Edits `recipe` in place. */
export async function fitRecipe(recipe, targets, G, { passes = 4, onProgress, onStep, pause,
    scoreFn = scoreRecipe, perViewFn = scoreRecipePerView } = {}) {
  let best = scoreFn(recipe, targets, G);
  const params = fitParams(recipe);
  const total = passes * params.length;
  let done = 0;
  let lastStepTime = 0;
  for (let pass = 0; pass < passes; pass++) {
    const scale = Math.pow(0.5, pass);
    for (const prm of params) {
      for (const dir of [1, -1]) {
        let moved = false;
        for (let k = 0; k < 12; k++) {
          const base = prm.get();
          prm.set(base + dir * prm.step * scale);
          if (prm.get() === base) break;
          const sc = scoreFn(recipe, targets, G);
          if (sc > best + 1e-4) { best = sc; moved = true; continue; }
          prm.set(base);
          break;
        }
        if (moved) break;
      }
      done++;
      if (onProgress && done % 2 === 0) { onProgress(done / total, best); await breathe(); }

      const now = performance.now();
      if (onStep && (!lastStepTime || now - lastStepTime > 120)) {
        lastStepTime = now;
        onStep({
          paramName: prm.name,
          paramIndex: done,
          totalParams: total,
          pass,
          score: best,
          perView: perViewFn(recipe, targets, G),
        });
      }
      if (pause) await pause();
    }
  }
  return best;
}

/* =============================================================================
   fitRecipeAdvanced — coarse-to-fine, annealed, adaptive-step optimizer.

   Plain coordinate descent (fitRecipe above) only ever takes a step if it
   immediately helps, so it stalls in the first local minimum it finds — an AI
   guess that's rotated the wrong way round, or has two parts swapped, never
   escapes. Three ideas fix that, borrowed from real nonlinear optimization:

   1. COARSE-TO-FINE — fit on a small evidence grid first (cheap, forgiving,
      only the gross shape matters) and only refine on a fine grid once the
      gross shape is right. Wrong global structure is fixed while it's cheap
      to fix, not after 100k fine-grid evaluations have already committed to it.

   2. SIMULATED ANNEALING — before descending, take randomly-sized random-
      direction jumps and accept a worse result with probability exp(Δ/T). A
      high starting temperature lets it jump out of shallow local minima; the
      temperature cools every pass so late jumps behave like plain descent.
      This is the exploration phase.

   3. ADAPTIVE STEP SIZE (Rprop) — once close to a minimum, each parameter
      remembers its own step size: doubles it after a run of successes, cuts
      it after a failure. Parameters that need a big move (an AI guess way off
      on scale) get there in a handful of steps instead of hundreds of tiny
      ones; parameters that are already close take small, precise ones. This
      is the exploitation phase, run after annealing at every grid resolution.
   ============================================================================= */
async function annealPass(recipe, score, { passes, temperature, onProgress, onStep, pause, meta }) {
  const params = fitParams(recipe);
  let cur = score(recipe);
  let best = cur;
  let bestSnapshot = params.map((p) => p.get());
  const total = Math.max(1, passes * params.length);
  let done = 0, lastStepTime = 0;
  for (let pass = 0; pass < passes; pass++) {
    const T = temperature * Math.pow(0.2, pass);
    for (const prm of params) {
      const base = prm.get();
      const jump = prm.step * (2 + 6 * Math.random()) * (Math.random() < 0.5 ? -1 : 1);
      prm.set(base + jump);
      if (prm.get() !== base) {
        const sc = score(recipe);
        const delta = sc - cur;
        if (delta > 0 || Math.random() < Math.exp(delta / Math.max(1e-6, T))) {
          cur = sc;
          if (sc > best) { best = sc; bestSnapshot = params.map((p) => p.get()); }
        } else {
          prm.set(base);
        }
      }
      done++;
      if (onProgress && done % 2 === 0) { onProgress(done / total, best); await breathe(); }
      const now = performance.now();
      if (onStep && (!lastStepTime || now - lastStepTime > 120)) {
        lastStepTime = now;
        onStep({ phase: 'explore', paramName: prm.name, score: best, temperature: T, ...meta });
      }
      if (pause) await pause();
    }
  }
  params.forEach((p, i) => p.set(bestSnapshot[i]));
  return best;
}

async function adaptiveDescentPass(recipe, score, { passes, onProgress, onStep, pause, meta, perViewFn, targets, G }) {
  const params = fitParams(recipe);
  let best = score(recipe);
  const stepScale = params.map((p) => p.step);
  const total = Math.max(1, passes * params.length);
  let done = 0, lastStepTime = 0;
  for (let pass = 0; pass < passes; pass++) {
    for (let i = 0; i < params.length; i++) {
      const prm = params[i];
      let moved = false;
      for (const dir of [1, -1]) {
        for (let k = 0; k < 10; k++) {
          const base = prm.get();
          prm.set(base + dir * stepScale[i]);
          if (prm.get() === base) break;
          const sc = score(recipe);
          if (sc > best + 1e-5) { best = sc; moved = true; stepScale[i] *= 1.35; continue; }
          prm.set(base);
          break;
        }
        if (moved) break;
      }
      if (!moved) stepScale[i] = Math.max(prm.step * 0.05, stepScale[i] * 0.55);
      done++;
      if (onProgress && done % 2 === 0) { onProgress(done / total, best); await breathe(); }
      const now = performance.now();
      if (onStep && (!lastStepTime || now - lastStepTime > 120)) {
        lastStepTime = now;
        onStep({ phase: 'refine', paramName: prm.name, score: best,
                 perView: perViewFn ? perViewFn(recipe, targets, G) : undefined, ...meta });
      }
      if (pause) await pause();
    }
  }
  return best;
}

export async function fitRecipeAdvanced(recipe, targetsFactory, {
  gridSchedule = [16, 24, 32, 48],
  annealPasses = 3, descentPasses = 4,
  scoreFn = scoreRecipeCombined, scoreOpts = {}, perViewFn = scoreRecipePerViewEdges,
  onProgress, onStep, pause,
} = {}) {
  let best = 0;
  const totalStages = gridSchedule.length;
  for (let stage = 0; stage < totalStages; stage++) {
    const G = gridSchedule[stage];
    const targets = targetsFactory(G);
    const score = (r) => scoreFn(r, targets, G, scoreOpts);
    const meta = { stage, totalStages, grid: G };

    // Early stages get a hot temperature (worth exploring, cheap to evaluate);
    // late, fine-grid stages get a cool one (just polishing an already-good fit).
    const temperature = 0.12 * (1 - stage / totalStages) + 0.01;
    await annealPass(recipe, score, { passes: annealPasses, temperature, onProgress, onStep, pause, meta });
    best = await adaptiveDescentPass(recipe, score, {
      passes: descentPasses, onProgress, onStep, pause, meta, perViewFn, targets, G,
    });
  }
  return best;
}
