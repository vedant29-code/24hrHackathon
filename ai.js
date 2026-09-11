/* ai.js — photo analysis, prompt generation, and shape reading. */

const CORE_VIEWS = [
  ['front',  'FRONT',  'Front view. The camera is level with the object, looking straight at its front face. The front of the object faces the camera dead-on.'],
  ['right',  'RIGHT',  'Right-side view at exactly 90 degrees from the front. The camera is level. The object\'s front points to the LEFT edge of the image.'],
  ['back',   'BACK',   'Rear view. The camera is level, looking straight at the back. The back faces the camera.'],
  ['left',   'LEFT',   'Left-side view at exactly 90 degrees. The camera is level. The object\'s front points to the RIGHT edge of the image.'],
  ['top',    'TOP',    'Top-down view. The camera is directly above, looking straight down. The object\'s front points toward the BOTTOM of the image.'],
  ['bottom', 'BOTTOM', 'Bottom-up view. The camera is directly below, looking straight up. The object\'s front points toward the TOP of the image.'],
];

const EXTRA_VIEWS = [
  ['front-right', 'FRONT-RIGHT', 'Three-quarter front-right view at 45 degrees between front and right, camera slightly above eye level (about 30 degrees elevation). Shows both the front face and the right side.'],
  ['back-right',  'BACK-RIGHT',  'Three-quarter back-right view at 45 degrees between right and back, camera slightly above eye level (about 30 degrees elevation). Shows both the right side and the back.'],
  ['back-left',   'BACK-LEFT',   'Three-quarter back-left view at 45 degrees between back and left, camera slightly above eye level (about 30 degrees elevation). Shows both the back and the left side.'],
  ['front-left',  'FRONT-LEFT',  'Three-quarter front-left view at 45 degrees between left and front, camera slightly above eye level (about 30 degrees elevation). Shows both the left side and the front face.'],
];

const PHOTO_RULES = `

MANDATORY RENDERING RULES — every rule removes a guess the reconstruction algorithm would otherwise have to make. Follow ALL of them exactly:

PROJECTION:
- Strict orthographic projection. Zero perspective distortion, zero lens distortion, zero foreshortening. Every parallel line in reality must be parallel in the image. This is the single most important rule — perspective makes every measurement wrong.

BACKGROUND:
- Fully transparent background, alpha 0. No fill, no floor, no ground, nothing rendered but the wireframe lines themselves.
- No shadow, no reflection, no ambient occlusion, no gradient, no vignette — nothing but line strokes on empty transparent space.

STYLE — WIREFRAME TECHNICAL DRAWING, NOT A PHOTO:
- Render this as a pure wireframe / technical line drawing, like a CAD export or an engineering blueprint. No shading, no fill, no color, no material, no lighting.
- Draw EVERY edge and structural line of the object as a thin, high-contrast dark stroke (black or dark grey) on the transparent background.
- Show hidden edges — lines that would be behind the visible surface from this angle — as DASHED strokes, exactly like a technical drawing convention. This is critical: dashed hidden lines are what let the reconstruction understand depth and interior structure from a single view, instead of only ever seeing the outer silhouette.
- Every distinct part's boundary must be a closed loop of lines. Show construction edges, panel lines, seams, and fold lines — anything that defines the 3D form — not just the outer outline.
- Mark vertices (where 3 or more edges meet) as small open circles.
- Uniform line thickness across the entire drawing and across every view, so scale reads consistently.
- This is a structural diagram, not an artistic rendering. No artistic interpretation, no dramatic angles, no stylization.

WHY THIS MATTERS — THE STRUCTURE-FIRST RULE:
- A silhouette photo only tells the reconstruction algorithm the outer boundary of the object from that angle — everything behind that boundary is a guess. A wireframe with hidden lines tells it the actual 3D topology directly: where every edge is, how parts connect, what's behind what. There should be nothing left to guess.

FRAMING AND SCALE:
- The entire wireframe must be visible in every image, with a clear transparent margin on all four sides.
- The object's longest visible dimension fills approximately 80% of the image height or width (whichever is larger for that view).
- CRITICAL: Exactly the same camera distance and scale across ALL views. If the object is 400 pixels tall in the front view, it must be 400 pixels tall in the side view too. The algorithm assumes all views share one scale — if they don't, the shape warps.
- The object is centered in the frame in every view.

CONSISTENCY:
- This is ONE object rendered multiple times, not different objects. Every view must show the IDENTICAL structure — identical edges, identical proportions, identical topology, identical vertex positions relative to the object.
- No artistic interpretation. This is a technical reference drawing, like a blueprint.

FORMAT:
- Square 1:1 aspect ratio, 1024×1024 pixels, PNG with a genuine alpha channel (not a white or checkered background standing in for transparency).
- No text, no labels, no dimension annotations, no watermarks, no other objects in the scene.
- Clean, sharp, anti-aliased strokes. No motion blur, no depth of field blur.`;

