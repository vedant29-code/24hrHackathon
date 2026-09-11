import * as THREE from 'three';
import { F1TireModel } from '../physics/F1TireModel.js';
import { F1VehiclePhysics } from '../physics/F1VehiclePhysics.js';

/**
 * 3D Procedural Formula 1 Car with authentic 4-wheel ground contact,
 * realistic suspension, steering geometry, and CAD monochrome aesthetic.
 */
export class F1Car {
  constructor(options = {}) {
    this.id = options.id || 'f1-car-01';
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

    // Physical state & Polar Coordinates
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
    this.restitution = 0.1; // Realistic stiff race car damping
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
    this.mesh = this.buildF1Mesh();

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

    // Skid & Crash sparks particle system
    this.initSparks();
  }

  initSparks() {
    this.sparkCount = 45;
    const sparkGeo = new THREE.BufferGeometry();
    const positions = new Float32Array(this.sparkCount * 3);
    sparkGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const sparkMat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.18,
      transparent: true,
      opacity: 0.85
    });

    this.sparkPoints = new THREE.Points(sparkGeo, sparkMat);
    this.sparkVelocities = [];
    this.sparkLifetimes = [];
    for (let i = 0; i < this.sparkCount; i++) {
      this.sparkVelocities.push(new THREE.Vector3());
      this.sparkLifetimes.push(0);
    }
  }

  triggerCrash(impactSpeedKmh, normal) {
    this.isCrashed = true;
    this.crashSpeedKmh = impactSpeedKmh;
    this.isOffTrack = true;

    // Emit intense burst of sparks in reflection direction
    const posAttr = this.sparkPoints.geometry.attributes.position;
    for (let i = 0; i < this.sparkCount; i++) {
      posAttr.setXYZ(i, this.position.x, this.position.y + 0.2, this.position.z);
      this.sparkLifetimes[i] = 0.4 + Math.random() * 0.6;

      const spread = (Math.random() - 0.5) * 12.0;
      this.sparkVelocities[i].set(
        normal.x * (10.0 + Math.random() * 15.0) - normal.z * spread,
        2.0 + Math.random() * 6.0,
        normal.z * (10.0 + Math.random() * 15.0) + normal.x * spread
      );
    }
    posAttr.needsUpdate = true;
  }

  updateSparks(dt) {
    let hasActive = false;
    const posAttr = this.sparkPoints.geometry.attributes.position;

    for (let i = 0; i < this.sparkCount; i++) {
      if (this.sparkLifetimes[i] > 0) {
        hasActive = true;
        this.sparkLifetimes[i] -= dt;

        let px = posAttr.getX(i) + this.sparkVelocities[i].x * dt;
        let py = posAttr.getY(i) + this.sparkVelocities[i].y * dt;
        let pz = posAttr.getZ(i) + this.sparkVelocities[i].z * dt;

        this.sparkVelocities[i].y -= 9.81 * dt; // Gravity

        // Bounce off flat ground at y = 0
        if (py < 0.02) {
          py = 0.02;
          this.sparkVelocities[i].y *= -0.4;
          this.sparkVelocities[i].x *= 0.8;
          this.sparkVelocities[i].z *= 0.8;
        }

        posAttr.setXYZ(i, px, py, pz);
      }
    }
    if (hasActive) {
      posAttr.needsUpdate = true;
    }
  }

  resetCrashState() {
    this.isCrashed = false;
    this.isOffTrack = false;
    this.crashSpeedKmh = 0.0;
    this.impactForceN = 0.0;
    this.steerAngle = 0.0;
    this.yawRate = 0.0;

    const posAttr = this.sparkPoints.geometry.attributes.position;
    for (let i = 0; i < this.sparkCount; i++) {
      this.sparkLifetimes[i] = 0;
      posAttr.setXYZ(i, 0, -10, 0);
    }
    posAttr.needsUpdate = true;
  }

  buildF1Mesh() {
    const group = new THREE.Group();

    // Clean CAD Monochromatic Palette
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x2e323a,
      roughness: 0.45,
      metalness: 0.4
    });

    const darkAeroMat = new THREE.MeshStandardMaterial({
      color: 0x16171a,
      roughness: 0.7,
      metalness: 0.15
    });

    const tireMat = new THREE.MeshStandardMaterial({
      color: 0x101113,
      roughness: 0.9,
      metalness: 0.05
    });

    const wheelRimMat = new THREE.MeshStandardMaterial({
      color: 0x858b96,
      roughness: 0.25,
      metalness: 0.85
    });

    // 1. Monocoque / Cockpit (Chassis base sits 0.06m above wheel bottom)
    const monocoqueGeo = new THREE.BoxGeometry(0.72, 0.45, 3.2);
    const monocoque = new THREE.Mesh(monocoqueGeo, bodyMat);
    monocoque.position.set(0, 0.08, 0);
    monocoque.castShadow = true;
    group.add(monocoque);

    // 2. Tapered Nose Cone
    const noseGeo = new THREE.ConeGeometry(0.36, 1.4, 4);
    noseGeo.rotateX(Math.PI / 2);
    const nose = new THREE.Mesh(noseGeo, bodyMat);
    nose.position.set(0, 0.05, 2.1);
    nose.scale.set(1.0, 0.55, 1.0);
    nose.castShadow = true;
    group.add(nose);

    // 3. Front Wing (Low to ground for ground effect)
    const frontWingGeo = new THREE.BoxGeometry(1.85, 0.04, 0.45);
    const frontWing = new THREE.Mesh(frontWingGeo, darkAeroMat);
    frontWing.position.set(0, -0.15, 2.5);
    frontWing.castShadow = true;
    group.add(frontWing);

    // Endplates
    const endplateGeo = new THREE.BoxGeometry(0.04, 0.24, 0.5);
    const endplateL = new THREE.Mesh(endplateGeo, darkAeroMat);
    endplateL.position.set(-0.92, -0.05, 2.5);
    group.add(endplateL);
    const endplateR = new THREE.Mesh(endplateGeo, darkAeroMat);
    endplateR.position.set(0.92, -0.05, 2.5);
    group.add(endplateR);

    // 4. Sidepods & Floor Underbody
    const sidepodGeo = new THREE.BoxGeometry(0.4, 0.32, 1.6);
    const sidepodL = new THREE.Mesh(sidepodGeo, bodyMat);
    sidepodL.position.set(-0.56, 0.06, -0.2);
    sidepodL.castShadow = true;
    group.add(sidepodL);
    const sidepodR = new THREE.Mesh(sidepodGeo, bodyMat);
    sidepodR.position.set(0.56, 0.06, -0.2);
    sidepodR.castShadow = true;
    group.add(sidepodR);

    // Floor Plank / Diffuser (Sits 0.04m above road surface)
    const floorGeo = new THREE.BoxGeometry(1.65, 0.04, 2.8);
    const floor = new THREE.Mesh(floorGeo, darkAeroMat);
    floor.position.set(0, -0.22, -0.1);
    group.add(floor);

    // 5. Cockpit, Halo & Airbox
    const haloTorus = new THREE.TorusGeometry(0.24, 0.035, 8, 16, Math.PI);
    haloTorus.rotateX(Math.PI / 2);
    const halo = new THREE.Mesh(haloTorus, darkAeroMat);
    halo.position.set(0, 0.35, 0.45);
    group.add(halo);

    const airboxGeo = new THREE.BoxGeometry(0.12, 0.45, 1.1);
    const airbox = new THREE.Mesh(airboxGeo, bodyMat);
    airbox.position.set(0, 0.42, -0.5);
    airbox.castShadow = true;
    group.add(airbox);

    // 6. Rear Wing Assembly with DRS flap
    const rearWingGeo = new THREE.BoxGeometry(1.25, 0.05, 0.4);
    this.rearWing = new THREE.Mesh(rearWingGeo, darkAeroMat);
    this.rearWing.position.set(0, 0.62, -1.85);
    this.rearWing.castShadow = true;
    group.add(this.rearWing);

    const pylonL = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.55, 0.08), darkAeroMat);
    pylonL.position.set(-0.25, 0.35, -1.8);
    group.add(pylonL);
    const pylonR = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.55, 0.08), darkAeroMat);
    pylonR.position.set(0.25, 0.35, -1.8);
    group.add(pylonR);

    // 7. Four Wheels (Hub centered at y = 0, so bottom touches road at -0.36m)
    const wheelPositions = [
      { x: -0.9, y: 0.0, z: 1.6, isFront: true },   // Front Left
      { x: 0.9, y: 0.0, z: 1.6, isFront: true },    // Front Right
      { x: -0.85, y: 0.0, z: -1.5, isFront: false }, // Rear Left
      { x: 0.85, y: 0.0, z: -1.5, isFront: false }  // Rear Right
    ];

    const wheelGeo = new THREE.CylinderGeometry(this.wheelRadius, this.wheelRadius, 0.36, 20);
    wheelGeo.rotateZ(Math.PI / 2);

    const rimGeo = new THREE.CylinderGeometry(this.wheelRadius * 0.56, this.wheelRadius * 0.56, 0.37, 14);
    rimGeo.rotateZ(Math.PI / 2);

    for (const wp of wheelPositions) {
      const steerPivot = new THREE.Group();
      steerPivot.position.set(wp.x, wp.y, wp.z);

      const rollPivot = new THREE.Group();

      const tireMesh = new THREE.Mesh(wheelGeo, tireMat);
      tireMesh.castShadow = true;
      rollPivot.add(tireMesh);

      const rimMesh = new THREE.Mesh(rimGeo, wheelRimMat);
      rollPivot.add(rimMesh);

      steerPivot.add(rollPivot);
      group.add(steerPivot);

      this.wheelRollNodes.push(rollPivot);
      if (wp.isFront) {
        this.frontSteerNodes.push(steerPivot);
      }
    }

    group.position.copy(this.position);
    return group;
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

    // DRS Flap animation
    if (this.rearWing) {
      this.rearWing.rotation.x = this.tireModel.drsActive ? -0.32 : 0;
    }
  }

  setVectorsVisible(visible) {
    this.vectorArrow.visible = visible;
  }
}
