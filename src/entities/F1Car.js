import * as THREE from 'three';
import { F1TireModel } from '../physics/F1TireModel.js';
import { F1VehiclePhysics } from '../physics/F1VehiclePhysics.js';

/**
 * 3D Procedural Voxel Formula 1 Car.
 * Features:
 * - Built entirely out of stylized CAD volumetric voxel blocks.
 * - Multi-element voxel front wing, tapered voxel nose, cockpit with halo safety arc,
 *   driver helmet block, sculpted sidepods, engine cover shark fin, and dual-plane rear wing.
 * - Dynamic steerable front voxel wheel assemblies & rolling rear voxel wheels.
 * - 4-wheel flush ground contact: hub at y = 0.36m, bottom at y = 0.00m (0.0mm gap).
 * - Tumbling 3D Voxel Crash Debris: carbon chunks & sparking ember cubes that scatter,
 *   rotate, and bounce off the flat asphalt on impact.
 */
export class F1Car {
  constructor(options = {}) {
    this.id = options.id || 'voxel-f1-car';
    this.isCar = true;
    this.isLead = true;

    // F1 2024 FIA Dimensions
    this.length = 5.2;
    this.width = 2.0;
    this.height = 0.95;
    this.wheelRadius = 0.36; // 18-inch Pirelli low profile racing wheel
    this.radius = 0.36;      // Accurate tire radius for ground contact

    // FIA Minimum Racing Mass
    this.mass = 798.0; // kg
    this.invMass = 1.0 / this.mass;

    // Physical state
    this.r = options.r !== undefined ? options.r : 120.0;
    this.theta = options.theta !== undefined ? options.theta : 0.0;
    this.vr = options.vr !== undefined ? options.vr : 0.0;
    this.vt = options.vt !== undefined ? options.vt : (160.0 / 3.6);

    const initX = this.r * Math.cos(this.theta);
    const initZ = this.r * Math.sin(this.theta);
    this.position = new THREE.Vector3().copy(options.position || new THREE.Vector3(initX, 0.36, initZ));
    this.velocity = new THREE.Vector3().copy(options.velocity || new THREE.Vector3(-Math.sin(this.theta) * this.vt, 0, Math.cos(this.theta) * this.vt));
    this.acceleration = new THREE.Vector3();
    this.quaternion = new THREE.Quaternion();
    this.heading = new THREE.Vector3(-Math.sin(this.theta), 0, Math.cos(this.theta));

    // Friction, Tire & Suspension Dynamics
    this.restitution = 0.1;
    this.friction = 1.65;
    this.tireModel = new F1TireModel();

    this.isGrounded = true;
    this.contactNormal = new THREE.Vector3(0, 1, 0);
    this.contactPoint = new THREE.Vector3();
    this.centripetalAccel = 0;
    this.gForce = 1.0;
    this.totalEnergy = 0;

    // Wheel nodes & steering pivots
    this.wheelRollNodes = [];
    this.frontSteerNodes = [];
    this.mesh = this.buildVoxelF1Mesh();

    // 4-Wheel Suspension & Powertrain System
    this.suspension = new F1VehiclePhysics(this, options.trackSpline);

    // Velocity Vector (Engineering visualization)
    this.vectorArrow = new THREE.ArrowHelper(
      new THREE.Vector3(0, 0, 1),
      this.position,
      2.5,
      0xffffff,
      0.6,
      0.3
    );
    this.vectorArrow.visible = true;

    // Dynamics & Realtime Physics State
    this.yaw = options.yaw !== undefined ? options.yaw : 0.0;
    this.yawRate = 0.0;
    this.steerAngle = 0.0;
    this.slipAngleFrontDeg = 0.0;
    this.slipAngleRearDeg = 0.0;

    // Crash & Track Violation State
    this.isCrashed = false;
    this.isOffTrack = false;
    this.crashSpeedKmh = 0.0;
    this.impactForceN = 0.0;

    this.wheelRotAngle = 0;

    // 3D Voxel Debris & Sparks System
    this.initVoxelDebris();
  }

