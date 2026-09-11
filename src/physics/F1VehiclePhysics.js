import * as THREE from 'three';

/**
 * 4-Wheel Suspension, Powertrain & Driving Mode Governor for F1 Grand Prix Spline Circuit.
 * Features:
 * - 8-speed V6 Turbo Hybrid Powertrain (~1000 hp / 740 kW).
 * - Driving modes:
 *   1. 'RACE CRUISE' (smartBraking = true): Driver throttles on straights (300+ km/h) and
 *      brakes for corners according to upcoming curvature kappa(s), carving the invisible racing line!
 *   2. 'FULL SPEED / ATTACK' (smartBraking = false or autoAccelerate = true):
 *      Driver pushes top speed into sharp corners without braking, inevitably triggering
 *      the physical traction limit and crashing into the barrier!
 * - Flush 4-wheel ground contact at y = 0.00m (0.0mm gap).
 */
export class F1VehiclePhysics {
  constructor(car, trackSpline) {
    this.car = car;
    this.spline = trackSpline;

    this.wheelbase = 3.6;
    this.trackWidth = 1.8;
    this.wheelRadius = 0.36; // 18-inch F1 wheel

    this.wheels = [
      { id: 'FL', localPos: new THREE.Vector3(-0.9, 0, 1.6), isFront: true, isLeft: true },
      { id: 'FR', localPos: new THREE.Vector3(0.9, 0, 1.6), isFront: true, isLeft: false },
      { id: 'RL', localPos: new THREE.Vector3(-0.85, 0, -1.5), isFront: false, isLeft: true },
      { id: 'RR', localPos: new THREE.Vector3(0.85, 0, -1.5), isFront: false, isLeft: false }
    ];

    // Powertrain settings (V6 Turbo Hybrid)
    this.gearRatios = [3.4, 2.5, 1.95, 1.55, 1.28, 1.08, 0.92, 0.80];
    this.currentGear = 4;
    this.engineRpm = 6500;
    this.throttle = 1.0;
    this.brake = 0.0;
    this.maxEnginePower = 740000;

    // Driving Modes
    this.targetSpeedKmh = 180.0;
    this.smartBraking = true;    // Safe Grand Prix race cruise: brakes for corners
    this.autoAccelerate = false;  // Full WOT attack: does not brake, demonstrates over-speed crash!

    // Real-time Physics Failure Diagnostics
    this.physicsStatus = {
      isViolated: false,
      isOffTrack: false,
      isCrashed: false,
      tractionRatio: 0.50,
      requiredForceN: 0,
      maxGripForceN: 0,
      lateralOffsetM: 0,
      curvature: 0.005,
      radiusOfCurvature: 200,
      crashSpeedKmh: 0,
      impactForceN: 0
    };

    this.pitch = 0;
    this.roll = 0;
  }

  setSmartBraking(enabled) {
    this.smartBraking = enabled;
  }

  setAutoAccelerate(enabled) {
    this.autoAccelerate = enabled;
  }

  setTargetSpeedKmh(kmh) {
    this.targetSpeedKmh = Math.max(60, kmh);
  }

  updateSuspension(dt) {
    // Exact road height is y = 0.0 (Slope 0)
    // Chassis origin at wheelRadius (0.36m), wheel bottom sits at 0.36 - 0.36 = 0.00m flush on asphalt
    this.car.position.y = this.wheelRadius;
    this.car.velocity.y = 0;
    this.car.isGrounded = true;

    // Centripetal cornering roll
    const latG = this.car.centripetalAccel / 9.81;
    const targetRoll = THREE.MathUtils.clamp(-latG * 0.02, -0.06, 0.06);
    this.roll = THREE.MathUtils.lerp(this.roll, targetRoll, 0.2);
  }

  updatePowertrain(speedMs, dt, upcomingCurvature = 0.005) {
    if (this.car && this.car.isCrashed) {
      this.throttle = 0.0;
      this.brake = 1.0;
      this.engineRpm = THREE.MathUtils.lerp(this.engineRpm, 900, 0.2);
      return -18000.0; // Crash emergency stop
    }

    const speedKmh = speedMs * 3.6;

    // Determine target speed based on mode and upcoming curvature
    let effectiveTargetMs = this.targetSpeedKmh / 3.6;

    if (this.autoAccelerate) {
      // 100% WOT Attack Mode: never brakes, accelerates through all gears until corner friction crashes!
      this.throttle = 1.0;
      this.brake = 0.0;
    } else if (this.smartBraking) {
      // Race Cruise Mode: calculates maximum safe cornering speed for upcoming corner curvature kappa
      const mu = this.car.tireModel ? this.car.tireModel.telemetry.effectiveMu : 1.65;
      const safeCornerMs = Math.sqrt((mu * 9.81 * 0.85) / Math.max(upcomingCurvature, 0.001));
      effectiveTargetMs = Math.min(effectiveTargetMs, safeCornerMs);

      if (speedMs > effectiveTargetMs + 1.0) {
        this.throttle = 0.0;
        this.brake = THREE.MathUtils.clamp((speedMs - effectiveTargetMs) * 0.35, 0.2, 1.0);
      } else {
        this.brake = 0.0;
        this.throttle = THREE.MathUtils.clamp(1.0 - (speedMs / effectiveTargetMs) * 0.1, 0.4, 1.0);
      }
    } else {
      // Manual slider speed governor without corner anticipation
      if (speedMs > effectiveTargetMs + 0.5) {
        this.throttle = 0.0;
        this.brake = THREE.MathUtils.clamp((speedMs - effectiveTargetMs) * 0.3, 0.1, 0.85);
      } else {
        this.brake = 0.0;
        this.throttle = THREE.MathUtils.clamp(1.0 - (speedMs / effectiveTargetMs) * 0.15, 0.35, 1.0);
      }
    }

    // Dynamic Gear Selection
    const gearSpeedThresholds = [0, 75, 120, 165, 210, 255, 295, 335];
    let selectedGear = 1;
    for (let g = 1; g <= 8; g++) {
      if (speedKmh >= gearSpeedThresholds[g - 1]) selectedGear = g;
    }
    this.currentGear = selectedGear;

    const ratio = this.gearRatios[this.currentGear - 1];
    const wheelRps = speedMs / (2 * Math.PI * this.wheelRadius);
    const rpm = THREE.MathUtils.clamp(wheelRps * ratio * 60 * 3.6, 4200, 15000);
    this.engineRpm = THREE.MathUtils.lerp(this.engineRpm, rpm, 0.15);

    if (this.brake > 0) {
      return -this.brake * 18000.0;
    } else if (this.throttle > 0) {
      if (speedMs > 2.0) {
        return Math.min(this.maxEnginePower / speedMs, 14000.0) * this.throttle;
      }
      return 13000.0 * this.throttle;
    }
    return 0;
  }
}
