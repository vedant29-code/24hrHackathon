/* geom.js — shared geometry for the photo-to-3D screens.
   Convention: the object lives in a unit cube centred on the origin, x,y,z in
   [-0.5, 0.5]; +Y is up; +Z points out of the object's front toward the FRONT
   camera; +X is to the right in the FRONT photo. */

export const SLOT_DEFS = [
  { key:'front',  label:'Front',      kind:'side',   angle:0,
    hint:'Facing the front of the object', optional:false },
  { key:'right',  label:'Right side', kind:'side',   angle:Math.PI/2,
    hint:'Its front points to your left', optional:false },
  { key:'back',   label:'Back',       kind:'side',   angle:Math.PI,
    hint:'Facing the back of the object', optional:false },
  { key:'left',   label:'Left side',  kind:'side',   angle:3*Math.PI/2,
    hint:'Its front points to your right', optional:false },
  { key:'top',    label:'From above', kind:'top',    angle:0,
    hint:'Front points to the bottom of the photo', optional:false },
  { key:'bottom', label:'From below', kind:'bottom', angle:0,
    hint:'Front points to the top of the photo', optional:false },
  { key:'front-right', label:'Front-Right', kind:'side', angle:Math.PI/4,
    hint:'45° between front and right, slight elevation', optional:true },
  { key:'back-right',  label:'Back-Right',  kind:'side', angle:3*Math.PI/4,
    hint:'45° between right and back, slight elevation', optional:true },
  { key:'back-left',   label:'Back-Left',   kind:'side', angle:5*Math.PI/4,
    hint:'45° between back and left, slight elevation', optional:true },
  { key:'front-left',  label:'Front-Left',  kind:'side', angle:7*Math.PI/4,
    hint:'45° between left and front, slight elevation', optional:true },
];

// A MessageChannel task yields to the event loop without setTimeout's 4ms
// nesting clamp or its one-second clamp in background tabs.
export const breathe = (() => {
  const ch = new MessageChannel();
  let pending = null;
  ch.port1.onmessage = () => { const r = pending; pending = null; if (r) r(); };
  return () => new Promise((resolve) => { pending = resolve; ch.port2.postMessage(0); });
})();

export function project(slot, x, y, z) {
  if (slot.kind === 'side') {
    const c = Math.cos(slot.angle), s = Math.sin(slot.angle);
    return { u: x*c - z*s, v: y, t: x*s + z*c };
  }
  if (slot.kind === 'top') return { u: x, v: -z, t: y };
  return { u: x, v: z, t: -y };
}

// Axes of a view: U is image-right, V is image-up, T points toward the camera.
export function viewBasis(slot) {
  if (slot.kind === 'side') {
    const c = Math.cos(slot.angle), s = Math.sin(slot.angle);
    return { U:[c,0,-s], V:[0,1,0], T:[s,0,c] };
  }
  if (slot.kind === 'top') return { U:[1,0,0], V:[0,0,-1], T:[0,1,0] };
  return { U:[1,0,0], V:[0,0,1], T:[0,-1,0] };
}

export function toImage(slot, p) {
  const t = slot.xform;
  return { u: t.ox + p.u * t.sx, v: t.oy - p.v * t.sy };
}

/* ---- Images ---------------------------------------------------------- */
export function loadImage(url) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => { res(im); URL.revokeObjectURL(url); };
    im.onerror = rej;
    im.src = url;
  });
}

export function imageToImageData(img, MAX = 512) {
  const k = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * k));
  const h = Math.max(1, Math.round(img.naturalHeight * k));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

export function imageDataToJPEG(imageData, quality = 0.9) {
  const c = document.createElement('canvas');
  c.width = imageData.width; c.height = imageData.height;
  c.getContext('2d').putImageData(imageData, 0, 0);
  return c.toDataURL('image/jpeg', quality);
}

/* ---- Masks and distance fields --------------------------------------- */
export function bboxOf(mask, w, h) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!mask[y*w + x]) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 < 0) return null;
  return { x0, y0, x1, y1, cx:(x0+x1)/2, cy:(y0+y1)/2, w:x1-x0+1, h:y1-y0+1 };
}