  initVoxelDebris() {
    this.debrisCount = 36;
    const debrisGeo = new THREE.BoxGeometry(0.12, 0.12, 0.12);

    this.debrisMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.3,
      metalness: 0.8
    });

    this.sparkPoints = new THREE.InstancedMesh(debrisGeo, this.debrisMaterial, this.debrisCount);
    this.sparkPoints.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    this.debrisVelocities = [];
    this.debrisRotations = [];
    this.debrisRotSpeeds = [];
    this.debrisLifetimes = [];
    this.debrisPositions = [];

    const dummy = new THREE.Object3D();
    dummy.position.set(0, -100, 0);
    dummy.updateMatrix();

    const colorEmber = new THREE.Color(0xffffff);
    const colorCarbon = new THREE.Color(0x2d3436);

    for (let i = 0; i < this.debrisCount; i++) {
      this.debrisVelocities.push(new THREE.Vector3());
      this.debrisRotations.push(new THREE.Euler());
      this.debrisRotSpeeds.push(new THREE.Vector3());
      this.debrisLifetimes.push(0);
      this.debrisPositions.push(new THREE.Vector3(0, -100, 0));

      this.sparkPoints.setMatrixAt(i, dummy.matrix);
      this.sparkPoints.setColorAt(i, i % 2 === 0 ? colorEmber : colorCarbon);
    }

    this.sparkPoints.instanceMatrix.needsUpdate = true;
    if (this.sparkPoints.instanceColor) this.sparkPoints.instanceColor.needsUpdate = true;
  }

  triggerCrash(impactSpeedKmh, normal) {
    this.isCrashed = true;
    this.crashSpeedKmh = impactSpeedKmh;
    this.isOffTrack = true;

    // Explode tumbling 3D voxel cubes in reflection direction
    for (let i = 0; i < this.debrisCount; i++) {
      this.debrisPositions[i].set(
        this.position.x + (Math.random() - 0.5) * 0.8,
        this.position.y + 0.2 + Math.random() * 0.3,
        this.position.z + (Math.random() - 0.5) * 0.8
      );
      this.debrisLifetimes[i] = 0.6 + Math.random() * 0.8;

      const spread = (Math.random() - 0.5) * 14.0;
      this.debrisVelocities[i].set(
        normal.x * (12.0 + Math.random() * 16.0) - normal.z * spread,
        3.0 + Math.random() * 7.0,
        normal.z * (12.0 + Math.random() * 16.0) + normal.x * spread
      );

      this.debrisRotSpeeds[i].set(
        (Math.random() - 0.5) * 20.0,
        (Math.random() - 0.5) * 20.0,
        (Math.random() - 0.5) * 20.0
      );
    }
  }

  updateSparks(dt) {
    let hasActive = false;
    const dummy = new THREE.Object3D();

    for (let i = 0; i < this.debrisCount; i++) {
      if (this.debrisLifetimes[i] > 0) {
        hasActive = true;
        this.debrisLifetimes[i] -= dt;

        const pos = this.debrisPositions[i];
        const vel = this.debrisVelocities[i];
        const rot = this.debrisRotations[i];
        const rotSpd = this.debrisRotSpeeds[i];

        pos.x += vel.x * dt;
        pos.y += vel.y * dt;
        pos.z += vel.z * dt;

        vel.y -= 14.0 * dt; // Gravity

        // Ground bounce at flat asphalt y = 0.06m (half cube height)
        if (pos.y < 0.06) {
          pos.y = 0.06;
          vel.y = -vel.y * 0.45;
          vel.x *= 0.75;
          vel.z *= 0.75;
        }

        rot.x += rotSpd.x * dt;
        rot.y += rotSpd.y * dt;
        rot.z += rotSpd.z * dt;

        dummy.position.copy(pos);
        dummy.rotation.copy(rot);
        const scale = Math.min(1.0, this.debrisLifetimes[i] * 2.0);
        dummy.scale.set(scale, scale, scale);
        dummy.updateMatrix();

        this.sparkPoints.setMatrixAt(i, dummy.matrix);
      } else {
        dummy.position.set(0, -100, 0);
        dummy.updateMatrix();
        this.sparkPoints.setMatrixAt(i, dummy.matrix);
      }
    }

    if (hasActive) {
      this.sparkPoints.instanceMatrix.needsUpdate = true;
    }
  }

  resetCrashState() {
    this.isCrashed = false;
    this.isOffTrack = false;
    this.crashSpeedKmh = 0.0;
    this.impactForceN = 0.0;
    this.steerAngle = 0.0;
    this.yawRate = 0.0;

    const dummy = new THREE.Object3D();
    dummy.position.set(0, -100, 0);
    dummy.updateMatrix();

    for (let i = 0; i < this.debrisCount; i++) {
      this.debrisLifetimes[i] = 0;
      this.debrisPositions[i].set(0, -100, 0);
      this.sparkPoints.setMatrixAt(i, dummy.matrix);
    }
    this.sparkPoints.instanceMatrix.needsUpdate = true;
  }

  buildVoxelF1Mesh() {
    const carGroup = new THREE.Group();

    // Voxel Material Palette (Clean CAD Engineering Monochrome)
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x2e333d,
      roughness: 0.4,
      metalness: 0.45
    });

    const carbonMat = new THREE.MeshStandardMaterial({
      color: 0x15161a,
      roughness: 0.75,
      metalness: 0.2
    });

    const highlightMat = new THREE.MeshStandardMaterial({
      color: 0xecf0f1,
      roughness: 0.35,
      metalness: 0.3
    });

    const tireMat = new THREE.MeshStandardMaterial({
      color: 0x111215,
      roughness: 0.95,
      metalness: 0.05
    });

    const rimMat = new THREE.MeshStandardMaterial({
      color: 0x8a92a0,
      roughness: 0.2,
      metalness: 0.85
    });

    const redLedMat = new THREE.MeshStandardMaterial({
      color: 0xe74c3c,
      roughness: 0.2,
      emissive: 0xe74c3c,
      emissiveIntensity: 0.8
    });

    // Helper to add voxel box
    const addVoxel = (w, h, l, x, y, z, mat, parent = carGroup) => {
      const geo = new THREE.BoxGeometry(w, h, l);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };

    // 1. Monocoque / Main Voxel Tub (Chassis origin is at wheel center y = 0.0)
    addVoxel(0.72, 0.32, 2.2, 0, 0.04, 0.4, bodyMat);
    // Lower floor plank
    addVoxel(1.5, 0.06, 2.8, 0, -0.18, 0.1, carbonMat);

    // 2. Stepped Voxel Nosecone (tapering to front)
    addVoxel(0.56, 0.26, 0.6, 0, 0.05, 1.7, bodyMat);
    addVoxel(0.42, 0.20, 0.5, 0, 0.03, 2.15, bodyMat);
    addVoxel(0.28, 0.15, 0.4, 0, 0.00, 2.5, bodyMat);

    // 3. Voxel Front Wing Assembly
    // Main lower wing plane
    addVoxel(1.9, 0.06, 0.42, 0, -0.22, 2.65, carbonMat);
    // Upper cascade wing
    addVoxel(1.7, 0.05, 0.24, 0, -0.14, 2.55, carbonMat);
    // Endplates (Left & Right)
    addVoxel(0.06, 0.24, 0.52, -0.96, -0.14, 2.65, bodyMat);
    addVoxel(0.06, 0.24, 0.52, 0.96, -0.14, 2.65, bodyMat);

    // 4. Voxel Sidepods & Aerodynamic Intakes
    // Left sidepod
    addVoxel(0.42, 0.30, 1.4, -0.54, 0.04, -0.1, bodyMat);
    addVoxel(0.38, 0.24, 0.2, -0.54, 0.04, 0.62, carbonMat); // Intake grille
    // Right sidepod
    addVoxel(0.42, 0.30, 1.4, 0.54, 0.04, -0.1, bodyMat);
    addVoxel(0.38, 0.24, 0.2, 0.54, 0.04, 0.62, carbonMat); // Intake grille

    // 5. Cockpit, Voxel Halo & Driver Helmet
    // Cockpit opening interior
    addVoxel(0.44, 0.14, 0.8, 0, 0.18, 0.2, carbonMat);
    // Driver Helmet Voxel
    addVoxel(0.22, 0.22, 0.24, 0, 0.28, 0.15, highlightMat);
    // Helmet Visor
    addVoxel(0.20, 0.08, 0.06, 0, 0.28, 0.28, carbonMat);

    // Voxel Halo Safety Structure
    addVoxel(0.06, 0.22, 0.06, 0, 0.26, 0.52, carbonMat); // Center strut
    addVoxel(0.44, 0.05, 0.06, 0, 0.37, 0.36, carbonMat); // Top horizontal bar
    addVoxel(0.06, 0.05, 0.44, -0.22, 0.37, 0.15, carbonMat); // Left hoop bar
    addVoxel(0.06, 0.05, 0.44, 0.22, 0.37, 0.15, carbonMat); // Right hoop bar

    // 6. Engine Cover & Voxel Shark Fin
    addVoxel(0.28, 0.38, 1.1, 0, 0.32, -0.65, bodyMat);
    // Vertical stepped shark fin
    addVoxel(0.06, 0.46, 1.3, 0, 0.45, -0.85, carbonMat);

    // 7. Voxel Rear Wing Assembly
    const rearWingGroup = new THREE.Group();
    // Dual horizontal wing planes
    addVoxel(1.3, 0.06, 0.38, 0, 0.60, -1.85, carbonMat, rearWingGroup);
    addVoxel(1.25, 0.05, 0.22, 0, 0.72, -1.92, highlightMat, rearWingGroup);
    // Wing endplates
    addVoxel(0.06, 0.48, 0.45, -0.66, 0.56, -1.88, bodyMat, rearWingGroup);
    addVoxel(0.06, 0.48, 0.45, 0.66, 0.56, -1.88, bodyMat, rearWingGroup);
    // Support pylons
    addVoxel(0.06, 0.52, 0.08, -0.22, 0.32, -1.82, carbonMat, rearWingGroup);
    addVoxel(0.06, 0.52, 0.08, 0.22, 0.32, -1.82, carbonMat, rearWingGroup);
    // Rain light LED voxel
    addVoxel(0.12, 0.10, 0.06, 0, -0.05, -1.78, redLedMat, rearWingGroup);
    carGroup.add(rearWingGroup);
    this.rearWing = rearWingGroup;

    // 8. Four Voxel Wheels (Radius = 0.36m, hub at y = 0.0, bottom touches road at y = -0.36m)
    const wheelPositions = [
      { x: -0.92, y: 0.0, z: 1.55, isFront: true },   // Front Left
      { x: 0.92, y: 0.0, z: 1.55, isFront: true },    // Front Right
      { x: -0.88, y: 0.0, z: -1.45, isFront: false }, // Rear Left
      { x: 0.88, y: 0.0, z: -1.45, isFront: false }  // Rear Right
    ];

    for (const wp of wheelPositions) {
      const steerPivot = new THREE.Group();
      steerPivot.position.set(wp.x, wp.y, wp.z);

      const rollPivot = new THREE.Group();

      // Voxel wheel: octagonal/faceted voxel assembly
      const wWidth = wp.isFront ? 0.34 : 0.40;
      const wD = 0.72; // diameter = 2 * 0.36m

      // Main voxel tire block
      const tireBlock1 = new THREE.Mesh(new THREE.BoxGeometry(wWidth, wD, wD * 0.72), tireMat);
      tireBlock1.castShadow = true;
      rollPivot.add(tireBlock1);

      const tireBlock2 = new THREE.Mesh(new THREE.BoxGeometry(wWidth * 0.98, wD * 0.72, wD), tireMat);
      tireBlock2.castShadow = true;
      rollPivot.add(tireBlock2);

      // Center rim voxel cap
      const rimCap = new THREE.Mesh(new THREE.BoxGeometry(wWidth + 0.02, 0.34, 0.34), rimMat);
      rollPivot.add(rimCap);

      steerPivot.add(rollPivot);
      carGroup.add(steerPivot);

      this.wheelRollNodes.push(rollPivot);
      if (wp.isFront) {
        this.frontSteerNodes.push(steerPivot);
      }
    }

    carGroup.position.copy(this.position);
    return carGroup;
  }

  updateMeshTransform(steerAngle = 0) {
    this.mesh.position.copy(this.position);
    this.mesh.quaternion.copy(this.quaternion);

    // Dynamic wheel rolling rotation
    const speed = this.velocity.length();
    this.wheelRotAngle += (speed / this.wheelRadius) * 0.016;

    for (const w of this.wheelRollNodes) {
      w.rotation.x = this.wheelRotAngle;
    }

    // Dynamic front wheel steering angle
    for (const s of this.frontSteerNodes) {
      s.rotation.y = steerAngle;
    }

    // Velocity vector alignment
    if (speed > 0.1) {
      const dir = this.velocity.clone().normalize();
      this.vectorArrow.setDirection(dir);
      this.vectorArrow.setLength(Math.min(speed * 0.18, 8.0), 0.5, 0.25);
      this.vectorArrow.position.copy(this.position);
    }
  }

  setVectorsVisible(visible) {
    this.vectorArrow.visible = visible;
  }
}
