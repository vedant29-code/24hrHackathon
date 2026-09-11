import * as THREE from 'three';

/**
 * Full Multi-Turn Closed F1 Grand Prix Catmull-Rom Spline Circuit (Slope = 0).
 * Features:
 * - Monza / Silverstone inspired Grand Prix circuit with 20 curated control points.
 * - Flat ground at y = 0.00m everywhere.
 * - Long high-speed straights (300+ km/h), chicanes, high-speed sweepers, and technical hairpins.
 * - High-resolution 2,400-sample Frenet frame lookup table with exact arc length, tangent, normal,
 *   binormal, and local curvature kappa(s).
 * - O(1) 2D spatial hash grid for microsecond nearest-point queries.
 */
export class TrackSpline {
  constructor() {
    this.trackWidth = 16.0; // 16m wide FIA Grand Prix circuit
    this.curbHeight = 0.22;
    this.sampleCount = 2400; // 2400 samples along ~1.8km circuit (~0.75m spacing)

    this.initSpline();
    this.buildLookupTable();
    this.buildSpatialGrid();
  }

  initSpline() {
    // 20 Curated F1 Grand Prix Control Points (Flat at y = 0.0)
    // Layout: Main Straight -> Rettifilo Chicane -> Curva Grande -> Roggia -> Lesmo 1 & 2 -> Serraglio Straight -> Ascari -> Back Straight -> Parabolica
    const pts = [
      new THREE.Vector3(0, 0, -200),    // 0: Main Straight (Start/Finish)
      new THREE.Vector3(0, 0, -70),     // 1: High-Speed Straight approach
      new THREE.Vector3(15, 0, 20),     // 2: Turn 1 Rettifilo right turn-in
      new THREE.Vector3(-25, 0, 65),    // 3: Turn 2 Rettifilo left chicane apex (tight, R~35m)
      new THREE.Vector3(-55, 0, 115),   // 4: Chicane exit
      new THREE.Vector3(-105, 0, 195),  // 5: Curva Grande entry
      new THREE.Vector3(-155, 0, 280),  // 6: Curva Grande high-speed sweeper apex (R~140m)
      new THREE.Vector3(-205, 0, 340),  // 7: Sweeper exit
      new THREE.Vector3(-255, 0, 360),  // 8: Roggia chicane turn-in
      new THREE.Vector3(-305, 0, 330),  // 9: Roggia chicane apex (R~40m)
      new THREE.Vector3(-355, 0, 250),  // 10: Roggia exit
      new THREE.Vector3(-375, 0, 160),  // 11: Turn 6 Lesmo 1 entry (R~55m)
      new THREE.Vector3(-355, 0, 80),   // 12: Turn 7 Lesmo 2 entry (R~50m)
      new THREE.Vector3(-295, 0, -30),  // 13: Serraglio high-speed acceleration straight
      new THREE.Vector3(-225, 0, -140), // 14: Ascari chicane entry
      new THREE.Vector3(-155, 0, -220), // 15: Ascari complex apex (R~65m)
      new THREE.Vector3(-95, 0, -285),  // 16: Ascari exit onto back straight
      new THREE.Vector3(15, 0, -325),   // 17: Back straight (320 km/h)
      new THREE.Vector3(85, 0, -295),   // 18: Parabolica entry (sweeping 180-deg hairpin)
      new THREE.Vector3(75, 0, -245)    // 19: Parabolica apex leading onto main straight
    ];

    // Closed Catmull-Rom spline with centripetal parameterization for smooth curvature
    this.curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal', 0.5);
    this.totalLength = this.curve.getLength(); // ~1820m
    this.radius = 120.0; // Reference nominal radius for compatibility
  }

