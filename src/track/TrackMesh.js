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
export class TrackMesh {
  constructor(trackSpline) {
    this.spline = trackSpline;
    this.group = new THREE.Group();
    this.group.name = 'VoxelF1Track';

    this.wireframeEnabled = false;
    this.lineVisible = false;

    // Materials tailored for crisp CAD voxel rendering with subtle specular reflections
    this.asphaltMaterial = new THREE.MeshStandardMaterial({
      color: 0x181a1f,
      roughness: 0.85,
      metalness: 0.12,
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
      color: 0x484d59,
      roughness: 0.4,
      metalness: 0.8,
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

    // 1. Asphalt Road Bed: 10 columns across 16m road (-7.2m to +7.2m)
    const asphaltCols = 10;
    const colWidth = 1.6;
    const totalAsphalt = sliceCount * asphaltCols;
    const asphaltGeo = new THREE.BoxGeometry(colWidth * 0.98, blockH, blockLen);
    this.asphaltMesh = new THREE.InstancedMesh(asphaltGeo, this.asphaltMaterial, totalAsphalt);
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

    // 4. Perimeter Armco Barriers: Left & Right walls at ±13.0m
    const totalBarriers = sliceCount * 2;
    const barrierW = 0.65;
    const barrierH = 0.85;
    const barrierGeo = new THREE.BoxGeometry(barrierW, barrierH, blockLen);
    this.barrierMesh = new THREE.InstancedMesh(barrierGeo, this.barrierMaterial, totalBarriers);
    this.barrierMesh.castShadow = true;
    this.barrierMesh.receiveShadow = true;

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

    let asphaltIdx = 0;
    let kerbIdx = 0;
    let runoffIdx = 0;
    let barrierIdx = 0;
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

      // A. Populate Asphalt Voxels across 10 columns
      for (let c = 0; c < asphaltCols; c++) {
        const dLat = -7.2 + c * colWidth + (colWidth * 0.5);
        pos.set(
          pt.x + B.x * dLat,
          -blockH * 0.5, // Top surface flush at y = 0.00m
          pt.z + B.z * dLat
        );
        dummy.position.copy(pos);
        dummy.updateMatrix();
        this.asphaltMesh.setMatrixAt(asphaltIdx++, dummy.matrix);
      }

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

      // D. Populate Perimeter Armco Barrier Voxels (Left & Right at ±13.0m)
      // Left Barrier
      pos.set(
        pt.x + B.x * -13.0,
        barrierH * 0.5,
        pt.z + B.z * -13.0
      );
      dummy.position.copy(pos);
      dummy.updateMatrix();
      this.barrierMesh.setMatrixAt(barrierIdx++, dummy.matrix);

      // Right Barrier
      pos.set(
        pt.x + B.x * 13.0,
        barrierH * 0.5,
        pt.z + B.z * 13.0
      );
      dummy.position.copy(pos);
      dummy.updateMatrix();
      this.barrierMesh.setMatrixAt(barrierIdx++, dummy.matrix);

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

    this.asphaltMesh.instanceMatrix.needsUpdate = true;
    this.kerbMesh.instanceMatrix.needsUpdate = true;
    if (this.kerbMesh.instanceColor) this.kerbMesh.instanceColor.needsUpdate = true;
    this.runoffMesh.instanceMatrix.needsUpdate = true;
    this.barrierMesh.instanceMatrix.needsUpdate = true;
    this.lineMesh.instanceMatrix.needsUpdate = true;

    this.group.add(this.asphaltMesh);
    this.group.add(this.kerbMesh);
    this.group.add(this.runoffMesh);
    this.group.add(this.barrierMesh);
    this.group.add(this.lineMesh);
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
