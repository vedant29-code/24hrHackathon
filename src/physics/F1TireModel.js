import * as THREE from 'three';

/**
 * High-Efficiency F1 Tire & Aerodynamics Model.
 * Implements the Pacejka 'Magic Formula' tire dynamics, load sensitivity,
 * aerodynamic downforce (inverted wing effect), and DRS (Drag Reduction System).
 *
 * Formulas:
 * 1. Downforce: F_aero = 0.5 * rho * (Cl * A) * v^2
 * 2. Total Vertical Load: F_z = F_gravity + F_aero
 * 3. Load Sensitivity: mu_peak = mu_0 * (F_z_ref / F_z)^gamma
 * 4. Pacejka Lateral Force: F_y = D * sin(C * arctan(B * alpha - E * (B * alpha - arctan(B * alpha))))
 * 5. Rolling Resistance: F_rr = Crr * F_z
 */
export class F1TireModel {
  constructor() {
    // Air properties
    this.airDensity = 1.225; // kg/m^3 (sea level dry air)
    
    // F1 Aerodynamic parameters (2024-spec ground effect + wings)
    this.refArea = 1.6; // frontal area m^2
    this.baseCd = 0.85; // Drag coefficient with rear wing open/closed
    this.baseCl = 3.2;  // High downforce lift coefficient
    this.drsActive = false;

    // F1 Mass: ~798 kg minimum FIA weight (scaled to ~800 kg)
    this.carMass = 798.0; 

    // Pacejka Magic Formula coefficients (calibrated for F1 racing slicks on asphalt)
    this.pacejka = {
      B: 10.0,  // Stiffness factor
      C: 1.65,  // Shape factor (typically 1.3 - 1.9 for racing slicks)
      E: -0.85, // Curvature factor
      refLoad: 4000.0, // N (nominal wheel load reference)
      loadSensitivityExp: 0.12 // De-rating exponent with vertical load
    };

    // Tire compound friction presets
    this.compounds = {
      SOFT: { name: 'Soft (C5)', mu0: 1.85, Crr: 0.022 },
      MEDIUM: { name: 'Medium (C3)', mu0: 1.65, Crr: 0.018 },
      HARD: { name: 'Hard (C1)', mu0: 1.45, Crr: 0.015 },
      WET: { name: 'Wet', mu0: 1.10, Crr: 0.028 }
    };
    this.currentCompoundKey = 'SOFT';
    this.activeCompound = this.compounds.SOFT;

    // Road surface grip multiplier — independent of tire compound.
    // Models track condition (rubbered-in asphalt, dust, wet patches, etc).
    this.surfaceFriction = 1.0;

    // Real-time telemetry metrics
    this.telemetry = {
      downforceN: 0,
      dragN: 0,
      totalLoadN: 0,
      effectiveMu: 1.85,
      lateralForceN: 0,
      slipAngleDeg: 0,
      drsOpen: false
    };
  }

  setCompound(compoundKey) {
    if (this.compounds[compoundKey]) {
      this.currentCompoundKey = compoundKey;
      this.activeCompound = this.compounds[compoundKey];
    }
  }

  setDRS(active) {
    this.drsActive = active;
  }

  setSurfaceFriction(scale) {
    this.surfaceFriction = scale;
  }

  /**
   * Fast evaluation of aerodynamic forces (downforce and drag)
   */
  computeAerodynamics(speed) {
    const vSq = speed * speed;
    const cl = this.drsActive ? this.baseCl * 0.72 : this.baseCl;
    const cd = this.drsActive ? this.baseCd * 0.65 : this.baseCd;

    const downforce = 0.5 * this.airDensity * cl * this.refArea * vSq;
    const drag = 0.5 * this.airDensity * cd * this.refArea * vSq;

    this.telemetry.downforceN = downforce;
    this.telemetry.dragN = drag;
    this.telemetry.drsOpen = this.drsActive;

    return { downforce, drag };
  }

  /**
   * Evaluates Pacejka Magic Formula for lateral tire cornering grip.
   * alpha: Slip angle in radians
   * verticalLoad: Total normal force on tire patch (N)
   */
  evaluatePacejkaLateral(alpha, verticalLoad) {
    // 1. Calculate friction coefficient de-rated by vertical load sensitivity
    const fz = Math.max(verticalLoad, 200.0);
    const loadRatio = this.pacejka.refLoad / fz;
    const muPeak = this.activeCompound.mu0 * this.surfaceFriction * Math.pow(loadRatio, this.pacejka.loadSensitivityExp);
    this.telemetry.effectiveMu = muPeak;

    // 2. Peak lateral force D
    const D = muPeak * fz;

    // 3. Pacejka trigonometric curve
    const B = this.pacejka.B;
    const C = this.pacejka.C;
    const E = this.pacejka.E;

    const B_alpha = B * alpha;
    const inner = B_alpha - E * (B_alpha - Math.atan(B_alpha));
    const Fy = D * Math.sin(C * Math.atan(inner));

    this.telemetry.lateralForceN = Fy;
    this.telemetry.slipAngleDeg = THREE.MathUtils.radToDeg(alpha);
    this.telemetry.totalLoadN = fz;

    return {
      lateralForce: Fy,
      muPeak,
      maxGripForce: D
    };
  }

  /**
   * Rolling resistance force opposed to forward motion
   */
  computeRollingResistance(verticalLoad) {
    return this.activeCompound.Crr * Math.max(verticalLoad, 0);
  }
}
