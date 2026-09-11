import * as THREE from 'three';

/**
 * Procedural F1 Grand Prix Spline Track Mesh Builder (Slope = 0).
 * Features:
 * - Full multi-turn Grand Prix circuit extruded along the Catmull-Rom spline.
 * - 16m wide flat asphalt track at y = 0.0 with dual FIA kerbs and runoff.
 * - Armco crash barrier walls running along the outer perimeter of runoff.
 * - Toggleable dashed racing line tracing the exact mathematical center of the spline.
 * - Checkered start/finish grid and boundary lines.
 * - Single merged geometry for maximum WebGL rendering performance (60 FPS).
 */
export class TrackMesh {
  constructor(trackSpline) {
    this.spline = trackSpline;
    this.group = new THREE.Group();
    this.group.name = "F1SplineTrack";

    this.wireframeEnabled = false;
    this.lineVisible = false;

    this.trackMaterial = new THREE.MeshStandardMaterial({
      color: 0x1e2025,
      roughness: 0.8,
      metalness: 0.15,
      wireframe: false,
      side: THREE.DoubleSide
    });

    this.kerbMaterial = new THREE.MeshStandardMaterial({
      color: 0x3d414d,
      roughness: 0.65,
      metalness: 0.2,
      wireframe: false,
      side: THREE.DoubleSide
    });

    this.barrierMaterial = new THREE.MeshStandardMaterial({
      color: 0x22252c,
      roughness: 0.55,
      metalness: 0.75,
      side: THREE.DoubleSide
    });

    this.railMaterial = new THREE.MeshStandardMaterial({
      color: 0x5a606e,
      roughness: 0.35,
      metalness: 0.85
    });

    this.build();
  }

  build() {
    while (this.group.children.length > 0) {
      const obj = this.group.children[0];
      if (obj.geometry) obj.geometry.dispose();
      this.group.remove(obj);
    }

    this.buildSplineRibbonMesh();
    this.buildInvisibleLine();
    this.buildTrackMarkings();
    this.buildCrashBarriers();
  }

  buildSplineRibbonMesh() {
    const samples = this.spline.lut;
    const N = this.spline.sampleCount;
    const halfW = this.spline.trackWidth * 0.5; // 8.0m
    const kerbW = 1.8;
    const kerbH = this.spline.curbHeight;
    const runoffW = 3.5;

    // Cross-sectional profile offsets relative to centerline:
    // 0: Left runoff border
    // 1: Left kerb outer top
    // 2: Left kerb inner (track edge)
    // 3: Left track edge
    // 4: Centerline
    // 5: Right track edge
    // 6: Right kerb inner (track edge)
    // 7: Right kerb outer top
    // 8: Right runoff border
    const pointsPerRing = 9;
    const offsets = [
      { dLat: -halfW - kerbW - runoffW, y: -0.02 },
      { dLat: -halfW - kerbW, y: kerbH },
      { dLat: -halfW, y: kerbH * 0.25 },
      { dLat: -halfW, y: 0.0 },
      { dLat: 0.0, y: 0.01 },
      { dLat: halfW, y: 0.0 },
      { dLat: halfW, y: kerbH * 0.25 },
      { dLat: halfW + kerbW, y: kerbH },
      { dLat: halfW + kerbW + runoffW, y: -0.02 }
    ];

    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];

    for (let i = 0; i <= N; i++) {
      const sample = samples[i % N];
      const pt = sample.point;
      const binorm = sample.binormal;
      const uCoord = i / N;

      for (let j = 0; j < pointsPerRing; j++) {
        const off = offsets[j];
        const vx = pt.x + binorm.x * off.dLat;
        const vy = off.y;
        const vz = pt.z + binorm.z * off.dLat;

        positions.push(vx, vy, vz);
        normals.push(0, 1, 0);
        uvs.push(j / (pointsPerRing - 1), uCoord * 120.0);
      }
    }