export const ANALYZE_INSTRUCTION = `You are looking at a photograph of an object. Your job is to describe it precisely so that an image generator can recreate it from any angle.

Describe:
1. object_name: a short name (2-5 words)
2. description: a detailed physical description covering:
   - Overall shape and proportions (length vs width vs height ratios)
   - Every distinct part and where it attaches (e.g. "two swept-back wings attached at the rear third of the body, angled 35 degrees back from perpendicular")
   - All colors with approximate hex codes (e.g. "dark charcoal grey #3B3E44 on the main body")
   - Surface textures and finishes (matte, brushed metal, rubber, etc.)
   - Any markings, logos, panel lines, seams, vents, openings
   - Symmetry: is it left-right symmetric? top-bottom?
   - Any thin or protruding parts (antennas, wires, landing gear, handles)
3. key_features: list of the most distinctive visual features that must appear in every generated view

Be extremely specific about sizes relative to the whole object. "The wingspan is about 1.5 times the body length" is useful. "It has wings" is not.

Output only the JSON object.`;

export const ANALYZE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    object_name: { type: 'STRING' },
    description: { type: 'STRING' },
    key_features: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['object_name', 'description', 'key_features'],
};

export function photoPrompts(analysis, includeExtras) {
  const views = includeExtras ? [...CORE_VIEWS, ...EXTRA_VIEWS] : CORE_VIEWS;
  const isObj = typeof analysis === 'object' && analysis !== null;
  const name = isObj ? analysis.object_name : String(analysis);
  const desc = isObj ? analysis.description : '';
  const subject = desc ? `A single ${name}. ${desc}` : `A single ${name}.`;
  return views.map(([key, label, viewDesc]) => ({
    key, label,
    text: `${subject}\n\n${viewDesc}\n${PHOTO_RULES}`,
  }));
}

export function aiInstruction(analysis) {
  const hint = analysis ? `The user says the object is: ${analysis.object_name}. ${analysis.description}\n\n` : '';
  return `You are a precise 3D modelling assistant. You will receive orthographic WIREFRAME TECHNICAL DRAWINGS of ONE object on a transparent background — every edge drawn as a line, hidden edges dashed. Read the structural lines directly: they show you the real topology, not just an outline, so use the dashed hidden edges to understand depth and interior structure that a silhouette alone could never reveal.

${hint}Your job: identify the object from its wireframe structure, then rebuild it as a small set of simple 3D shapes ("parts") placed in a coordinate system. Another program will draw your parts and then fine-tune every number against the drawings' edges, so correct shapes, proportions and placement matter more than tiny details.

COORDINATE SYSTEM (use exactly this):
- The object sits inside a cube from -0.5 to +0.5 on every axis, centred at 0,0,0.
- +Y is up. +Z points out of the FRONT of the object, toward the FRONT camera. +X is to the RIGHT in the FRONT photo.
- RIGHT photo: the front (+Z) is on the left of the image. LEFT photo: the front is on the right.
- TOP photo: the front is at the bottom of the image, +X to the right. BOTTOM photo: the front is at the top, +X to the right.
- Diagonal views (FRONT-RIGHT, BACK-RIGHT, BACK-LEFT, FRONT-LEFT) are at 45° between the two named cardinal directions, with slight elevation.
- Scale: the object's longest dimension measures about 0.9. Measure every other size in proportion, using the photos like a ruler. All photos share one scale.

SHAPES (each part uses exactly one):
- "ellipsoid": center [x,y,z], size [width X, height Y, depth Z] as full extents. Spheres, rounded bodies, noses, domes, canopies, heads.
- "box": center, size [X,Y,Z] full extents, rounding 0..1 (0 sharp corners, 1 fully rounded). Blocky parts.
- "cylinder": center (middle of its length), direction (which way its END points: "+x","-x","+y","-y","+z","-z"), length, diameter, taper (end radius divided by start radius: 1 straight tube, 0 sharp cone, 0.5 truncated cone). Tubes, cones, wheels (short cylinder along x), engines, nozzles, legs.
- "capsule": center, direction, length (total, including the rounded ends), diameter. Fuselages, pills, rounded rods, arms.
- "plate": a flat, possibly swept and tapered panel: wing, fin, tail, blade, propeller. center = the MIDDLE OF ITS ROOT EDGE (where it attaches). direction = which way it extends from the root ("+x" right wing, "-x" left wing, "+y" upright fin). span = how far it extends. root_chord = front-to-back length at the root. tip_chord = front-to-back length at the tip (0 for a pointed tip). thickness. sweep = how far the middle of the tip sits behind (toward -Z) the middle of the root; negative means swept forward.

OTHER FIELDS:
- mirror: true adds a copy reflected to the other side (x becomes -x). Use it for every left/right pair (wings, wheels, engines, ears, legs) and describe only the +X one.
- operation: "subtract" carves the part out of everything else (holes, intakes, cup interiors, cavities visible in the photos). Default "add".

CONSTRAINTS — relationships the photos alone can't guarantee:
Also return a "constraints" array naming structural relationships between parts BY NAME (use the exact "name" you gave each part). These get enforced mathematically during fitting, on top of matching the wireframes:
- { "type": "equal_length", "parts": ["front-left leg", "front-right leg", "back-left leg", "back-right leg"] } — parts that should measure the same even though a mirror pair alone wouldn't cover all of them (e.g. four legs, four propellers).
- { "type": "symmetric", "parts": ["left antenna", "right antenna"] } — parts that should mirror each other but aren't declared with mirror:true (e.g. independently placed but matching features).
- { "type": "planar", "parts": ["wheel 1", "wheel 2", "wheel 3", "wheel 4"] } — part centers that should lie on one flat plane (e.g. all wheels touching the ground, all rotor tips in one disc).
Only include a constraint when it's a real structural fact about the object. Omit "constraints" entirely if none apply.

RULES:
- Use between 1 and 30 parts. Fewer, well-proportioned parts beat many sloppy ones.
- Parts may overlap; overlapping parts are blended smoothly.
- Every part stays inside the cube.
- Keep it symmetric when the object is symmetric.
- Round things must be ellipsoids, cylinders or capsules, never boxes.
- Output only the JSON object described by the schema.`;
}

