import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TrackSpline } from './track/TrackSpline.js';
import { TrackMesh } from './track/TrackMesh.js';
import { RigidBody } from './physics/RigidBody.js';
import { F1Car } from './entities/F1Car.js';
import { PhysicsEngine } from './physics/PhysicsEngine.js';
import { TelemetryHUD } from './ui/TelemetryHUD.js';

class PhysicsTrackApp {
  constructor() {
    this.container = document.getElementById('canvas-container');
    this.cameraMode = 'follow';
    this.vehicleType = 'f1';
    this.vectorsVisible = true;
    this.wireframeEnabled = false;

    this.initGraphics();
    this.initSceneContent();
    this.initPhysics();
    this.hud = new TelemetryHUD(this.physics, this);

    this.bindWindowResize();

    this.lastTime = performance.now();
    this.fpsHistory = [];
    this.currentFps = 60.0;

    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);
  }

  initGraphics() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0f1013);
    this.scene.fog = new THREE.FogExp2(0x0f1013, 0.0014);

    const aspect = window.innerWidth / window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(52, aspect, 0.15, 2500);
    this.camera.position.set(120, 15, -25);

    this.renderer = new THREE.WebGLRenderer({
      powerPreference: 'high-performance',
      antialias: true
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2.0));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.02;
    this.controls.enabled = false;

    // Clean CAD Studio Monochrome Lighting
    const ambientLight = new THREE.AmbientLight(0x4c505b, 1.4);
    this.scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 2.4);
    dirLight.position.set(150, 220, 100);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.camera.near = 10;
    dirLight.shadow.camera.far = 650;
    dirLight.shadow.camera.left = -350;
    dirLight.shadow.camera.right = 350;
    dirLight.shadow.camera.top = 350;
    dirLight.shadow.camera.bottom = -350;
    dirLight.shadow.bias = -0.0003;
    this.scene.add(dirLight);

    const fillLight = new THREE.DirectionalLight(0x6a707c, 0.75);
    fillLight.position.set(-150, 80, -120);
    this.scene.add(fillLight);

    // Ground Plane & Grid at y = 0
    const grid = new THREE.GridHelper(1200, 100, 0x3b3f49, 0x191a1e);
    grid.position.y = -0.01;
    this.scene.add(grid);

    const floorGeo = new THREE.PlaneGeometry(1200, 1200);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x0c0d0f,
      roughness: 0.95,
      metalness: 0.05
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.05;
    floor.receiveShadow = true;
    this.scene.add(floor);
  }

  initSceneContent() {
    this.trackSpline = new TrackSpline();
    this.trackMesh = new TrackMesh(this.trackSpline);
    this.scene.add(this.trackMesh.group);
  }

  initPhysics() {
    this.physics = new PhysicsEngine(this.trackSpline);
    this.createLeadVehicle('f1');

    this.camTargetPos = new THREE.Vector3();
    this.camTargetLook = new THREE.Vector3();
  }

  createLeadVehicle(type) {
    if (this.leadBody) {
      this.scene.remove(this.leadBody.mesh);
      this.scene.remove(this.leadBody.vectorArrow);
      this.physics.removeBody(this.leadBody);
    }

    this.vehicleType = type;

    const startSample = this.trackSpline.lut[0];
    const startPoint = startSample.point;
    const startTangent = startSample.tangent;
    const startYaw = Math.atan2(startTangent.x, startTangent.z);
    const startSpeed = type === 'f1' ? 44.44 : 30.0;
    const startY = type === 'f1' ? 0.36 : 0.85;

    const vel = new THREE.Vector3(
      Math.sin(startYaw) * startSpeed,
      0,
      Math.cos(startYaw) * startSpeed
    );

    if (type === 'f1') {
      this.leadBody = new F1Car({
        id: 'f1-lead',
        yaw: startYaw,
        position: new THREE.Vector3(startPoint.x, startY, startPoint.z),
        velocity: vel,
        trackSpline: this.trackSpline
      });
      if (this.leadBody.suspension) {
        this.leadBody.suspension.setSmartBraking(true);
        this.leadBody.suspension.setTargetSpeedKmh(240.0);
      }
    } else {
      this.leadBody = new RigidBody({
        id: 'sphere-lead',
        isLead: true,
        radius: 0.85,
        mass: 14.0,
        restitution: 0.55,
        friction: 0.04,
        position: new THREE.Vector3(startPoint.x, startY, startPoint.z),
        velocity: vel
      });
    }

    this.leadBody.setVectorsVisible(this.vectorsVisible);
    this.scene.add(this.leadBody.mesh);
    this.scene.add(this.leadBody.vectorArrow);
    if (this.leadBody.sparkPoints) {
      this.scene.add(this.leadBody.sparkPoints);
    }
    this.physics.addBody(this.leadBody);
  }

  setTargetSpeedKmh(kmh) {
    if (this.leadBody && this.leadBody.suspension) {
      this.leadBody.suspension.setTargetSpeedKmh(kmh);
    }
  }

  toggleSmartBraking() {
    if (!this.leadBody || !this.leadBody.suspension) return;
    const current = this.leadBody.suspension.smartBraking;
    const next = !current;
    this.leadBody.suspension.setSmartBraking(next);
    if (this.hud && this.hud.btnSmartBraking) {
      this.hud.btnSmartBraking.classList.toggle('active-toggle', next);
      this.hud.btnSmartBraking.textContent = next ? 'RACE CRUISE [B]' : 'ATTACK (NO BRAKE) [B]';
    }
  }

  toggleInvisibleLine() {
    const nextState = !this.trackMesh.lineVisible;
    this.trackMesh.setTargetLineVisible(nextState);
    if (this.hud.btnToggleLine) {
      this.hud.btnToggleLine.textContent = nextState ? 'HIDE LINE [L]' : 'SHOW LINE [L]';
      this.hud.btnToggleLine.classList.toggle('active-toggle', nextState);
    }
  }

  toggleAutoAccelerate() {
    if (!this.leadBody || !this.leadBody.suspension) return;
    const current = this.leadBody.suspension.autoAccelerate;
    const next = !current;
    this.leadBody.suspension.setAutoAccelerate(next);
    if (this.hud && this.hud.btnAutoAccelerate) {
      this.hud.btnAutoAccelerate.classList.toggle('active-toggle', next);
      this.hud.btnAutoAccelerate.textContent = next ? 'ATTACK: 100% WOT' : 'ATTACK (100% WOT) [A]';
    }
  }

  switchVehicle(type) {
    if (this.vehicleType === type) return;
    this.createLeadVehicle(type);
  }

  setTireCompound(compoundKey) {
    if (this.leadBody && this.leadBody.tireModel) {
      this.leadBody.tireModel.setCompound(compoundKey);
    }
  }

  applyBoostImpulse() {
    if (!this.leadBody) return;
    const fwd = this.leadBody.heading || new THREE.Vector3(0, 0, 1);
    this.leadBody.velocity.addScaledVector(fwd, 30.0); // +108 km/h boost past traction limit!
  }

  resetLeadBody() {
    if (!this.leadBody) return;
    const startSample = this.trackSpline.lut[0];
    const startPoint = startSample.point;
    const startTangent = startSample.tangent;
    const startYaw = Math.atan2(startTangent.x, startTangent.z);
    const startY = this.vehicleType === 'f1' ? 0.36 : 0.85;
    const startSpeed = this.vehicleType === 'f1' ? 44.44 : 30.0;

    this.leadBody.position.set(startPoint.x, startY, startPoint.z);
    this.leadBody.velocity.set(
      Math.sin(startYaw) * startSpeed,
      0,
      Math.cos(startYaw) * startSpeed
    );
    this.leadBody.yaw = startYaw;
    this.leadBody.yawRate = 0.0;
    this.leadBody.steerAngle = 0.0;
    this.leadBody.isCrashed = false;
    this.leadBody.isOffTrack = false;
    if (this.leadBody.resetCrashState) this.leadBody.resetCrashState();
    if (this.leadBody.angularVelocity) this.leadBody.angularVelocity.set(0, 0, 0);
    this.leadBody.quaternion.identity();
    this.leadBody.isGrounded = true;

    if (this.leadBody.suspension) {
      this.leadBody.suspension.setAutoAccelerate(false);
      this.leadBody.suspension.setSmartBraking(true);
      this.leadBody.suspension.setTargetSpeedKmh(240.0);
      this.leadBody.suspension.physicsStatus = {
        isViolated: false,
        isOffTrack: false,
        isCrashed: false,
        tractionRatio: 0.40,
        requiredForceN: 0,
        maxGripForceN: 0,
        lateralOffsetM: 0,
        curvature: 0,
        radiusOfCurvature: Infinity,
        crashSpeedKmh: 0,
        impactForceN: 0
      };
    }
    if (this.hud && this.hud.sliderTargetSpeed) {
      this.hud.sliderTargetSpeed.value = '240';
      if (this.hud.txtTargetSpeed) this.hud.txtTargetSpeed.textContent = '240';
    }
    if (this.hud && this.hud.btnAutoAccelerate) {
      this.hud.btnAutoAccelerate.classList.remove('active-toggle');
      this.hud.btnAutoAccelerate.textContent = 'ATTACK (100% WOT) [A]';
    }
    if (this.hud && this.hud.btnSmartBraking) {
      this.hud.btnSmartBraking.classList.add('active-toggle');
      this.hud.btnSmartBraking.textContent = 'RACE CRUISE [B]';
    }
  }

  spawnBodies(count = 10) {
    const totalSamples = this.trackSpline.lut.length;
    for (let i = 0; i < count; i++) {
      const sampleIdx = Math.floor((i + 1) * (totalSamples / (count + 2))) % totalSamples;
      const sample = this.trackSpline.lut[sampleIdx];
      const latOffset = (Math.random() - 0.5) * 6.0;
      const pos = sample.point.clone().addScaledVector(sample.binormal, latOffset);
      pos.y = 0.5 + Math.random() * 0.4;

      const body = new RigidBody({
        isLead: false,
        radius: 0.5 + Math.random() * 0.35,
        mass: 8.0 + Math.random() * 10.0,
        restitution: 0.6,
        friction: 0.8,
        position: pos
      });
      const speed = 25.0 + Math.random() * 15.0;
      body.velocity.copy(sample.tangent).multiplyScalar(speed);

      body.setVectorsVisible(this.vectorsVisible);
      this.scene.add(body.mesh);
      this.scene.add(body.vectorArrow);
      this.physics.addBody(body);
    }
  }

  setCameraMode(mode) {
    this.cameraMode = mode;
    if (mode === 'orbit') {
      this.controls.enabled = true;
      if (this.leadBody) this.controls.target.copy(this.leadBody.position);
    } else {
      this.controls.enabled = false;
    }
  }

  setVectorsVisible(visible) {
    this.vectorsVisible = visible;
    for (const b of this.physics.bodies) {
      b.setVectorsVisible(visible);
    }
  }

  setWireframe(enabled) {
    this.wireframeEnabled = enabled;
    this.trackMesh.setWireframe(enabled);
  }

  updateCamera() {
    if (this.cameraMode === 'follow' && this.leadBody) {
      const bodyPos = this.leadBody.position;
      const vel = this.leadBody.velocity;
      const speed = vel.length();

      let forward = vel.clone().normalize();
      if (speed < 0.5) {
        forward.set(0, 0, 1);
      }

      // Onboard Chase Cam: close, low, clearly showing tires on asphalt
      const isF1 = this.vehicleType === 'f1';
      const chaseDist = isF1 ? (7.5 + Math.min(speed * 0.06, 3.5)) : (12.0 + Math.min(speed * 0.15, 6.0));
      const chaseHeight = isF1 ? (2.1 + Math.min(speed * 0.02, 1.2)) : (5.0 + Math.min(speed * 0.05, 3.0));

      const desiredPos = bodyPos.clone()
        .addScaledVector(forward, -chaseDist)
        .add(new THREE.Vector3(0, chaseHeight, 0));

      const desiredLook = bodyPos.clone().addScaledVector(forward, 6.0);

      this.camera.position.lerp(desiredPos, 0.1);
      this.camTargetLook.lerp(desiredLook, 0.15);
      this.camera.lookAt(this.camTargetLook);
    } else if (this.cameraMode === 'orbit') {
      this.controls.update();
    }
  }

  animate(now) {
    requestAnimationFrame(this.animate);

    const delta = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;

    if (delta > 0) {
      const instantFps = 1.0 / delta;
      this.fpsHistory.push(instantFps);
      if (this.fpsHistory.length > 20) this.fpsHistory.shift();
      const sum = this.fpsHistory.reduce((a, b) => a + b, 0);
      this.currentFps = sum / this.fpsHistory.length;
    }

    // 1. High-Efficiency Physics Step
    this.physics.update(delta);

    // 2. Update visual mesh transforms & particle FX
    for (let i = 0; i < this.physics.bodies.length; i++) {
      const b = this.physics.bodies[i];
      if (b.isCar) {
        b.updateMeshTransform(b.steerAngle || 0);
        if (b.updateSparks) b.updateSparks(delta);
      } else {
        b.updateMeshTransform();
      }
    }

    // 3. Update Camera
    this.updateCamera();

    // 4. Render Scene
    this.renderer.render(this.scene, this.camera);

    // 5. Update Telemetry HUD
    const drawCalls = this.renderer.info.render.calls;
    this.hud.update(this.currentFps, this.leadBody, drawCalls);
  }

  bindWindowResize() {
    window.addEventListener('resize', () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(width, height);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2.0));
    });
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new PhysicsTrackApp();
});