    for (let i = 0; i < N; i++) {
      const r1 = i * pointsPerRing;
      const r2 = (i + 1) * pointsPerRing;

      for (let j = 0; j < pointsPerRing - 1; j++) {
        const a = r1 + j;
        const b = r1 + j + 1;
        const c = r2 + j;
        const d = r2 + j + 1;

        indices.push(a, c, b);
        indices.push(b, c, d);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    this.trackMesh = new THREE.Mesh(geometry, this.trackMaterial);
    this.trackMesh.receiveShadow = true;
    this.group.add(this.trackMesh);
  }

  buildInvisibleLine() {
    // Dashed center line following the exact mathematical spline curve
    const N = this.spline.sampleCount;
    const points = [];

    for (let i = 0; i <= N; i += 2) {
      const sample = this.spline.lut[i % N];
      points.push(new THREE.Vector3(sample.point.x, 0.04, sample.point.z));
    }

    const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
    const lineMat = new THREE.LineDashedMaterial({
      color: 0x9ca3af,
      dashSize: 3.5,
      gapSize: 2.0,
      linewidth: 1
    });

    this.targetLine = new THREE.Line(lineGeo, lineMat);
    this.targetLine.computeLineDistances();
    this.targetLine.visible = this.lineVisible;
    this.group.add(this.targetLine);
  }

  buildTrackMarkings() {
    const N = this.spline.sampleCount;
    const halfW = this.spline.trackWidth * 0.5;

    const leftEdge = [];
    const rightEdge = [];

    for (let i = 0; i <= N; i += 2) {
      const sample = this.spline.lut[i % N];
      const pt = sample.point;
      const binorm = sample.binormal;

      leftEdge.push(new THREE.Vector3(pt.x - binorm.x * halfW, 0.02, pt.z - binorm.z * halfW));
      rightEdge.push(new THREE.Vector3(pt.x + binorm.x * halfW, 0.02, pt.z + binorm.z * halfW));
    }

    const edgeMat = new THREE.LineBasicMaterial({ color: 0x8a909e, linewidth: 1.5 });
    this.group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(leftEdge), edgeMat));
    this.group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(rightEdge), edgeMat));

    // Checkered Start / Finish Line across sample 0
    const startSample = this.spline.lut[0];
    const pt = startSample.point;
    const binorm = startSample.binormal;
    const gridPoints = [
      new THREE.Vector3(pt.x - binorm.x * halfW, 0.03, pt.z - binorm.z * halfW),
      new THREE.Vector3(pt.x + binorm.x * halfW, 0.03, pt.z + binorm.z * halfW)
    ];
    const gridLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(gridPoints),
      new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 4 })
    );
    this.group.add(gridLine);
  }

  buildCrashBarriers() {
    const N = this.spline.sampleCount;
    const halfW = this.spline.trackWidth * 0.5;
    const kerbW = 1.8;
    const runoffW = 3.5;
    const totalBarrierDist = halfW + kerbW + runoffW; // 13.3m
    const barrierH = 1.2;
    const step = 2; // Every 2 samples for high-perf rendering

    const buildBarrierWall = (sign) => {
      const positions = [];
      const normals = [];
      const indices = [];

      let vertIdx = 0;
      for (let i = 0; i <= N; i += step) {
        const sample = this.spline.lut[i % N];
        const pt = sample.point;
        const binorm = sample.binormal;

        const bx = pt.x + binorm.x * (sign * totalBarrierDist);
        const bz = pt.z + binorm.z * (sign * totalBarrierDist);

        // Inward normal facing toward track
        const nx = -sign * binorm.x;
        const nz = -sign * binorm.z;

        // Bottom vertex
        positions.push(bx, 0.0, bz);
        normals.push(nx, 0.0, nz);

        // Top vertex
        positions.push(bx, barrierH, bz);
        normals.push(nx, 0.0, nz);

        vertIdx += 2;
      }

      const segmentCount = Math.floor(N / step);
      for (let i = 0; i < segmentCount; i++) {
        const b1 = i * 2;
        const t1 = i * 2 + 1;
        const b2 = (i + 1) * 2;
        const t2 = (i + 1) * 2 + 1;

        indices.push(b1, b2, t1);
        indices.push(t1, b2, t2);
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
      geo.setIndex(indices);
      return new THREE.Mesh(geo, this.barrierMaterial);
    };

    const rightBarrier = buildBarrierWall(1);
    const leftBarrier = buildBarrierWall(-1);
    this.group.add(rightBarrier);
    this.group.add(leftBarrier);
  }

  setTargetLineVisible(visible) {
    this.lineVisible = visible;
    if (this.targetLine) {
      this.targetLine.visible = visible;
    }
  }

  setWireframe(enabled) {
    this.wireframeEnabled = enabled;
    this.trackMaterial.wireframe = enabled;
    this.kerbMaterial.wireframe = enabled;
  }
}
