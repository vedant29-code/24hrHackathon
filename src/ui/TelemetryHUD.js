/**
 * Real-time HUD and Simulation Telemetry Controller.
 * Handles performance stats, DOM updates, F1 Pacejka dynamics, and user controls.
 */
export class TelemetryHUD {
  constructor(physicsEngine, mainApp) {
    this.physics = physicsEngine;
    this.app = mainApp;

    this.cacheDOMElements();
    this.bindEvents();
  }

  cacheDOMElements() {
    this.fpsDisplay = document.getElementById('fps-display');
    this.stepTimeDisplay = document.getElementById('step-time-display');

    // Telemetry
    this.valVel = document.getElementById('val-vel');
    this.valGForce = document.getElementById('val-gforce');
    this.valElev = document.getElementById('val-elev');
    this.valCurvature = document.getElementById('val-curvature');
    this.valCentripetal = document.getElementById('val-centripetal');
    this.valKE = document.getElementById('val-ke');
    this.valEnergy = document.getElementById('val-energy');

    // Physics Laws & Grip Limits
    this.valPhysicsStatus = document.getElementById('val-physics-status');
    this.valTractionRatio = document.getElementById('val-traction-ratio');
    this.valDemandedForce = document.getElementById('val-demanded-force');
    this.valMaxGrip = document.getElementById('val-max-grip');
    this.valGearRpm = document.getElementById('val-gear-rpm');
    this.valTireContact = document.getElementById('val-tire-contact');
    this.valLineOffset = document.getElementById('val-line-offset');

    // Performance
    this.valBodies = document.getElementById('val-bodies');
    this.valSubsteps = document.getElementById('val-substeps');
    this.valDrawCalls = document.getElementById('val-drawcalls');

    // Target Speed Slider
    this.sliderTargetSpeed = document.getElementById('slider-target-speed');
    this.txtTargetSpeed = document.getElementById('txt-target-speed');

    // Controls
    this.sliderFriction = document.getElementById('slider-friction');
    this.txtFriction = document.getElementById('txt-friction');

    this.sliderTimescale = document.getElementById('slider-timescale');
    this.txtTimescale = document.getElementById('txt-timescale');

    // Vehicle Config
    this.btnVehF1 = document.getElementById('btn-veh-f1');
    this.btnVehSphere = document.getElementById('btn-veh-sphere');

    // Compounds
    this.btnCompoundSoft = document.getElementById('btn-compound-soft');
    this.btnCompoundMed = document.getElementById('btn-compound-med');
    this.btnCompoundHard = document.getElementById('btn-compound-hard');

    // Actions
    this.btnSmartBraking = document.getElementById('btn-smart-braking');
    this.btnAutoAccelerate = document.getElementById('btn-auto-accelerate');
    this.btnImpulse = document.getElementById('btn-impulse');
    this.btnReset = document.getElementById('btn-reset');
    this.btnToggleLine = document.getElementById('btn-toggle-line');
    this.btnSpawn10 = document.getElementById('btn-spawn-10');

    // Camera & Toggles
    this.btnCamFollow = document.getElementById('btn-cam-follow');
    this.btnCamOrbit = document.getElementById('btn-cam-orbit');
    this.btnToggleVectors = document.getElementById('btn-toggle-vectors');
    this.btnToggleWireframe = document.getElementById('btn-toggle-wireframe');
  }