// Exact Euclidean distance (Felzenszwalb & Huttenlocher lower envelope).
function edt1d(f, n, d, v, z) {
  let k = 0;
  v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q*q) - (f[v[k]] + v[k]*v[k])) / (2*q - 2*v[k]);
    while (s <= z[k]) {
      k--;
      s = ((f[q] + q*q) - (f[v[k]] + v[k]*v[k])) / (2*q - 2*v[k]);
    }
    k++; v[k] = q; z[k] = s; z[k+1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k+1] < q) k++;
    const dx = q - v[k];
    d[q] = dx*dx + f[v[k]];
  }
}
function edt2d(inside, w, h) {
  const g = new Float64Array(w*h);
  for (let i = 0; i < w*h; i++) g[i] = inside[i] ? 1e20 : 0;
  const n = Math.max(w, h);
  const f = new Float64Array(n), d = new Float64Array(n);
  const v = new Int32Array(n), z = new Float64Array(n+1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = g[y*w + x];
    edt1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) g[y*w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    const row = y*w;
    for (let x = 0; x < w; x++) f[x] = g[row + x];
    edt1d(f, w, d, v, z);
    for (let x = 0; x < w; x++) g[row + x] = d[x];
  }
  return g;
}
export function signedDistance(mask, w, h) {
  const inv = new Uint8Array(w*h);
  for (let i = 0; i < w*h; i++) inv[i] = mask[i] ? 0 : 1;
  const dOut = edt2d(mask, w, h), dIn = edt2d(inv, w, h);
  const sdf = new Float32Array(w*h);
  for (let i = 0; i < w*h; i++) sdf[i] = mask[i] ? Math.sqrt(dOut[i]) : -Math.sqrt(dIn[i]);
  return { data: sdf, w, h };
}
export function sampleSDF(sdf, u, v) {
  const fx = u*sdf.w - 0.5, fy = v*sdf.h - 0.5;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  const cx = (x) => Math.min(sdf.w-1, Math.max(0, x));
  const cy = (y) => Math.min(sdf.h-1, Math.max(0, y));
  const a = sdf.data[cy(y0)*sdf.w + cx(x0)], b = sdf.data[cy(y0)*sdf.w + cx(x0+1)];
  const c = sdf.data[cy(y0+1)*sdf.w + cx(x0)], d = sdf.data[cy(y0+1)*sdf.w + cx(x0+1)];
  const top = a + (b-a)*tx, bot = c + (d-c)*tx;
  let val = top + (bot-top)*ty;
  if (u < 0 || u > 1 || v < 0 || v > 1) {
    const ox = Math.max(0, Math.max(-u, u-1)) * sdf.w;
    const oy = Math.max(0, Math.max(-v, v-1)) * sdf.h;
    val -= Math.hypot(ox, oy);
  }
  return val;
}
// Distance (unsigned) from every cell to the nearest "on" pixel — used to
// score how close a recipe's projected edge sits to a drawn wireframe line.
export function unsignedDistance(mask, w, h) {
  const inv = new Uint8Array(w*h);
  for (let i = 0; i < w*h; i++) inv[i] = mask[i] ? 0 : 1;
  const d = edt2d(inv, w, h);
  const out = new Float32Array(w*h);
  for (let i = 0; i < w*h; i++) out[i] = Math.sqrt(d[i]);
  return { data: out, w, h };
}
export function sampleMask(sil, u, v) {
  if (u < 0 || u >= 1 || v < 0 || v >= 1) return 0;
  return sil.mask[((v*sil.h)|0)*sil.w + ((u*sil.w)|0)];
}

/* ---- Alignment --------------------------------------------------------
   Side views share the object's height; the scale is chosen so the widest
   side view still fits. Top and bottom are pinned to the X and Z extents the
   front and right views measured. */
