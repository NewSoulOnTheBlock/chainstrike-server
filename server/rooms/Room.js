// A single authoritative match instance. Owns its own fixed-timestep simulation
// loop, the player list, and snapshot broadcasting. One Node process can host
// many Rooms concurrently (the spec's "multiple rooms in one process").
import {
  S2C, TICK_DT, TICK_HZ, SNAPSHOT_EVERY, encode,
  MAX_INPUT_AHEAD_MS, MAX_INPUT_AGE_MS,
} from '../../shared/net/protocol.js';
import { MOVE } from '../../shared/config/world.js';
import { stepMovement } from '../../shared/movement/move.js';
import { Player } from '../Player.js';

export class Room {
  constructor(id) {
    this.id = id;
    this.players = new Map();   // playerId -> Player
    this.inputs = new Map();    // playerId -> queued input array
    this.tick = 0;
    this.phase = 'waiting';     // waiting | warmup | buy | live | over
    this.startedAt = Date.now();
    this._loop = null;
    this.start();
  }

  get empty() { return this.players.size === 0; }

  start() {
    if (this._loop) return;
    let acc = 0;
    let last = process.hrtime.bigint();
    const stepNs = BigInt(Math.round(1e9 / TICK_HZ));
    this._loop = setInterval(() => {
      const now = process.hrtime.bigint();
      acc += Number(now - last);
      last = now;
      // run as many fixed ticks as real time accumulated (catch-up, capped)
      let guard = 0;
      while (acc >= Number(stepNs) && guard < 5) {
        this.step(TICK_DT);
        acc -= Number(stepNs);
        guard++;
      }
      if (guard >= 5) acc = 0; // we fell behind; drop the backlog
    }, 1000 / TICK_HZ);
  }

  stop() {
    if (this._loop) { clearInterval(this._loop); this._loop = null; }
  }

  // ---- membership --------------------------------------------------------
  addPlayer(id, name, team, ws) {
    const p = new Player(id, name, team, ws);
    p.spawn();
    this.players.set(id, p);
    this.inputs.set(id, []);
    // tell the newcomer who they are + current roster
    this.sendTo(p, S2C.WELCOME, {
      id, room: this.id, tick: this.tick,
      you: p.toSnapshot(),
      players: [...this.players.values()].map((q) => q.toSnapshot()),
      tickHz: TICK_HZ,
    });
    // tell everyone else someone joined
    this.broadcast(S2C.PLAYER_JOINED, { player: p.toSnapshot(), name: p.name }, id);
    return p;
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.players.delete(id);
    this.inputs.delete(id);
    this.broadcast(S2C.PLAYER_LEFT, { id });
  }

  // ---- input intake (validated) -----------------------------------------
  queueInput(id, input) {
    const p = this.players.get(id);
    if (!p) return;
    p.lastSeenAt = Date.now();
    if (!input || typeof input.seq !== 'number') return;
    // drop inputs that are too old or implausibly in the future
    const now = Date.now();
    if (typeof input.t === 'number') {
      const dtMs = input.t - now;
      if (dtMs > MAX_INPUT_AHEAD_MS) return;
      if (dtMs < -MAX_INPUT_AGE_MS) return;
    }
    if (input.seq <= p.lastSeq) return; // already processed / duplicate
    const q = this.inputs.get(id);
    q.push(input);
    if (q.length > 120) q.splice(0, q.length - 120); // hard cap (spam guard)
  }

  // ---- fixed-step simulation --------------------------------------------
  step(dt) {
    this.tick++;

    for (const p of this.players.values()) {
      const q = this.inputs.get(p.id);
      if (!q || q.length === 0) continue;
      // process every queued input in sequence order this tick
      q.sort((a, b) => a.seq - b.seq);
      for (const inp of q) {
        if (inp.seq <= p.lastSeq) continue;
        this.applyInput(p, inp, dt);
        p.lastSeq = inp.seq;
      }
      q.length = 0;
    }

    if (this.tick % SNAPSHOT_EVERY === 0) this.sendSnapshot();
  }

  applyInput(p, inp, dt) {
    if (!p.alive) return;
    if (typeof inp.yaw === 'number') p.yaw = inp.yaw;
    if (typeof inp.pitch === 'number') p.pitch = clamp(inp.pitch, -1.55, 1.55);
    const before = { x: p.x, z: p.z };
    stepMovement(p, { move: inp.move, yaw: p.yaw, buttons: inp.buttons }, dt);
    // anti-cheat: clamp impossible horizontal displacement for one tick
    const maxStep = (p.grounded ? MOVE.maxSpeedHardCap : MOVE.maxAirSpeedCap) * dt + 0.05;
    const moved = Math.hypot(p.x - before.x, p.z - before.z);
    if (moved > maxStep) {
      const k = maxStep / moved;
      p.x = before.x + (p.x - before.x) * k;
      p.z = before.z + (p.z - before.z) * k;
    }
  }

  // ---- outbound ----------------------------------------------------------
  sendSnapshot() {
    const snap = {
      tick: this.tick,
      ts: Date.now(),
      phase: this.phase,
      players: [...this.players.values()].map((p) => p.toSnapshot()),
    };
    const msg = encode(S2C.MATCH_SNAPSHOT, snap);
    for (const p of this.players.values()) safeSend(p.ws, msg);
  }

  sendTo(p, type, data) { safeSend(p.ws, encode(type, data)); }

  broadcast(type, data, exceptId) {
    const msg = encode(type, data);
    for (const p of this.players.values()) {
      if (p.id === exceptId) continue;
      safeSend(p.ws, msg);
    }
  }
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function safeSend(ws, msg) {
  try { if (ws && ws.readyState === 1) ws.send(msg); } catch { /* ignore */ }
}