  buildLookupTable() {
    this.lut = [];
    const N = this.sampleCount;
    const deltaU = 1.0 / N;

    for (let i = 0; i <= N; i++) {
      const u = (i % N) / N;
      const point = this.curve.getPointAt(u);
      point.y = 0.0; // Strictly flat

      const tangent = this.curve.getTangentAt(u).normalize();
      tangent.y = 0.0;
      tangent.normalize();

      // Normal is purely vertical
      const normal = new THREE.Vector3(0, 1, 0);

      // Binormal points to the right of travel: tangent x normal
      const binormal = new THREE.Vector3().crossVectors(tangent, normal).normalize();

      // Curvature kappa = ||dT/ds|| via central finite difference
      const uPrev = (u - deltaU * 0.5 + 1.0) % 1.0;
      const uNext = (u + deltaU * 0.5) % 1.0;
      const tPrev = this.curve.getTangentAt(uPrev).normalize();
      const tNext = this.curve.getTangentAt(uNext).normalize();
      const ds = this.totalLength * deltaU;
      const dtVec = new THREE.Vector3().subVectors(tNext, tPrev);
      const curvature = Math.max(0.0001, dtVec.length() / Math.max(ds, 0.001));

      this.lut.push({
        index: i % N,
        u,
        s: u * this.totalLength,
        point,
        tangent,
        normal,
        binormal,
        curvature, // local curvature in 1/m (e.g. 0.002 on straights, 0.025 on hairpins)
        radiusOfCurvature: 1.0 / curvature,
        roll: 0.0
      });
    }
  }

  buildSpatialGrid() {
    this.cellSize = 25.0; // 25m spatial grid cells
    this.grid = new Map();

    for (let i = 0; i < this.sampleCount; i++) {
      const sample = this.lut[i];
      const cx = Math.floor(sample.point.x / this.cellSize);
      const cz = Math.floor(sample.point.z / this.cellSize);
      const key = `${cx},${cz}`;

      if (!this.grid.has(key)) {
        this.grid.set(key, []);
      }
      this.grid.get(key).push(i);
    }
  }

  /**
   * Fast O(1) query for closest spline sample to given position
   */
  findNearestTrackSample(pos) {
    const cx = Math.floor(pos.x / this.cellSize);
    const cz = Math.floor(pos.z / this.cellSize);

    let bestDistSq = Infinity;
    let bestIdx = 0;

    // Search 3x3 neighboring cells
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const key = `${cx + dx},${cz + dz}`;
        const indices = this.grid.get(key);
        if (indices) {
          for (let k = 0; k < indices.length; k++) {
            const idx = indices[k];
            const pt = this.lut[idx].point;
            const distSq = (pos.x - pt.x) * (pos.x - pt.x) + (pos.z - pt.z) * (pos.z - pt.z);
            if (distSq < bestDistSq) {
              bestDistSq = distSq;
              bestIdx = idx;
            }
          }
        }
      }
    }

    // Fallback if car is far outside normal grid
    if (bestDistSq === Infinity) {
      for (let i = 0; i < this.sampleCount; i += 20) {
        const pt = this.lut[i].point;
        const distSq = (pos.x - pt.x) * (pos.x - pt.x) + (pos.z - pt.z) * (pos.z - pt.z);
        if (distSq < bestDistSq) {
          bestDistSq = distSq;
          bestIdx = i;
        }
      }
    }

    return this.lut[bestIdx];
  }

  /**
   * Returns lookahead sample along the spline at distance ahead from current sample
   */
  getLookaheadSample(currentSample, lookaheadDistance) {
    const deltaIndex = Math.round((lookaheadDistance / this.totalLength) * this.sampleCount);
    const targetIdx = (currentSample.index + deltaIndex) % this.sampleCount;
    return this.lut[targetIdx];
  }

  /**
   * Evaluates contact and lateral deviation from the invisible center spline line
   */
  evaluateContact(bodyPos, bodyRadius) {
    const sample = this.findNearestTrackSample(bodyPos);

    // Vector from spline center to car position
    const toCar = new THREE.Vector3().subVectors(bodyPos, sample.point);
    toCar.y = 0;

    // Lateral distance: project onto binormal (positive = right, negative = left)
    const lateralDist = toCar.dot(sample.binormal);
    const halfW = this.trackWidth * 0.5;

    return {
      type: 'BED',
      sample,
      normal: sample.normal,
      penetration: Math.max(0, bodyRadius - bodyPos.y),
      contactPoint: new THREE.Vector3(bodyPos.x, 0, bodyPos.z),
      lateralOffset: lateralDist,
      halfWidth: halfW,
      curvature: sample.curvature,
      radiusOfCurvature: sample.radiusOfCurvature,
      isOnTrack: Math.abs(lateralDist) <= halfW
    };
  }
}
