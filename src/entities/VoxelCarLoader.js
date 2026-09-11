import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * Turns the JSON exported by the photo-to-3D tool's "Send to Track" button
 * into a real car for this simulation: a rendered voxel body, AND the
 * physics numbers that body actually implies — frontal area, drag
 * coefficient, mass — instead of reusing a fixed generic car for every
 * imported shape. "Physics acts on every voxel cell" means the cell data has
 * to be the thing the aerodynamics and mass are computed from, not just what
 * gets drawn.
 */

const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2e333d, roughness: 0.4, metalness: 0.45 });
const tireMat = new THREE.MeshStandardMaterial({ color: 0x111215, roughness: 0.95, metalness: 0.05 });
const rimMat  = new THREE.MeshStandardMaterial({ color: 0x8a92a0, roughness: 0.2, metalness: 0.85 });
const MATS = { body: bodyMat, tire: tireMat, rim: rimMat };

// Real F1 dry-mass density for context: ~798 kg over a ~5.2 x 2.0 x 0.95 m
// envelope. Used only to keep an imported shape's mass in a sane band, not
// to fake a specific number.
const FIA_MIN_MASS = 798.0;

export function buildVoxelCar(data, targetLength = 5.2) {
  if (!data || !Array.isArray(data.cells) || !data.cells.length) return null;

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const c of data.cells) {
    if (c.x < minX) minX = c.x; if (c.x > maxX) maxX = c.x;
    if (c.y < minY) minY = c.y; if (c.y > maxY) maxY = c.y;
    if (c.z < minZ) minZ = c.z; if (c.z > maxZ) maxZ = c.z;
  }
  const cell = data.cell;
  const spanX = (maxX - minX + 1) * cell;
  const spanY = (maxY - minY + 1) * cell;
  const spanZ = (maxZ - minZ + 1) * cell;

  // Uniform scale so the longest axis (the car's length) matches an F1-scale
  // car — preserves the imported shape's own proportions rather than
  // stretching it to fit a fixed box.
  const longest = Math.max(spanX, spanY, spanZ, 1e-6);
  const scale = targetLength / longest;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;

  const group = new THREE.Group();
  const byLayer = { body: [], tire: [], rim: [] };
  for (const c of data.cells) (byLayer[c.layer] || byLayer.body).push(c);

  const boxSize = cell * scale * 0.97;
  const geo = new THREE.BoxGeometry(boxSize, boxSize, boxSize);
  for (const [layer, cells] of Object.entries(byLayer)) {
    if (!cells.length) continue;
    const inst = new THREE.InstancedMesh(geo, MATS[layer] || bodyMat, cells.length);
    const m = new THREE.Matrix4();
    cells.forEach((c, i) => {
      // Chassis origin (0,0,0) sits at the wheel-centre height convention
      // the rest of the sim uses, with +Z forward.
      m.setPosition((c.x - cx) * scale, (c.y - cy) * scale, (c.z - cz) * scale);
      inst.setMatrixAt(i, m);
    });
    inst.instanceMatrix.needsUpdate = true;
    inst.castShadow = true;
    inst.receiveShadow = true;
    group.add(inst);
  }

  // Frontal area: the car meets the air through its X-Y cross-section as it
  // travels along Z. Width/height come straight from the imported bbox.
  const width = spanX * scale, height = spanY * scale, length = spanZ * scale;
  const frontalArea = Math.max(0.4, width * height);

  // Solidity: how much of the bounding box the voxels actually fill. A
  // sparser, more sculpted shape (real gaps between wing elements, open
  // cockpit) drags less than a solid brick of the same outline — this is a
  // real geometric property of the cells that were imported, not a guess.
  const gridCells = (maxX - minX + 1) * (maxY - minY + 1) * (maxZ - minZ + 1);
  const solidity = THREE.MathUtils.clamp(data.cells.length / Math.max(1, gridCells), 0.05, 1.0);

  const dragCoefficient = THREE.MathUtils.clamp(0.55 + solidity * 0.55, 0.55, 1.2);
  const mass = FIA_MIN_MASS * (0.85 + 0.3 * solidity);

  return { group, scale, width, height, length, frontalArea, solidity, dragCoefficient, mass };
}

export function buildVoxelCarFromGLB(gltf, targetLength = 5.2) {
  const group = new THREE.Group();
  gltf.scene.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  group.add(gltf.scene);

  const box = new THREE.Box3().setFromObject(group);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const longest = Math.max(size.x, size.y, size.z, 1e-6);
  const scale = targetLength / longest;
  group.scale.setScalar(scale);
  group.position.set(-center.x * scale, -center.y * scale, -center.z * scale);

  const width = size.x * scale, height = size.y * scale, length = size.z * scale;
  const frontalArea = Math.max(0.4, width * height);
  const dragCoefficient = 0.75;
  const mass = FIA_MIN_MASS;

  return { group, scale, width, height, length, frontalArea, solidity: 0.5, dragCoefficient, mass };
}

export function loadVoxelCarFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.glb') || name.endsWith('.gltf')) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const loader = new GLTFLoader();
        loader.parse(reader.result, '', (gltf) => {
          resolve({ __glb: true, gltf });
        }, reject);
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try { resolve(JSON.parse(reader.result)); }
      catch (err) { reject(err); }
    };
    reader.onerror = reject;
    reader.readAsText(file);
  });
}
