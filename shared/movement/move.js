// Deterministic movement step shared by client prediction and server authority.
// Pure function of (state, input, dt) — no globals, no engine types — so the
// client and server produce bit-identical results for the same inputs, which is
// what makes prediction + reconciliation converge.
//
// state: { x, y, z, vx, vy, vz, grounded }
// input: { move:{x,z} (-1..1, local to yaw), yaw, buttons (BTN bitmask) }
import { WORLD, MOVE } from '../config/world.js';
import { BTN } from '../net/protocol.js';
import { MAP, COLLIDERS, RAMPS } from '../config/mapColliders.js';

const STEP_HEIGHT = 0.55;   // max ledge the controller auto-steps onto

// Ride walkable ramp slopes: if the player is over a ramp footprint and the
// interpolated surface is within stepping range, snap them onto it so they
// flow smoothly up/down. Shared by client prediction and server authority.
function resolveRamps(s) {
  const PR = WORLD.playerRadius;
  for (let i = 0; i < RAMPS.length; i++) {
    const r = RAMPS[i];
    if (s.x <= r.minX - PR || s.x >= r.maxX + PR) continue;
    if (s.z <= r.minZ - PR || s.z >= r.maxZ + PR) continue;
    let t = r.axis === 'x' ? (s.x - r.minX) / (r.maxX - r.minX) : (s.z - r.minZ) / (r.maxZ - r.minZ);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const surf = r.y0 + t * (r.y1 - r.y0);
    if (surf - s.y <= STEP_HEIGHT && surf - s.y > -0.6 && s.vy <= 0.001) {
      s.y = surf; s.vy = 0; s.grounded = true;
    }
  }
}

// Resolve the player capsule (approximated as a vertical AABB of half-width
// playerRadius and height playerHeight) against the solid map colliders.
// Mutates s. Sets s.grounded when supported from below. Shared by client
// prediction and server authority so both agree on collisions.
function resolveColliders(s) {
  const PR = WORLD.playerRadius;
  const PH = WORLD.playerHeight;
  for (let i = 0; i < COLLIDERS.length; i++) {
    const c = COLLIDERS[i];
    const pminX = s.x - PR, pmaxX = s.x + PR;
    const pminZ = s.z - PR, pmaxZ = s.z + PR;
    const pminY = s.y, pmaxY = s.y + PH;
    if (pmaxX <= c.minX || pminX >= c.maxX) continue;
    if (pmaxZ <= c.minZ || pminZ >= c.maxZ) continue;
    if (pmaxY <= c.minY || pminY >= c.maxY) continue;

    // step / stand-on-top: feet are at or just below the box top -> mount it
    if (c.maxY - s.y <= STEP_HEIGHT && c.maxY - s.y > -0.001 && s.vy <= 0.001) {
      s.y = c.maxY; s.vy = 0; s.grounded = true; continue;
    }

    // otherwise push out along the least-penetrated horizontal axis (a wall)
    const penX = Math.min(pmaxX - c.minX, c.maxX - pminX);
    const penZ = Math.min(pmaxZ - c.minZ, c.maxZ - pminZ);
    if (penX <= penZ) {
      s.x += s.x < (c.minX + c.maxX) * 0.5 ? -penX : penX;
      s.vx = 0;
    } else {
      s.z += s.z < (c.minZ + c.maxZ) * 0.5 ? -penZ : penZ;
      s.vz = 0;
    }
  }
}

function accelerate(vx, vz, dirx, dirz, wishSpeed, accel, dt) {
  const curSpeed = vx * dirx + vz * dirz;
  const addSpeed = wishSpeed - curSpeed;
  if (addSpeed <= 0) return [vx, vz];
  let accelSpeed = accel * dt * wishSpeed;
  if (accelSpeed > addSpeed) accelSpeed = addSpeed;
  return [vx + dirx * accelSpeed, vz + dirz * accelSpeed];
}

export function stepMovement(s, input, dt) {
  const btn = input.buttons | 0;
  const crouch = !!(btn & BTN.CROUCH);
  const walk = !!(btn & BTN.WALK);

  // desired move direction rotated into world space by view yaw
  let mx = input.move ? input.move.x : 0;
  let mz = input.move ? input.move.z : 0;
  const len = Math.hypot(mx, mz);
  if (len > 1) { mx /= len; mz /= len; }
  const yaw = input.yaw || 0;
  const cos = Math.cos(yaw), sin = Math.sin(yaw);
  // forward = -z in local space; rotate (mx, mz) by yaw
  const dirx = mx * cos - mz * sin;
  const dirz = mx * sin + mz * cos;
  const dirLen = Math.hypot(dirx, dirz);
  const ndx = dirLen > 0 ? dirx / dirLen : 0;
  const ndz = dirLen > 0 ? dirz / dirLen : 0;

  const wishSpeed = (crouch ? MOVE.crouchSpeed : walk ? MOVE.walkSpeed : MOVE.maxSpeed) * Math.min(1, dirLen);

  if (s.grounded) {
    // friction
    const speed = Math.hypot(s.vx, s.vz);
    if (speed > 0) {
      const drop = speed * MOVE.friction * dt;
      const nspeed = Math.max(0, speed - drop) / speed;
      s.vx *= nspeed; s.vz *= nspeed;
    }
    [s.vx, s.vz] = accelerate(s.vx, s.vz, ndx, ndz, wishSpeed, MOVE.accel, dt);
    if (btn & BTN.JUMP) { s.vy = MOVE.jumpVel; s.grounded = false; }
  } else {
    [s.vx, s.vz] = accelerate(s.vx, s.vz, ndx, ndz, wishSpeed, MOVE.airAccel, dt);
    s.vy -= WORLD.gravity * dt;
  }

  // integrate
  s.x += s.vx * dt;
  s.y += s.vy * dt;
  s.z += s.vz * dt;

  // re-derive ground support each tick (so walking off a ledge falls correctly)
  s.grounded = false;

  // ground plane
  if (s.y <= WORLD.spawnY) { s.y = WORLD.spawnY; s.vy = 0; s.grounded = true; }

  // walkable ramp slopes (smooth up/down)
  resolveRamps(s);

  // solid map cover (crates / pillars / walls) — server-authoritative
  resolveColliders(s);

  // outer arena bounds (map footprint)
  const hx = MAP.halfX, hz = MAP.halfZ;
  if (s.x < -hx) { s.x = -hx; s.vx = 0; }
  if (s.x > hx) { s.x = hx; s.vx = 0; }
  if (s.z < -hz) { s.z = -hz; s.vz = 0; }
  if (s.z > hz) { s.z = hz; s.vz = 0; }

  return s;
}
