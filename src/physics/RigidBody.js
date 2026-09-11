import * as THREE from 'three';

/**
 * 3D Physics Rigid Body with mass, inertia, linear/angular momentum,
 * and visual representation in monochrome engineering styling.
 */
export class RigidBody {
  constructor(options = {}) {
    this.id = options.id || Math.random().toString(36).substring(2, 9);
    this.radius = options.radius || 0.75;
    this.mass = options.mass || 12.0; // kg
    this.invMass = 1.0 / this.mass;

    // Sphere moment of inertia I = 2/5 * m * r^2
    this.inertia = (2.0 / 5.0) * this.mass * this.radius * this.radius;
    this.invInertia = 1.0 / this.inertia;

    this.restitution = options.restitution !== undefined ? options.restitution : 0.6;
    this.friction = options.friction !== undefined ? options.friction : 0.05;

    // Kinematics
    this.position = new THREE.Vector3().copy(options.position || new THREE.Vector3(0, 35, 0));
    this.velocity = new THREE.Vector3().copy(options.velocity || new THREE.Vector3(0, 0, 8.0));
    this.acceleration = new THREE.Vector3();
    this.angularVelocity = new THREE.Vector3();
    this.quaternion = new THREE.Quaternion();

    // Contact & Telemetry State
    this.isGrounded = false;
    this.contactNormal = new THREE.Vector3(0, 1, 0);
    this.contactPoint = new THREE.Vector3();
    this.centripetalAccel = 0;
    this.gForce = 1.0;
    this.totalEnergy = 0;

    // Visual Mesh (Monochrome CAD sphere with wireframe/latitude lines)
    this.mesh = this.createVisualMesh(options.isLead);

    // Dynamic Velocity Vector visualization
    this.vectorArrow = new THREE.ArrowHelper(
      new THREE.Vector3(0, 0, 1),
      this.position,
      2.0,
      options.isLead ? 0xffffff : 0x888888,
      0.6,
      0.3
    );
    this.vectorArrow.visible = true;
  }

  createVisualMesh(isLead) {
    const group = new THREE.Group();

    // Solid core sphere
    const sphereGeo = new THREE.SphereGeometry(this.radius, 24, 20);
    const sphereMat = new THREE.MeshStandardMaterial({
      color: isLead ? 0xe5e7eb : 0x717680,
      roughness: 0.35,
      metalness: 0.4,
      wireframe: false
    });

    const sphereMesh = new THREE.Mesh(sphereGeo, sphereMat);
    sphereMesh.castShadow = true;
    sphereMesh.receiveShadow = true;
    group.add(sphereMesh);

    // Subtle equatorial rings to visualize rolling rotation
    const ringGeo = new THREE.RingGeometry(this.radius * 0.99, this.radius * 1.01, 24);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x111315,
      side: THREE.DoubleSide
    });
    const ringX = new THREE.Mesh(ringGeo, ringMat);
    ringX.rotation.x = Math.PI / 2;
    group.add(ringX);

    const ringY = new THREE.Mesh(ringGeo, ringMat);
    ringY.rotation.y = Math.PI / 2;
    group.add(ringY);

    group.position.copy(this.position);
    return group;
  }

  updateMeshTransform() {
    this.mesh.position.copy(this.position);
    this.mesh.quaternion.copy(this.quaternion);

    // Update velocity arrow
    const speed = this.velocity.length();
    if (speed > 0.1) {
      const dir = this.velocity.clone().normalize();
      this.vectorArrow.setDirection(dir);
      this.vectorArrow.setLength(Math.min(speed * 0.25, 8.0), 0.5, 0.25);
      this.vectorArrow.position.copy(this.position);
    }
  }

  setVectorsVisible(visible) {
    this.vectorArrow.visible = visible;
  }
}
