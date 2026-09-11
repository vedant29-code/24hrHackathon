# 🏎️ 24hrHackathon // 3D Voxel F1 Grand Prix Engine & Traction Limits

A high-performance, real-time 3D Voxel Formula 1 vehicle dynamics simulation and custom physics engine built with **Three.js** and vanilla ES modules.

Features an authentic **closed multi-turn F1 Grand Prix Catmull-Rom spline circuit** rendered via **ultra-high-efficiency GPU-instanced voxel geometry (`THREE.InstancedMesh`)** at **Slope = 0 (100% flat at $y = 0.00\text{ m}$)**, a detailed procedural **Voxel F1 race car**, dynamic **Pure Pursuit path tracking**, front/rear tire slip angles with **Pacejka '89 Magic Formula lateral friction**, and realistic **traction-limit barrier crashes** with tumbling **3D voxel debris physics**.

---

## 🌟 Key Features

- **GPU-Instanced Voxel Grand Prix Circuit**:
  - Closed 20-point Catmull-Rom spline with centripetal parameterization (`TrackSpline.js`).
  - Monza / Silverstone inspired layout: Main Straight, Rettifilo chicane, Curva Grande sweeper, Variante della Roggia, Lesmo 1 & 2, Serraglio straight, Ascari complex, back straight, and Parabolica sweeping hairpin.
  - ~12,800 volumetric voxel blocks rendered in **only 4–5 draw calls**: 10 columns of asphalt voxels, stepped FIA red/white kerb voxels, runoff tiles, stacked perimeter Armco barrier blocks, and dashed voxel racing line.
  - 100% flat elevation (Slope = 0) with $0.0\text{ mm}$ road variance.
  - Precomputed 2,400-sample Frenet frame lookup table with arc length $s$, tangent $\mathbf{T}$, normal $\mathbf{N}$, binormal $\mathbf{B}$, and exact curvature $\kappa(s)$.
  - $O(1)$ spatial hash grid for microsecond nearest-point queries.

- **Procedural Voxel F1 Car & Voxel Crash Debris**:
  - Detailed voxel bodywork: stepped nosecone, multi-element front wing, cockpit with 3D halo safety arc, driver helmet block, sculpted sidepods, engine cover shark fin, and dual-plane rear wing.
  - Steerable front voxel wheels & rolling rear voxel wheels.
  - 4-wheel flush ground contact: hub at $y = 0.36\text{ m}$, wheel radius $0.36\text{ m}$, touching the voxel asphalt at $y = 0.00\text{ m}$ ($0.0\text{ mm}$ gap).
  - 3D Tumbling Voxel Debris: 36 instanced carbon chunks & sparking ember cubes that scatter, tumble with 3-axis rotational velocity, and bounce realistically on the asphalt upon barrier collision.

- **Realtime Vehicle Dynamics & Physics Engine**:
  - **Pure Pursuit Steering**: Dynamically calculates front wheel angle $\delta = \arctan(L \cdot \kappa_{\text{target}})$ towards lookahead targets along the center spline line.
  - **Pacejka Magic Formula Tire Model**: Evaluates non-linear lateral force response $F_y = D \sin(C \arctan(B \alpha - E (B \alpha - \arctan(B \alpha))))$ based on dynamic slip angles ($\alpha_f, \alpha_r$).
  - **4-Wheel Flush Ground Contact**: Wheel hub at $y = 0.36\text{ m}$, tire radius $0.36\text{ m}$, resting flush on asphalt ($0.0\text{ mm}$ gap).
  - **Centripetal Traction Limits**:
    $$a_c = v^2 \cdot \kappa(s) = \frac{v^2}{R(s)}, \quad F_{\text{demanded}} = m \cdot v^2 \cdot \kappa(s)$$
    On straights, the car reaches $240\text{--}300+\text{ km/h}$. In tight chicanes and hairpins, excessive speed without braking causes $F_{\text{demanded}} > F_{\text{max}}$, resulting in front tire saturation, off-track excursion across the kerbs, and high-speed barrier crashes with 45-particle spark bursts!