  bindEvents() {
    // Target Speed Slider (controls if laws of physics hold or fail!)
    this.sliderTargetSpeed?.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      if (this.txtTargetSpeed) this.txtTargetSpeed.textContent = Math.round(val);
      this.app.setTargetSpeedKmh(val);
    });

    // Friction Scale Slider
    this.sliderFriction?.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      if (this.txtFriction) this.txtFriction.textContent = val.toFixed(2);
      for (const b of this.physics.bodies) {
        b.friction = val;
      }
    });

    // Time Scale Slider
    this.sliderTimescale?.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      if (this.txtTimescale) this.txtTimescale.textContent = val.toFixed(2);
      this.physics.timeScale = val;
    });

    // Vehicle Selector
    this.btnVehF1?.addEventListener('click', () => {
      this.app.switchVehicle('f1');
      this.btnVehF1.classList.add('active-toggle');
      this.btnVehSphere.classList.remove('active-toggle');
    });

    this.btnVehSphere?.addEventListener('click', () => {
      this.app.switchVehicle('sphere');
      this.btnVehSphere.classList.add('active-toggle');
      this.btnVehF1.classList.remove('active-toggle');
    });

    // Compounds
    const setCompoundBtn = (btn, key) => {
      this.btnCompoundSoft.classList.remove('active-toggle');
      this.btnCompoundMed.classList.remove('active-toggle');
      this.btnCompoundHard.classList.remove('active-toggle');
      btn.classList.add('active-toggle');
      this.app.setTireCompound(key);
    };

    this.btnCompoundSoft?.addEventListener('click', () => setCompoundBtn(this.btnCompoundSoft, 'SOFT'));
    this.btnCompoundMed?.addEventListener('click', () => setCompoundBtn(this.btnCompoundMed, 'MEDIUM'));
    this.btnCompoundHard?.addEventListener('click', () => setCompoundBtn(this.btnCompoundHard, 'HARD'));

    // Actions
    this.btnSmartBraking?.addEventListener('click', () => this.app.toggleSmartBraking());
    this.btnAutoAccelerate?.addEventListener('click', () => this.app.toggleAutoAccelerate());
    this.btnImpulse?.addEventListener('click', () => this.app.applyBoostImpulse());
    this.btnReset?.addEventListener('click', () => this.app.resetLeadBody());
    this.btnToggleLine?.addEventListener('click', () => this.app.toggleInvisibleLine());
    this.btnSpawn10?.addEventListener('click', () => this.app.spawnBodies(10));

    // Camera Toggles
    this.btnCamFollow?.addEventListener('click', () => {
      this.app.setCameraMode('follow');
      this.btnCamFollow.classList.add('active-toggle');
      this.btnCamOrbit.classList.remove('active-toggle');
    });

    this.btnCamOrbit?.addEventListener('click', () => {
      this.app.setCameraMode('orbit');
      this.btnCamOrbit.classList.add('active-toggle');
      this.btnCamFollow.classList.remove('active-toggle');
    });

    // Vector Toggle
    this.btnToggleVectors?.addEventListener('click', () => {
      const visible = !this.app.vectorsVisible;
      this.app.setVectorsVisible(visible);
      this.btnToggleVectors.classList.toggle('active-toggle', visible);
      this.btnToggleVectors.textContent = visible ? 'VECTORS: ON' : 'VECTORS: OFF';
    });

    // Wireframe Toggle
    this.btnToggleWireframe?.addEventListener('click', () => {
      const enabled = !this.app.wireframeEnabled;
      this.app.setWireframe(enabled);
      this.btnToggleWireframe.classList.toggle('active-toggle', enabled);
      this.btnToggleWireframe.textContent = enabled ? 'WIREFRAME: ON' : 'WIREFRAME: OFF';
    });

    // Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') {
        e.preventDefault();
        this.app.applyBoostImpulse();
      } else if (e.code === 'KeyA') {
        this.app.toggleAutoAccelerate();
      } else if (e.code === 'KeyB') {
        this.app.toggleSmartBraking();
      } else if (e.code === 'KeyL') {
        this.app.toggleInvisibleLine();
      } else if (e.code === 'KeyR') {
        this.app.resetLeadBody();
      } else if (e.code === 'KeyC') {
        this.app.setCameraMode(this.app.cameraMode === 'follow' ? 'orbit' : 'follow');
        this.btnCamFollow.classList.toggle('active-toggle', this.app.cameraMode === 'follow');
        this.btnCamOrbit.classList.toggle('active-toggle', this.app.cameraMode === 'orbit');
      }
    });
  }

  update(fps, leadBody, drawCalls) {
    if (this.fpsDisplay) this.fpsDisplay.textContent = `${fps.toFixed(1)} FPS`;
    if (this.stepTimeDisplay) {
      const stepTime = this.physics.metrics.stepTimeMs;
      this.stepTimeDisplay.textContent = `${stepTime.toFixed(2)} ms`;
    }

    if (leadBody) {
      const speed = leadBody.velocity.length();
      if (this.valVel) this.valVel.textContent = `${speed.toFixed(2)} m/s (${(speed * 3.6).toFixed(1)} km/h)`;
      if (this.valGForce) this.valGForce.textContent = `${leadBody.gForce.toFixed(2)} G`;
      if (this.valCentripetal) this.valCentripetal.textContent = `${leadBody.centripetalAccel.toFixed(2)} m/s²`;
      if (this.valKE) this.valKE.textContent = `${((leadBody.kineticEnergy || 0) / 1000).toFixed(2)} kJ`;
      if (this.valEnergy) this.valEnergy.textContent = `${((leadBody.totalEnergy || 0) / 1000).toFixed(2)} kJ`;

      // F1 Suspension & Physics Failure Diagnostics
      if (leadBody.suspension) {
        const status = leadBody.suspension.physicsStatus;
        if (this.valCurvature) {
          const kappa = status.curvature || 0;
          const rCurv = status.radiusOfCurvature;
          const rText = (!rCurv || rCurv > 999) ? '∞' : `${Math.round(rCurv)}m`;
          this.valCurvature.textContent = `κ = ${kappa.toFixed(4)} (R = ${rText})`;
        }

        if (this.valPhysicsStatus) {
          if (status.isCrashed) {
            this.valPhysicsStatus.textContent = `💥 CRASHED @ ${Math.round(status.crashSpeedKmh)} km/h!`;
            this.valPhysicsStatus.style.color = '#ff4757';
          } else if (status.isOffTrack) {
            this.valPhysicsStatus.textContent = '🚨 OFF TRACK (KERBS/BARRIER)';
            this.valPhysicsStatus.style.color = '#ffa502';
          } else if (status.isViolated) {
            this.valPhysicsStatus.textContent = '⚠️ SLIP (TRACTION FAILURE)';
            this.valPhysicsStatus.style.color = '#ff6b6b';
          } else {
            this.valPhysicsStatus.textContent = 'VALID (ALIGNED ON LINE)';
            this.valPhysicsStatus.style.color = '#f0f1f3';
          }
        }

        if (this.valTractionRatio) {
          const ratio = status.tractionRatio || 0;
          if (status.isCrashed) {
            this.valTractionRatio.textContent = '💥 IMPACT (OFF TRACK)';
            this.valTractionRatio.style.color = '#ff4757';
          } else {
            this.valTractionRatio.textContent = `${ratio.toFixed(2)}x ${ratio > 1.0 ? '[OVER LIMIT - SLIPPING]' : '[GRIP SAFE]'}`;
            this.valTractionRatio.style.color = ratio > 1.0 ? '#ff6b6b' : '#f0f1f3';
          }
        }

        if (this.valDemandedForce) {
          this.valDemandedForce.textContent = `${Math.round(status.requiredForceN).toLocaleString()} N`;
        }
        if (this.valMaxGrip) {
          this.valMaxGrip.textContent = `${Math.round(status.maxGripForceN).toLocaleString()} N`;
        }
        if (this.valLineOffset) {
          const off = status.lateralOffsetM || 0;
          this.valLineOffset.textContent = `${off >= 0 ? '+' : ''}${off.toFixed(2)} m`;
        }

        if (this.valGearRpm) {
          const rpm = Math.round(leadBody.suspension.engineRpm);
          this.valGearRpm.textContent = `G${leadBody.suspension.currentGear} // ${rpm.toLocaleString()} RPM`;
        }
        if (this.valTireContact) {
          this.valTireContact.textContent = `4 FLUSH (0.0mm)`;
        }
      }
    }

    if (this.valBodies) this.valBodies.textContent = this.physics.metrics.bodyCount;
    if (this.valSubsteps) this.valSubsteps.textContent = `${this.physics.subSteps} (${this.physics.metrics.physicsHz}Hz)`;
    if (this.valDrawCalls && drawCalls !== undefined) this.valDrawCalls.textContent = drawCalls;
  }
}
