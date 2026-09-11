/* aiPipeline.js — the parallel AI lane.

   Runs independently of the deterministic reconstruction (v1.html's own
   photos → silhouettes → marching cubes pipeline, and the Maths Room's plain
   coordinate mapping of that result). This lane instead asks a frontier model
   to look at the same six photos and decide for itself what shape the object
   has — expressed as a SMALL set of parametric primitives, not a giant list
   of coordinates.

   Why parameters instead of raw points: a sphere is 4 numbers (center +
   radius) but contains infinite points. Asking a language model to type out
   thousands of [x,y,z] triples burns huge amounts of output tokens and LLMs
   drift/truncate over long numeric lists. Asking for a handful of primitive
   shapes costs a few hundred tokens even for a fairly complex object. From
   that tiny recipe, pointcloud.js expands it into as many surface points as
   you want — entirely locally, zero further tokens, pure arithmetic
   (marching cubes over the recipe's own signed-distance field).

   No API key, no network call here: for the hackathon demo this step is
   manual — copy the prompt, run it in whichever frontier model, paste the
   recipe JSON reply back in, and the point cloud is generated on this page. */
import { normalizeRecipe } from './recipe.js';

export function buildFrontierPrompt() {
  return `You are a precise 3D modelling assistant. You are looking at six orthographic photos of ONE physical object: front, back, left side, right side, top, and bottom — all at the same scale, all centred in frame.

Your job: identify the object, then rebuild it as a small set of simple 3D shapes ("parts") placed in a shared coordinate system. Do NOT try to list individual surface points or coordinates one by one — describe the object's STRUCTURE compactly using the primitive shapes below, and be as accurate as you can about their sizes, positions and proportions. A separate program will turn your compact description into a dense point cloud automatically.

COORDINATE SYSTEM (use exactly this):
- The object sits inside a cube from -0.5 to +0.5 on every axis, centred at 0,0,0.
- +Y is up. +Z points out of the FRONT of the object, toward the camera in the "front" photo. +X is to the RIGHT in the "front" photo.
- RIGHT photo: the front (+Z) is on the left of the image. LEFT photo: the front is on the right.
- TOP photo: the front is at the bottom of the image, +X to the right. BOTTOM photo: the front is at the top, +X to the right.
- Scale: the object's longest dimension measures about 0.9. Measure every other size in proportion, using the photos like a ruler. All photos share one scale.

SHAPES (each part uses exactly one):
- "ellipsoid": center [x,y,z], size [width X, height Y, depth Z] as full extents. Spheres, rounded bodies, noses, domes, canopies, heads.
- "box": center, size [X,Y,Z] full extents, rounding 0..1 (0 sharp corners, 1 fully rounded). Blocky parts.
- "cylinder": center (middle of its length), direction (which way its END points: "+x","-x","+y","-y","+z","-z"), length, diameter, taper (end radius divided by start radius: 1 straight tube, 0 sharp cone, 0.5 truncated cone). Tubes, cones, wheels, engines, nozzles, legs.
- "capsule": center, direction, length (total, including the rounded ends), diameter. Fuselages, pills, rounded rods, arms.
- "plate": a flat, possibly swept and tapered panel: wing, fin, tail, blade, propeller. center = the MIDDLE OF ITS ROOT EDGE (where it attaches). direction = which way it extends from the root ("+x" right wing, "-x" left wing, "+y" upright fin). span = how far it extends. root_chord = front-to-back length at the root. tip_chord = front-to-back length at the tip (0 for a pointed tip). thickness. sweep = how far the middle of the tip sits behind (toward -Z) the middle of the root; negative means swept forward.

OTHER FIELDS:
- mirror: true adds a copy reflected to the other side (x becomes -x). Use it for every left/right pair (wings, wheels, engines, ears, legs) and describe only the +X one.
- operation: "subtract" carves the part out of everything else (holes, intakes, cavities visible in the photos). Default "add".

RULES:
- Use between 1 and 30 parts. Fewer, well-proportioned parts beat many sloppy ones.
- Every part stays inside the cube. Keep it symmetric when the object is symmetric.
- Round things must be ellipsoids, cylinders or capsules, never boxes.

Output ONLY this JSON, nothing else, no explanation, no markdown fence:
{
  "object_name": "short name",
  "parts": [
    { "name": "...", "shape": "ellipsoid|box|cylinder|capsule|plate", "center": [x,y,z], "size": [x,y,z], "direction": "+z", "length": 0, "diameter": 0, "taper": 1, "span": 0, "root_chord": 0, "tip_chord": 0, "thickness": 0, "sweep": 0, "rounding": 0, "mirror": false, "operation": "add" }
  ]
}
Only include the fields each shape actually uses.`;
}

// Parses the AI's compact recipe. The dense point cloud is generated
// separately (see pointcloud.js's recipeToPointCloud) — deliberately kept out
// of this function so parsing a few hundred tokens of JSON stays instant,
// and the (slightly heavier) marching-cubes expansion is its own explicit step.
export function parseAIRecipe(raw) {
  let text = String(raw || '').trim();
  if (!text) throw new Error('Paste the AI\'s JSON reply first.');
  if (text.startsWith('```')) text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return normalizeRecipe(text);
}