- **Powertrain & Aerodynamics**:
  - 8-speed semi-automatic transmission with dynamic gear selection and realistic V6 turbo-hybrid RPM telemetry.
  - Speed-squared aerodynamic downforce ($F_z = \frac{1}{2} \rho v^2 C_L A$) and aerodynamic drag ($F_d = \frac{1}{2} \rho v^2 C_d A$).
  - Dynamic cornering chassis body roll based on lateral G-force.

- **CAD Monochrome Engineering Aesthetics**:
  - Professional dark studio lighting with soft shadows, technical telemetry overlay, and zero distracting neon colors.
  - Realtime HUD reporting speed, lateral G, elevation, curvature $\kappa$, corner radius $R$, demanded vs max grip force, traction ratio, and draw calls.
  - High performance: $< 0.15\text{ ms}$ physics step time at $240\text{ Hz}$ sub-stepping.

---

## 🎮 Interactive Controls & Shortcuts

| Key / Control | Function |
| :--- | :--- |
| **`[B]`** | **Toggle Race Cruise Mode**: Intelligent cornering deceleration based on upcoming spline curvature $\kappa(s)$. |
| **`[A]`** | **Toggle Attack Mode (100% WOT)**: Wide-open throttle without corner braking to demonstrate overspeed traction limit crashes. |
| **`[SPACE]`** | **Exceed Boost**: Injects $+108\text{ km/h}$ instant turbo impulse to exceed tire grip. |
| **`[R]`** | **Reset to Start**: Instantly teleports vehicle back to start/finish line and clears crash state. |
| **`[L]`** | **Toggle Line**: Shows/hides the center spline dashed racing line. |
| **`[C]`** | **Camera Mode**: Toggles between Onboard Chase Cam and Free Orbit Cam. |
| **`Soft / Med / Hard`** | Switch Pacejka tire compounds ($\mu = 1.85, 1.65, 1.45$). |
| **`Target Speed Slider`** | Adjust straight-line target cruising speed ($80\text{--}360\text{ km/h}$). |
| **`Friction Scale Slider`** | Scale track asphalt friction coefficient ($\mu$). |

---

## 📁 Project Structure

```
├── index.html                   # CAD engineering layout & telemetry HUD
├── package.json                 # Dependencies & scripts (Three.js, Vite)
├── vite.config.js               # Dev server configuration
├── src/
│   ├── main.js                  # Application entry point & render loop
│   ├── style.css                # Dark technical CAD monochrome stylesheet
│   ├── entities/
│   │   └── F1Car.js             # Detailed procedural 3D F1 car mesh & kinematics
│   ├── physics/
│   │   ├── PhysicsEngine.js     # Fixed sub-step physics, pure pursuit & collisions
│   │   ├── F1VehiclePhysics.js  # 8-speed powertrain, smart braking & roll
│   │   ├── TireModel.js         # Pacejka Magic Formula & aerodynamics
│   │   └── RigidBody.js         # Generic rigid body kinematics & impulses
│   ├── track/
│   │   ├── TrackSpline.js       # 20-point Catmull-Rom spline, Frenet LUT & spatial grid
│   │   └── TrackMesh.js         # 16m road ribbon, FIA kerbs, barriers & racing line
│   └── ui/
│       └── TelemetryHUD.js      # DOM telemetry updates & user input handlers
```

---

## 🚀 Getting Started

### Prerequisites
- Node.js (v18 or higher)
- npm

### Installation
```bash
git clone https://github.com/vedant29-code/24hrHackathon.git
cd 24hrHackathon
npm install
```

### Running Locally
```bash
npm run dev
```
Open your browser and navigate to `http://localhost:3000/`.

### Production Build
```bash
npm run build
npm run preview
```

---

## 📜 License
MIT License. Built for the 24-Hour Hackathon.
