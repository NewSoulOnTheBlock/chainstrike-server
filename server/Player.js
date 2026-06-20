// Authoritative server-side player. The server owns every field here; clients
// only ever submit inputs that mutate it through validated simulation.
import { WORLD, SPAWN } from '../shared/config/world.js';

let _slot = 0;

export class Player {
  constructor(id, name, team, ws) {
    this.id = id;
    this.name = (name || 'Player').slice(0, 24);
    this.team = team; // 'A' (attackers) | 'D' (defenders)
    this.ws = ws;

    // kinematic state (authoritative)
    this.x = 0; this.y = WORLD.spawnY; this.z = 0;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.grounded = true;
    this.yaw = 0; this.pitch = 0;

    // gameplay state (authoritative — Phase 4+ fills these in)
    this.hp = 100;
    this.armor = 0;
    this.alive = true;
    this.weapon = 'pistol';
    this.ammo = 12;

    // networking bookkeeping
    this.lastSeq = 0;            // last processed input sequence
    this.lastInputAt = Date.now();
    this.lastSeenAt = Date.now();
    this.clockOffset = null;     // learned (serverNow - clientInputTime) offset
    this.ping = 0;
    this.slot = _slot++;        // stable spawn ordering
  }

  spawn() {
    const z = this.team === 'A' ? SPAWN.attackerZ : SPAWN.defenderZ;
    const lane = (this.slot % 5) - 2; // -2..2 across five slots
    this.x = lane * SPAWN.spread;
    this.y = WORLD.spawnY;
    this.z = z;
    this.vx = this.vy = this.vz = 0;
    this.grounded = true;
    this.hp = 100;
    this.alive = true;
  }

  // compact per-player snapshot entry
  toSnapshot() {
    return {
      id: this.id,
      tm: this.team,
      x: round2(this.x), y: round2(this.y), z: round2(this.z),
      vx: round2(this.vx), vy: round2(this.vy), vz: round2(this.vz),
      yaw: round2(this.yaw), pitch: round2(this.pitch),
      hp: this.hp, ar: this.armor, w: this.weapon, am: this.ammo,
      a: this.alive ? 1 : 0,
      seq: this.lastSeq, // so the client knows what input this state reflects
    };
  }
}

function round2(n) { return Math.round(n * 100) / 100; }
