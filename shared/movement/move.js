// Deterministic movement step shared by client prediction and server authority.
// Pure function of (state, input, dt) — no globals, no engine types — so the
// client and server produce bit-identical results for the same inputs, which is
// what makes prediction + reconciliation converge.
//
// state: { x, y, z, vx, vy, vz, grounded }
// input: { move:{x,z} (-1..1, local to yaw), yaw, buttons (BTN bitmask) }
import { WORLD, MOVE } from '../config/world.js';
import { BTN } from '../net/protocol.js';

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

  // ground plane
  if (s.y <= WORLD.spawnY) { s.y = WORLD.spawnY; s.vy = 0; s.grounded = true; }

  // arena bounds
  if (s.x < -WORLD.arenaHalfX) { s.x = -WORLD.arenaHalfX; s.vx = 0; }
  if (s.x > WORLD.arenaHalfX) { s.x = WORLD.arenaHalfX; s.vx = 0; }
  if (s.z < -WORLD.arenaHalfZ) { s.z = -WORLD.arenaHalfZ; s.vz = 0; }
  if (s.z > WORLD.arenaHalfZ) { s.z = WORLD.arenaHalfZ; s.vz = 0; }

  return s;
}