const STR = { type: 'STRING' }, NUM = { type: 'NUMBER' }, VEC = { type: 'ARRAY', items: NUM };
export const RECIPE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    object_name: STR,
    summary: STR,
    parts: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: STR,
          shape: { type: 'STRING', enum: ['ellipsoid', 'box', 'cylinder', 'capsule', 'plate'] },
          operation: { type: 'STRING', enum: ['add', 'subtract'] },
          center: VEC, size: VEC,
          direction: { type: 'STRING', enum: ['+x', '-x', '+y', '-y', '+z', '-z'] },
          length: NUM, diameter: NUM, taper: NUM,
          span: NUM, root_chord: NUM, tip_chord: NUM, thickness: NUM, sweep: NUM,
          rounding: NUM,
          mirror: { type: 'BOOLEAN' },
        },
        required: ['name', 'shape', 'center'],
      },
    },
    constraints: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          type: { type: 'STRING', enum: ['equal_length', 'symmetric', 'planar'] },
          parts: { type: 'ARRAY', items: STR },
        },
        required: ['type', 'parts'],
      },
    },
  },
  required: ['object_name', 'parts'],
};

function toJsonSchema(s) {
  if (Array.isArray(s)) return s.map(toJsonSchema);
  if (!s || typeof s !== 'object') return s;
  const out = {};
  for (const [k, v] of Object.entries(s)) out[k] = k === 'type' ? String(v).toLowerCase() : toJsonSchema(v);
  return out;
}

const b64 = (dataUrl) => dataUrl.slice(dataUrl.indexOf(',') + 1);

async function geminiCall({ apiKey, model, instruction, images, schema }) {
  const parts = [{ text: instruction }];
  if (images) {
    for (const img of images) {
      parts.push({ text: `${img.label} photo:` });
      parts.push({ inline_data: { mime_type: 'image/jpeg', data: b64(img.dataUrl) } });
    }
  }
  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature: 0.2 },
  };
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey }, body: JSON.stringify(body) });
  if (!res.ok) {
    const errText = await res.text();
    if (res.status === 404 && errText.includes('no longer available')) {
      const m = errText.match(/use (models\/[\w.-]+)/);
      throw new Error(`Model "${model}" is retired. ${m ? `Try "${m[1].replace('models/','')}" instead.` : 'Check aistudio.google.com for the current model name.'}`);
    }
    throw new Error(`Gemini ${res.status}: ${errText.slice(0, 300)}`);
  }
  const data = await res.json();
  const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  if (!text) throw new Error('Gemini returned no answer' +
    (data.promptFeedback?.blockReason ? ` (${data.promptFeedback.blockReason})` : ''));
  let cleanText = text.trim();
  if (cleanText.startsWith('```')) {
    cleanText = cleanText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  }
  return JSON.parse(cleanText);
}

export async function analyzePhoto({ apiKey, model, imageDataUrl }) {
  return geminiCall({
    apiKey, model,
    instruction: ANALYZE_INSTRUCTION,
    images: [{ label: 'Object', dataUrl: imageDataUrl }],
    schema: ANALYZE_SCHEMA,
  });
}

export async function readWithGemini({ apiKey, model, instruction, images }) {
  return geminiCall({ apiKey, model, instruction, images, schema: RECIPE_SCHEMA });
}

export async function readWithOllama({ host, model, instruction, images }) {
  const res = await fetch(`${host.replace(/\/$/, '')}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model, stream: false,
      format: toJsonSchema(RECIPE_SCHEMA),
      options: { temperature: 0.2 },
      messages: [{
        role: 'user',
        content: `${instruction}\n\nThe images are attached in this order: ${images.map((i) => i.label).join(', ')}.`,
        images: images.map((i) => b64(i.dataUrl)),
      }],
    }),
  });
  if (!res.ok) throw new Error(`Ollama said ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  let content = data.message?.content || '{}';
  content = content.trim();
  if (content.startsWith('```')) {
    content = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  }
  return JSON.parse(content);
}