export function computeAlignment(slots, fill = 0.9) {
  const frac = (s) => ({ w: s.bbox.w/s.sil.w, h: s.bbox.h/s.sil.h, aspect: s.sil.w/s.sil.h });
  const identity = () => ({ sx:1, sy:1, ox:0.5, oy:0.5 });
  const sides = slots.filter((s) => s.kind === 'side' && s.bbox);
  if (!sides.length) { for (const s of slots) s.xform = identity(); return; }
  let widest = 1;
  for (const s of sides) {
    const f = frac(s);
    if (f.h > 0) widest = Math.max(widest, f.w*f.aspect/f.h);
  }
  const heightUnits = fill / widest;
  for (const s of sides) {
    const f = frac(s);
    const sy = f.h / heightUnits;
    s.xform = { sx: sy/f.aspect, sy, ox: s.bbox.cx/s.sil.w, oy: s.bbox.cy/s.sil.h };
  }
  const extentOf = (key, fb) => {
    const s = slots.find((v) => v.key === key && v.bbox);
    return s ? frac(s).w / s.xform.sx : fb;
  };
  const eX = extentOf('front', heightUnits), eZ = extentOf('right', eX);
  for (const s of slots) {
    if (s.kind === 'side') continue;
    if (!s.bbox) { s.xform = identity(); continue; }
    const f = frac(s);
    s.xform = { sx: f.w/Math.max(1e-6, eX), sy: f.h/Math.max(1e-6, eZ),
                ox: s.bbox.cx/s.sil.w, oy: s.bbox.cy/s.sil.h };
  }
}

/* ---- Field smoothing: one axis of a separable box blur. Source and
   destination must be different arrays. */
export function blurPass(src, dst, N, axis) {
  const cl = (v) => v < 0 ? 0 : (v > N-1 ? N-1 : v);
  const idx = (x, y, z) => z*N*N + y*N + x;
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let a, c;
    if (axis === 0)      { a = idx(cl(x-1), y, z); c = idx(cl(x+1), y, z); }
    else if (axis === 1) { a = idx(x, cl(y-1), z); c = idx(x, cl(y+1), z); }
    else                 { a = idx(x, y, cl(z-1)); c = idx(x, y, cl(z+1)); }
    const b = idx(x, y, z);
    dst[b] = (src[a] + src[b] + src[c]) / 3;
  }
}

/* ---- Thumbnails -------------------------------------------------------- */
function scaledCanvas(src, sw, sh, maxW) {
  const k = Math.min(1, maxW/sw);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(sw*k)); c.height = Math.max(1, Math.round(sh*k));
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return c;
}
export function thumbOfImage(imageData, maxW) {
  const off = document.createElement('canvas');
  off.width = imageData.width; off.height = imageData.height;
  off.getContext('2d').putImageData(imageData, 0, 0);
  return scaledCanvas(off, imageData.width, imageData.height, maxW);
}
export function thumbOfMask(sil, maxW) {
  const off = document.createElement('canvas');
  off.width = sil.w; off.height = sil.h;
  const ctx = off.getContext('2d');
  const img = ctx.createImageData(sil.w, sil.h);
  for (let i = 0; i < sil.w*sil.h; i++) {
    const v = sil.mask[i] ? 255 : 18;
    img.data[i*4] = v; img.data[i*4+1] = v; img.data[i*4+2] = v; img.data[i*4+3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return scaledCanvas(off, sil.w, sil.h, maxW);
}

/* ---- Export ------------------------------------------------------------ */
export function exportOBJ(mesh, name) {
  const pos = mesh.geometry.attributes.position;
  const nor = mesh.geometry.attributes.normal;
  const count = mesh.count || pos.count;
  const s = mesh.scale.x;
  const lines = ['# built by Photo to 3D'];
  for (let i = 0; i < count; i++)
    lines.push(`v ${(pos.getX(i)*s).toFixed(5)} ${(pos.getY(i)*s).toFixed(5)} ${(pos.getZ(i)*s).toFixed(5)}`);
  for (let i = 0; i < count; i++)
    lines.push(`vn ${nor.getX(i).toFixed(4)} ${nor.getY(i).toFixed(4)} ${nor.getZ(i).toFixed(4)}`);
  for (let i = 0; i < count; i += 3) {
    const a = i+1, b = i+2, c = i+3;
    lines.push(`f ${a}//${a} ${b}//${b} ${c}//${c}`);
  }
  const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
