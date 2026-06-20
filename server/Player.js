// Authoritative server-side player. The server owns every field here; clients
// only ever submit inputs that mutate it through validated simulation.
import { WORLD, SPAWN } from '../shared/config/world.js';
import { HISTORY_MS } from '../shared/net/protocol.js';
import { WEAPONS, DEFAULT_WEAPON } from '../shared/config/weapons.js';

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

    // gameplay state (authoritative)
    this.hp = 100;
    this.armor = 0;
    this.alive = true;
    this.respawnAt = 0;

    // weapon / inventory (authoritative)
    this.weapon = DEFAULT_WEAPON;
    const w = WEAPONS[this.weapon];
    this.mag = w.mag;
    this.reserve = w.reserve;
    this.reloading = false;
    this.reloadDoneAt = 0;
    this.lastFireAt = 0;

    // stats
    this.kills = 0; this.deaths = 0; this.assists = 0;
    this.money = 800;
    this.interacting = false;    // holding the plant/disarm key this tick

    // lag-compensation hitbox history: [{ t, x, y, z, yaw }]
    this.history = [];

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
    this.respawnAt = 0;
    const w = WEAPONS[this.weapon];
    this.mag = w.mag;
    this.reserve = w.reserve;
    this.reloading = false;
    this.history.length = 0;
    this.interacting = false;
  }

  // record a hitbox-history sample for lag compensation, trimming old entries
  recordHistory(now) {
    this.history.push({ t: now, x: this.x, y: this.y, z: this.z, yaw: this.yaw });
    const cutoff = now - HISTORY_MS;
    while (this.history.length > 2 && this.history[0].t < cutoff) this.history.shift();
  }

  // nearest historical sample to time `t` (for rewinding this player's hitboxes)
  sampleAt(t) {
    if (this.history.length === 0) return { x: this.x, y: this.y, z: this.z };
    let best = this.history[0];
    let bestD = Math.abs(best.t - t);
    for (let i = 1; i < this.history.length; i++) {
      const d = Math.abs(this.history[i].t - t);
      if (d < bestD) { bestD = d; best = this.history[i]; }
    }
    return best;
  }

  // compact per-player snapshot entry
  toSnapshot() {
    return {
      id: this.id,
      tm: this.team,
      x: round2(this.x), y: round2(this.y), z: round2(this.z),
      vx: round2(this.vx), vy: round2(this.vy), vz: round2(this.vz),
      yaw: round2(this.yaw), pitch: round2(this.pitch),
      hp: this.hp, ar: this.armor, w: this.weapon,
      am: this.mag, rs: this.reserve, rl: this.reloading ? 1 : 0,
      a: this.alive ? 1 : 0,
      k: this.kills, d: this.deaths,
      nm: this.name, mny: this.money,
      seq: this.lastSeq, // so the client knows what input this state reflects
    };
  }
}

function round2(n) { return Math.round(n * 100) / 100; }
