// Bullet-vs-world occlusion shared by the server (authoritative hit validation)
// and tests. Bullets test against the BULLET collision layer (solid props,
// walls, cover, thin solids, ceilings) plus ramp wedges, so a shot stops at the
// nearest solid surface instead of passing through it. Pure functions.
import { WORLD_COLLIDERS, RAMP_BOXES } from '../config/worldColliders.js';
import { COLLIDERS } from '../config/mapColliders.js';

// Ray (origin o, unit dir d) vs an axis-aligned box in {min,max} form.
// Returns entry distance t >= 0, or -1 if no hit ahead of the origin.
function rayBoxMinMax(ox, oy, oz, dx, dy, dz, b) {
  let tmin = 0, tmax = Infinity;
  const axes = [
    [ox, dx, b.minX, b.maxX],
    [oy, dy, b.minY, b.maxY],
    [oz, dz, b.minZ, b.maxZ],
  ];
  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-8) {
      if (o < lo || o > hi) return -1;
    } else {
      let t1 = (lo - o) / d, t2 = (hi - o) / d;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return -1;
    }
  }
  return tmin;
}

// Nearest solid-world hit distance along the ray, or Infinity if the shot
// reaches open space. `maxT` caps the search (weapon range). The player-movement
// COLLIDERS (curated walls/cover, incl. building perimeters) are included so the
// authoritative wall set blocks bullets too.
export function raycastWorld(ox, oy, oz, dx, dy, dz, maxT = Infinity) {
  let best = maxT;
  const test = (boxes) => {
    for (let i = 0; i < boxes.length; i++) {
      const t = rayBoxMinMax(ox, oy, oz, dx, dy, dz, boxes[i]);
      if (t >= 0 && t < best) best = t;
    }
  };
  test(WORLD_COLLIDERS);
  test(RAMP_BOXES);
  test(COLLIDERS);
  return best;
}

// True if line-of-sight from (ox,oy,oz) to (tx,ty,tz) is blocked by solid world
// geometry (used for flash LOS / future occlusion checks).
export function worldOccludes(ox, oy, oz, tx, ty, tz) {
  const dx = tx - ox, dy = ty - oy, dz = tz - oz;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 1e-6) return false;
  const t = raycastWorld(ox, oy, oz, dx / dist, dy / dist, dz / dist, dist);
  return t < dist - 1e-3;
}
