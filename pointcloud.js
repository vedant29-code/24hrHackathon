/* pointcloud.js — expands a compact parametric recipe into a dense point
   cloud, entirely locally, with zero further AI tokens spent.

   The insight: a sphere is 4 numbers (center + radius) but contains infinite
   points. Asking a language model to type out thousands of [x,y,z] triples is
   slow, expensive, and error-prone — it drifts and truncates over long
   numeric lists. Asking it for a handful of primitive shapes (the same
   ellipsoid/box/cylinder/capsule/plate parts recipe.js already knows how to
   turn into a signed-distance field) costs a few hundred tokens even for a
   fairly complex object. From there, marching cubes — pure arithmetic, run
   right here — generates as many surface points as you want. Compression by
   parametrization, expansion by computation. */
import * as THREE from 'three';
import { MarchingCubes } from 'three/addons/objects/MarchingCubes.js';
import { compileRecipe } from './recipe.js';

// N controls point density: N=48 gives a few thousand points, N=96 gives tens
// of thousands. Bump it when you want a denser comparison, not by asking the
// AI for more — the recipe itself never grows.
export function recipeToPointCloud(recipe, N = 64) {
  const f = compileRecipe(recipe);
  const field = new Float32Array(N * N * N);
  const step = 1 / N;
  for (let iz = 0; iz < N; iz++) {
    const z = -0.5 + (iz + 0.5) * step;
    for (let iy = 0; iy < N; iy++) {
      const y = -0.5 + (iy + 0.5) * step;
      const base = iz * N * N + iy * N;
      for (let ix = 0; ix < N; ix++) {
        const x = -0.5 + (ix + 0.5) * step;
        field[base + ix] = f(x, y, z);
      }
    }
  }
  const maxPoly = Math.min(2000000, Math.max(150000, Math.round(N * N * 14)));
  const mc = new MarchingCubes(N, new THREE.MeshBasicMaterial(), true, false, maxPoly);
  // MarchingCubes counts values below its isolation level as inside; our SDF
  // is negative inside, so this already matches without inverting.
  for (let i = 0; i < field.length; i++) mc.field[i] = field[i];
  mc.isolation = 0;
  mc.update();

  const pos = mc.geometry.attributes.position;
  const count = mc.count || pos.count;
  const scale = 0.5; // matches the same cube→world scale used everywhere else in this app
  const points = new Array(count);
  for (let i = 0; i < count; i++) {
    points[i] = { x: pos.getX(i) * scale, y: pos.getY(i) * scale, z: pos.getZ(i) * scale };
  }
  mc.geometry.dispose();
  return points;
}

// Pulls every vertex out of a built THREE mesh (marching-cubes output or any
// other), in world units (post mesh.scale) — the deterministic pipeline's own
// point-coordinate dataset, for comparing against an AI recipe's expansion.
export function meshToPointCloud(mesh) {
  const pos = mesh.geometry.attributes.position;
  const count = mesh.count || pos.count;
  const s = mesh.scale.x;
  const points = new Array(count);
  for (let i = 0; i < count; i++) {
    points[i] = { x: pos.getX(i) * s, y: pos.getY(i) * s, z: pos.getZ(i) * s };
  }
  return points;
}

/* ---- Comparing two point clouds -------------------------------------------
   Symmetric Chamfer distance: for every point in A, the distance to its
   nearest neighbour in B, averaged; and the same the other way round. A grid
   hash makes nearest-neighbour lookups fast without needing every point
   compared against every other point (which would be too slow past a few
   thousand points per side). */
function gridHash(points, cellSize) {
  const grid = new Map();
  const key = (p) => `${Math.floor(p.x/cellSize)},${Math.floor(p.y/cellSize)},${Math.floor(p.z/cellSize)}`;
  for (const p of points) {
    const k = key(p);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(p);
  }
  return { grid, cellSize };
}

function nearestDist(p, hash) {
  const { grid, cellSize } = hash;
  const cx = Math.floor(p.x/cellSize), cy = Math.floor(p.y/cellSize), cz = Math.floor(p.z/cellSize);
  let best = Infinity;
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
    const bucket = grid.get(`${cx+dx},${cy+dy},${cz+dz}`);
    if (!bucket) continue;
    for (const q of bucket) {
      const d2 = (p.x-q.x)**2 + (p.y-q.y)**2 + (p.z-q.z)**2;
      if (d2 < best) best = d2;
    }
  }
  return best === Infinity ? cellSize * 3 : Math.sqrt(best);
}

// Returns { meanDistance, similarity } — meanDistance in cube units (the same
// -0.5..0.5 cube both datasets live in), similarity in 0..1 via exponential
// decay so it reads like the match percentages used elsewhere in this app.
export function chamferCompare(pointsA, pointsB, cellSize = 0.03) {
  if (!pointsA.length || !pointsB.length) return { meanDistance: Infinity, similarity: 0 };
  const hashB = gridHash(pointsB, cellSize);
  const hashA = gridHash(pointsA, cellSize);
  let sumA = 0; for (const p of pointsA) sumA += nearestDist(p, hashB);
  let sumB = 0; for (const p of pointsB) sumB += nearestDist(p, hashA);
  const meanDistance = (sumA/pointsA.length + sumB/pointsB.length) / 2;
  return { meanDistance, similarity: Math.exp(-meanDistance * 12) };
}
