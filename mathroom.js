/* mathroom.js — the Math Room: takes the reconstructed 3D model (built purely
   from the six/ten photos, no AI) and represents it numerically. Every point
   on the model's surface is mapped to its own (x, y, z) coordinate, forming a
   structured dataset — the first mathematical representation of the object,
   with nothing interpreted or guessed on top of it. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { meshToPointCloud } from './pointcloud.js';

function rangeOf(points, axis) {
  let lo = Infinity, hi = -Infinity;
  for (const p of points) { lo = Math.min(lo, p[axis]); hi = Math.max(hi, p[axis]); }
  return { lo, hi };
}

function downloadText(text, filename, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

export function openMathRoom(mesh) {
  if (!mesh) return;
  const points = meshToPointCloud(mesh);
  const rx = rangeOf(points, 'x'), ry = rangeOf(points, 'y'), rz = rangeOf(points, 'z');

  const container = document.createElement('div');
  container.style.cssText = 'position:fixed; inset:0; z-index:1000; background:#faf9f6; color:#1a1a18; display:flex; flex-direction:column; font-family:"Inter", sans-serif;';

  const header = document.createElement('div');
  header.style.cssText = 'display:flex; justify-content:space-between; align-items:center; padding:12px 24px; border-bottom:1px solid rgba(26,26,24,0.1);';
  header.innerHTML = `<div style="font-family:'Instrument Serif', serif; font-size:24px; text-transform:uppercase; letter-spacing:0.05em;">The Maths Room</div>
    <button id="mr-close" style="background:none; border:none; font-size:24px; cursor:pointer; color:#1a1a18;">×</button>`;
  container.appendChild(header);

  const main = document.createElement('div');
  main.style.cssText = 'display:grid; grid-template-columns:60% 40%; flex:1; min-height:0;';

  const left = document.createElement('div');
  left.style.cssText = 'position:relative; background:#faf9f6;';
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:100%; height:100%; display:block;';
  left.appendChild(canvas);

  const right = document.createElement('div');
  right.style.cssText = 'padding:24px 32px; overflow-y:auto; border-left:1px solid rgba(26,26,24,0.1); font-size:13px; line-height:1.6;';

  const h = (txt) => `<div style="font-family:'Instrument Serif', serif; font-size:18px; margin:24px 0 12px; font-variant:small-caps;">${txt}</div>`;
  const n = (v) => v.toFixed(4);

  const samplePoints = points.filter((_, i) => i % Math.max(1, Math.floor(points.length / 40)) === 0).slice(0, 40);

  right.innerHTML = `
    ${h('I. The dataset')}
    <div>
      Every point on the reconstructed surface, mapped to its own (x, y, z) coordinate.<br><br>
      Points: <strong>${points.length.toLocaleString()}</strong><br>
      x range: <strong>${n(rx.lo)}</strong> to <strong>${n(rx.hi)}</strong><br>
      y range: <strong>${n(ry.lo)}</strong> to <strong>${n(ry.hi)}</strong><br>
      z range: <strong>${n(rz.lo)}</strong> to <strong>${n(rz.hi)}</strong>
    </div>

    ${h('II. Sample of the mapping')}
    <div style="font-family:ui-monospace, monospace; font-size:10.5px; max-height:260px; overflow-y:auto; border:1px solid rgba(26,26,24,0.1); padding:8px; background:#fff;">
      ${samplePoints.map((p, i) => `(${n(p.x)}, ${n(p.y)}, ${n(p.z)})`).join('<br>')}
    </div>
    <div style="font-size:10.5px; color:#76756f; margin-top:6px;">Showing ${samplePoints.length} of ${points.length.toLocaleString()} points. The full set is in the export.</div>

    ${h('III. Export')}
    <div style="display:flex; gap:10px; margin-top:8px;">
      <button id="mr-export-json" style="padding:8px 16px; background:#1a1a18; color:#fff; border:none; border-radius:4px; cursor:pointer;">Download .json</button>
      <button id="mr-export-csv" style="padding:8px 16px; background:none; color:#1a1a18; border:1px solid rgba(26,26,24,0.2); border-radius:4px; cursor:pointer;">Download .csv</button>
    </div>
  `;
  main.append(left, right);
  container.appendChild(main);
  document.body.appendChild(container);

  /* ---- Three.js: axes + the point cloud itself --------------------------- */
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  const cssRenderer = new CSS2DRenderer();
  cssRenderer.domElement.style.cssText = 'position:absolute; top:0; pointer-events:none;';
  left.appendChild(cssRenderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 10);
  camera.position.set(1.5, 1.2, 1.5);
  camera.lookAt(0, 0, 0);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;

  scene.add(new THREE.AmbientLight(0xffffff, 0.7));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(1, 2, 1);
  scene.add(dirLight);

  const addAxis = (dir, color, label) => {
    const mat = new THREE.LineBasicMaterial({ color });
    const pts = [new THREE.Vector3(), dir.clone().multiplyScalar(0.5)];
    const geom = new THREE.BufferGeometry().setFromPoints(pts);
    scene.add(new THREE.Line(geom, mat));
    for (let i = -4; i <= 4; i++) {
      if (i === 0) continue;
      const tpos = dir.clone().multiplyScalar(i / 10);
      let tpt1 = tpos.clone(), tpt2 = tpos.clone();
      if (dir.x) { tpt1.y += 0.02; tpt2.y -= 0.02; } else { tpt1.x += 0.02; tpt2.x -= 0.02; }
      scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([tpt1, tpt2]), mat));
    }
    const div = document.createElement('div');
    div.textContent = label;
    div.style.cssText = `color:${new THREE.Color(color).getStyle()}; font-family:'Instrument Serif',serif; font-size:16px; font-style:italic; margin-top:-10px; margin-left:10px;`;
    const obj = new CSS2DObject(div);
    obj.position.copy(pts[1]);
    scene.add(obj);
  };
  addAxis(new THREE.Vector3(1, 0, 0), 0x8b2500, 'x');
  addAxis(new THREE.Vector3(0, 1, 0), 0x1a3a5c, 'y');
  addAxis(new THREE.Vector3(0, 0, 1), 0x2d5a3d, 'z');

  const gridH = new THREE.GridHelper(1, 10, 0x2d5a3d, 0x2d5a3d);
  gridH.position.y = -0.5; gridH.material.opacity = 0.15; gridH.material.transparent = true;
  scene.add(gridH);
  const gridXY = new THREE.GridHelper(1, 10, 0x1a3a5c, 0x1a3a5c);
  gridXY.rotation.x = Math.PI / 2; gridXY.position.z = -0.5; gridXY.material.opacity = 0.15; gridXY.material.transparent = true;
  scene.add(gridXY);
  const gridYZ = new THREE.GridHelper(1, 10, 0x8b2500, 0x8b2500);
  gridYZ.rotation.z = Math.PI / 2; gridYZ.position.x = -0.5; gridYZ.material.opacity = 0.15; gridYZ.material.transparent = true;
  scene.add(gridYZ);

  // The dataset, rendered as points — a direct visual of "every point mapped
  // to its coordinate", not a shaded solid.
  const cloudGeom = new THREE.BufferGeometry();
  const posArr = new Float32Array(points.length * 3);
  for (let i = 0; i < points.length; i++) {
    posArr[i*3] = points[i].x; posArr[i*3+1] = points[i].y; posArr[i*3+2] = points[i].z;
  }
  cloudGeom.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
  const cloudMat = new THREE.PointsMaterial({ color: 0x1a1a18, size: 0.004, sizeAttenuation: true });
  scene.add(new THREE.Points(cloudGeom, cloudMat));

  let animId;
  const render = () => {
    const w = left.clientWidth, h = left.clientHeight;
    if (canvas.width !== w || canvas.height !== h) {
      renderer.setSize(w, h, false);
      cssRenderer.setSize(w, h);
      const aspect = w / h, d = 1.2;
      camera.left = -d * aspect; camera.right = d * aspect;
      camera.top = d; camera.bottom = -d;
      camera.updateProjectionMatrix();
    }
    controls.update();
    renderer.render(scene, camera);
    cssRenderer.render(scene, camera);
    animId = requestAnimationFrame(render);
  };
  render();

  document.getElementById('mr-close').onclick = () => { cancelAnimationFrame(animId); container.remove(); };
  document.getElementById('mr-export-json').onclick = () => {
    downloadText(JSON.stringify(points), 'point-coordinates.json', 'application/json');
  };
  document.getElementById('mr-export-csv').onclick = () => {
    const csv = 'x,y,z\n' + points.map((p) => `${p.x},${p.y},${p.z}`).join('\n');
    downloadText(csv, 'point-coordinates.csv', 'text/csv');
  };
}
