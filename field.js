// field.js
import { breathe, computeAlignment, project, toImage, sampleSDF, blurPass } from './geom.js';
import { compileRecipe } from './recipe.js';

export async function buildField(slots, recipe, mode, N, smoothPasses, onProgress) {
  const activeSlots = slots.filter(s => s.imageData && s.bbox);
  const needPhotos = mode !== 'ai';
  if (needPhotos) computeAlignment(slots);
  const f = mode !== 'photos' ? compileRecipe(recipe) : null;
  const unitPx = needPhotos ? activeSlots.map(s => Math.max(1e-6, s.xform.sx * s.sil.w)) : null;
  const field = new Float32Array(N*N*N);
  const step = 1 / N;
  for (let iz = 0; iz < N; iz++) {
    if ((iz & 7) === 0) { if (onProgress) onProgress(iz / N); await breathe(); }
    const z = -0.5 + (iz + 0.5)*step;
    for (let iy = 0; iy < N; iy++) {
      const y = -0.5 + (iy + 0.5)*step;
      const base = iz*N*N + iy*N;
      for (let ix = 0; ix < N; ix++) {
        const x = -0.5 + (ix + 0.5)*step;
        let v = Infinity;
        if (f) v = -f(x, y, z);
        if (needPhotos) {
          for (const s of activeSlots) {
            const im = toImage(s, project(s, x, y, z));
            const d = sampleSDF(s.sdf, im.u, im.v) / Math.max(1e-6, s.xform.sx * s.sil.w);
            if (d < v) v = d;
          }
        }
        field[base + ix] = v;
      }
    }
  }
  let out = field;
  if (smoothPasses > 0) {
    let a = field, b = new Float32Array(N*N*N);
    for (let i = 0; i < smoothPasses; i++) {
      await breathe();
      blurPass(a, b, N, 0); blurPass(b, a, N, 1); blurPass(a, b, N, 2);
      const t = a; a = b; b = t;
    }
    out = a;
  }
  return out;
}
