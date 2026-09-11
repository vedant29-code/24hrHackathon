import * as THREE from 'three';

/**
 * Ultra-High-Efficiency Voxel Track Mesh for F1 Catmull-Rom Grand Prix Spline.
 * Uses GPU-instanced voxel geometry (THREE.InstancedMesh) to render thousands of
 * volumetric 3D voxel blocks in only 4-5 draw calls at solid 60 FPS.
 *
 * Components:
 * - Voxel Asphalt: 10 columns of dark slate/carbon voxel blocks across 16m road width.
 * - Stepped FIA Kerbs: Alternating red & white elevated voxel curbs at corner apexes.
 * - Runoff Borders: Textured concrete/gravel voxel tiles.
 * - Armco Crash Barriers: Modular 2-tier stacked metallic voxel barrier walls at ±13.0m.
 * - Toggleable Dashed Voxel Racing Line: Center spline guide tiles.
 * - Checkered Start/Finish Voxel Grid at slice 0.
 */
/**
 * Procedurally paints a tileable high-frequency asphalt texture: base grey
 * with speckled aggregate grain and subtle tread darkening streaks so the
 * continuous road plate doesn't read as a flat color under lighting.
 */
function createAsphaltTexture() {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1b1d22';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 9000; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    const r = Math.random() * 1.4 + 0.3;
    const shade = Math.random();
    ctx.fillStyle = shade > 0.5
      ? `rgba(90,94,102,${0.15 + Math.random() * 0.25})`
      : `rgba(8,9,11,${0.2 + Math.random() * 0.3})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.15)';
  for (let i = 0; i < 40; i++) {
    ctx.lineWidth = Math.random() * 1.5;
    ctx.beginPath();
    const y = Math.random() * size;
    ctx.moveTo(0, y);
    ctx.lineTo(size, y + (Math.random() - 0.5) * 30);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

/** Brushed-metal texture for the continuous Armco crash barrier wall. */
function createBarrierTexture() {
  const w = 256, h = 128;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#5a5f6b');
  grad.addColorStop(0.5, '#3a3e47');
  grad.addColorStop(1, '#4d525d');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  for (let i = 0; i < 200; i++) {
    ctx.lineWidth = Math.random() * 0.8;
    const y = Math.random() * h;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  // Corrugated horizontal Armco ridges
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 4;
  for (let y = 20; y < h; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

export class TrackMesh {
  constructor(trackSpline) {
    this.spline = trackSpline;
    this.group = new THREE.Group();
    this.group.name = 'VoxelF1Track';

    this.wireframeEnabled = false;
    this.lineVisible = false;

    this.asphaltTexture = createAsphaltTexture();
    this.barrierTexture = createBarrierTexture();

    // Materials tailored for crisp CAD voxel rendering with subtle specular reflections
    this.asphaltMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: this.asphaltTexture,
      roughness: 0.9,
      metalness: 0.08,
      wireframe: false
    });

    this.kerbMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff, // colored per instance
      roughness: 0.6,
      metalness: 0.15,
      wireframe: false
    });

    this.runoffMaterial = new THREE.MeshStandardMaterial({
      color: 0x272a32,
      roughness: 0.9,
      metalness: 0.08,
      wireframe: false
    });

    this.barrierMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: this.barrierTexture,
      roughness: 0.35,
      metalness: 0.85,
      wireframe: false
    });

    this.lineMaterial = new THREE.MeshStandardMaterial({
      color: 0xe8ecf2,
      roughness: 0.4,
      metalness: 0.1,
      wireframe: false
    });

    this.gridWhiteMaterial = new THREE.MeshStandardMaterial({
      color: 0xf5f6fa,
      roughness: 0.3,
      metalness: 0.1
    });

    this.build();
  }

  build() {
    while (this.group.children.length > 0) {
      const obj = this.group.children[0];
      if (obj.geometry) obj.geometry.dispose();
      this.group.remove(obj);
    }

    this.buildVoxelTrack();
    this.buildStartFinishGrid();
  }

  buildVoxelTrack() {
    const lut = this.spline.lut;
    const totalLut = lut.length; // 2400 samples
    const sliceStep = 3; // Every 3 samples = ~2.25m longitudinal spacing
    const sliceCount = Math.floor(totalLut / sliceStep); // 800 slices

    const blockLen = 2.35; // slightly overlapping for gap-free voxel surface
    const blockH = 0.20;

    // 1. Asphalt Road Bed: one continuous ribbon plate across the full 16m
    // road width (-7.2m to +7.2m), instead of stitched-together column
    // blocks — no seams, single smooth surface with a tiled asphalt texture.
    this.asphaltMesh = this.buildRibbon(lut, sliceStep, sliceCount, this.asphaltMaterial,
      [{ dLat: -7.2, y: 0 }, { dLat: 7.2, y: 0 }], 4.0);
    this.asphaltMesh.castShadow = true;
    this.asphaltMesh.receiveShadow = true;

    // 2. Stepped FIA Kerbs: Left & Right edges
    const totalKerbs = sliceCount * 2;
    const kerbW = 1.4;
    const kerbH = 0.28;
    const kerbGeo = new THREE.BoxGeometry(kerbW, kerbH, blockLen);
    this.kerbMesh = new THREE.InstancedMesh(kerbGeo, this.kerbMaterial, totalKerbs);
    this.kerbMesh.castShadow = true;
    this.kerbMesh.receiveShadow = true;

    const kerbRed = new THREE.Color(0xd63031);
    const kerbWhite = new THREE.Color(0xecf0f1);

    // 3. Runoff Zones: Left & Right borders outside kerbs
    const totalRunoff = sliceCount * 2;
    const runoffW = 2.6;
    const runoffH = 0.12;
    const runoffGeo = new THREE.BoxGeometry(runoffW, runoffH, blockLen);
    this.runoffMesh = new THREE.InstancedMesh(runoffGeo, this.runoffMaterial, totalRunoff);
    this.runoffMesh.receiveShadow = true;

    // 4. Perimeter Armco Barriers: one continuous wall ribbon per side at
    // ±13.0m instead of segmented blocks — a single unbroken crash barrier.
    const barrierH = 0.85;
    this.barrierMeshLeft = this.buildRibbon(lut, sliceStep, sliceCount, this.barrierMaterial,
      [{ dLat: -13.0, y: 0 }, { dLat: -13.0, y: barrierH }], 1.0);
    this.barrierMeshRight = this.buildRibbon(lut, sliceStep, sliceCount, this.barrierMaterial,
      [{ dLat: 13.0, y: 0 }, { dLat: 13.0, y: barrierH }], 1.0);
    this.barrierMeshLeft.castShadow = true;
    this.barrierMeshLeft.receiveShadow = true;
    this.barrierMeshRight.castShadow = true;
    this.barrierMeshRight.receiveShadow = true;

    // 5. Toggleable Center Dashed Voxel Racing Line: every other 2 slices
    const lineSlices = Math.floor(sliceCount / 2);
    const lineW = 0.35;
    const lineH = 0.04;
    const lineGeo = new THREE.BoxGeometry(lineW, lineH, blockLen * 0.65);
    this.lineMesh = new THREE.InstancedMesh(lineGeo, this.lineMaterial, lineSlices);
    this.lineMesh.visible = this.lineVisible;

    // Reusable math objects
    const dummy = new THREE.Object3D();
    const pos = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);

    let kerbIdx = 0;
    let runoffIdx = 0;
    let lineIdx = 0;

    for (let s = 0; s < sliceCount; s++) {
      const lutIdx = (s * sliceStep) % totalLut;
      const sample = lut[lutIdx];
      const pt = sample.point;
      const T = sample.tangent;
      const B = sample.binormal;

      // Rotation matrix aligning local Z along tangent T, local X along binormal B
      dummy.quaternion.setFromRotationMatrix(
        new THREE.Matrix4().makeBasis(B, up, T)
      );

      // B. Populate Stepped Kerb Voxels (Left & Right)
      const kerbPattern = Math.floor(s / 3) % 2 === 0;
      const kerbColor = kerbPattern ? kerbRed : kerbWhite;

      // Left Kerb (dLat = -8.7m)
      pos.set(
        pt.x + B.x * -8.7,
        kerbH * 0.5 - 0.05,
        pt.z + B.z * -8.7
      );
      dummy.position.copy(pos);
      dummy.updateMatrix();
      this.kerbMesh.setMatrixAt(kerbIdx, dummy.matrix);
      this.kerbMesh.setColorAt(kerbIdx++, kerbColor);

      // Right Kerb (dLat = +8.7m)
      pos.set(
        pt.x + B.x * 8.7,
        kerbH * 0.5 - 0.05,
        pt.z + B.z * 8.7
      );
      dummy.position.copy(pos);
      dummy.updateMatrix();
      this.kerbMesh.setMatrixAt(kerbIdx, dummy.matrix);
      this.kerbMesh.setColorAt(kerbIdx++, kerbColor);

      // C. Populate Runoff Voxels (Left & Right)
      // Left Runoff (dLat = -10.8m)
      pos.set(
        pt.x + B.x * -10.8,
        -runoffH * 0.5 - 0.02,
        pt.z + B.z * -10.8
      );
      dummy.position.copy(pos);
      dummy.updateMatrix();
      this.runoffMesh.setMatrixAt(runoffIdx++, dummy.matrix);

      // Right Runoff (dLat = +10.8m)
      pos.set(
        pt.x + B.x * 10.8,
        -runoffH * 0.5 - 0.02,
        pt.z + B.z * 10.8
      );
      dummy.position.copy(pos);
      dummy.updateMatrix();
      this.runoffMesh.setMatrixAt(runoffIdx++, dummy.matrix);

      // E. Populate Dashed Voxel Center Line (every 2 slices)
      if (s % 2 === 0 && lineIdx < lineSlices) {
        pos.set(
          pt.x,
          0.015, // slightly above asphalt at y=0.0
          pt.z
        );
        dummy.position.copy(pos);
        dummy.updateMatrix();
        this.lineMesh.setMatrixAt(lineIdx++, dummy.matrix);
      }
    }

    this.kerbMesh.instanceMatrix.needsUpdate = true;
    if (this.kerbMesh.instanceColor) this.kerbMesh.instanceColor.needsUpdate = true;
    this.runoffMesh.instanceMatrix.needsUpdate = true;
    this.lineMesh.instanceMatrix.needsUpdate = true;

    this.group.add(this.asphaltMesh);
    this.group.add(this.kerbMesh);
    this.group.add(this.runoffMesh);
    this.group.add(this.barrierMeshLeft);
    this.group.add(this.barrierMeshRight);
    this.group.add(this.lineMesh);
  }

  /**
   * Builds one continuous, gap-free ribbon mesh following the spline: a
   * cross-section "profile" (lateral offset + height pairs) is swept along
   * every slice and stitched into a single indexed surface — a plate, not a
   * chain of separate blocks. `vRepeat` sets how many meters of arc length
   * one texture tile covers, so the map doesn't stretch on long straights.
   */
  buildRibbon(lut, sliceStep, sliceCount, material, profile, vRepeat) {
    const totalLut = lut.length;
    const profileLen = profile.length;
    const up = new THREE.Vector3(0, 1, 0);

    const positions = new Float32Array(sliceCount * profileLen * 3);
    const normals = new Float32Array(sliceCount * profileLen * 3);
    const uvs = new Float32Array(sliceCount * profileLen * 2);

    for (let s = 0; s < sliceCount; s++) {
      const lutIdx = (s * sliceStep) % totalLut;
      const sample = lut[lutIdx];
      const pt = sample.point;
      const B = sample.binormal;
      const v = sample.s / vRepeat;

      for (let p = 0; p < profileLen; p++) {
        const prof = profile[p];
        const vi = (s * profileLen + p);
        positions[vi * 3] = pt.x + B.x * prof.dLat;
        positions[vi * 3 + 1] = prof.y;
        positions[vi * 3 + 2] = pt.z + B.z * prof.dLat;
        normals[vi * 3] = up.x; normals[vi * 3 + 1] = up.y; normals[vi * 3 + 2] = up.z;
        uvs[vi * 2] = p / (profileLen - 1);
        uvs[vi * 2 + 1] = v;
      }
    }

    const indices = [];
    for (let s = 0; s < sliceCount; s++) {
      const sNext = (s + 1) % sliceCount; // wrap for a closed circuit loop
      for (let p = 0; p < profileLen - 1; p++) {
        const a = s * profileLen + p;
        const b = s * profileLen + p + 1;
        const c = sNext * profileLen + p;
        const d = sNext * profileLen + p + 1;
        indices.push(a, c, b, b, c, d);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    return new THREE.Mesh(geo, material);
  }

  buildStartFinishGrid() {
    // Checkered voxel start/finish grid across slice 0
    const sample = this.spline.lut[0];
    const pt = sample.point;
    const T = sample.tangent;
    const B = sample.binormal;
    const up = new THREE.Vector3(0, 1, 0);

    const gridGroup = new THREE.Group();
    const rows = 2;
    const cols = 14;
    const tileW = 1.0;
    const tileL = 0.8;
    const tileH = 0.02;

    const boxGeo = new THREE.BoxGeometry(tileW, tileH, tileL);
    const quat = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(B, up, T)
    );

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if ((r + c) % 2 === 0) {
          const tile = new THREE.Mesh(boxGeo, this.gridWhiteMaterial);
          const dLat = -6.5 + c * tileW;
          const dLong = (r - 0.5) * tileL;
          tile.position.set(
            pt.x + B.x * dLat + T.x * dLong,
            0.015,
            pt.z + B.z * dLat + T.z * dLong
          );
          tile.quaternion.copy(quat);
          gridGroup.add(tile);
        }
      }
    }
    this.group.add(gridGroup);
  }

  setTargetLineVisible(visible) {
    this.lineVisible = visible;
    if (this.lineMesh) {
      this.lineMesh.visible = visible;
    }
  }

  setWireframe(enabled) {
    this.wireframeEnabled = enabled;
    this.asphaltMaterial.wireframe = enabled;
    this.kerbMaterial.wireframe = enabled;
    this.runoffMaterial.wireframe = enabled;
    this.barrierMaterial.wireframe = enabled;
  }
}
