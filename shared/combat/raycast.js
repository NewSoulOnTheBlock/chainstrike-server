// Hitscan math shared by the server (authoritative hit validation) and the unit
// test. Pure functions, no engine types. Hitboxes are axis-aligned boxes built
// from the player-local HITBOX table; raycast uses the slab method.
import { HITBOX } from '../config/weapons.js';

// World-space hitboxes for a player standing at sample {x,y,z} (feet at y).
export function playerHitboxes(s) {
  const out = [];
  for (const region of ['head', 'body', 'legs']) {
    const h = HITBOX[region];
    out.push({ region, cx: s.x, cy: s.y + h.cy, cz: s.z, hx: h.hx, hy: h.hy, hz: h.hz });
  }
  return out;
}

// Ray (origin o, unit dir d) vs AABB box. Returns hit distance t >= 0 or -1.
export function rayAABB(ox, oy, oz, dx, dy, dz, b) {
  let tmin = 0, tmax = Infinity;
  const axes = [
    [ox, dx, b.cx, b.hx],
    [oy, dy, b.cy, b.hy],
    [oz, dz, b.cz, b.hz],
  ];
  for (const [o, d, c, h] of axes) {
    if (Math.abs(d) < 1e-8) {
      if (o < c - h || o > c + h) return -1; // parallel & outside slab
    } else {
      let t1 = (c - h - o) / d;
      let t2 = (c + h - o) / d;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return -1;
    }
  }
  return tmin;
}

// Nearest hitbox of a single target along the ray. Returns { t, region } or null.
export function raycastPlayer(ox, oy, oz, dx, dy, dz, sample) {
  let best = null;
  for (const b of playerHitboxes(sample)) {
    const t = rayAABB(ox, oy, oz, dx, dy, dz, b);
    if (t >= 0 && (!best || t < best.t)) best = { t, region: b.region };
  }
  return best;
}

// Aim direction from view yaw/pitch. Matches the movement forward convention
// (W at yaw a -> (sin a, -cos a)) and the client camera (YXZ, rot=(pitch,-yaw,0)).
export function aimDir(yaw, pitch) {
  const cp = Math.cos(pitch);
  return { x: cp * Math.sin(yaw), y: Math.sin(pitch), z: -cp * Math.cos(yaw) };
}
