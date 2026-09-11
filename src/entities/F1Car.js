import * as THREE from 'three';
import { F1TireModel } from '../physics/F1TireModel.js';
import { F1VehiclePhysics } from '../physics/F1VehiclePhysics.js';
import { buildVoxelCar } from './VoxelCarLoader.js';

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

    // FIA Minimum Racing Mass — overridden below if a real voxel car was imported.
    this.mass = 798.0; // kg
    this.invMass = 1.0 / this.mass;
    this.voxelCarData = options.voxelCarData || null;

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

    this.mesh = this.buildVoxelF1Mesh();

    // A real imported voxel body carries its own mass and aerodynamics —
    // every voxel cell contributes to what the physics actually feels,
    // rather than every imported shape getting the same generic F1 numbers.
    if (this.voxelBuild) {
      this.mass = this.voxelBuild.mass;
      this.invMass = 1.0 / this.mass;
      this.tireModel.refArea = this.voxelBuild.frontalArea;
      this.tireModel.baseCd = this.voxelBuild.dragCoefficient;
      this.tireModel.carMass = this.mass;
    }

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

    // A real imported car replaces the procedural bodywork entirely — the
    // wheels below still get built and attached at the same chassis points,
    // so steering/rolling animation and the suspension model don't change.
    if (this.voxelCarData) {
      const built = buildVoxelCar(this.voxelCarData, this.length);
      if (built) {
        carGroup.add(built.group);
        this.voxelBuild = built;
      }
    }


    carGroup.position.copy(this.position);
    return carGroup;
  }

  updateMeshTransform(steerAngle = 0) {
    this.mesh.position.copy(this.position);
    this.mesh.quaternion.copy(this.quaternion);

    const speed = this.velocity.length();
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
