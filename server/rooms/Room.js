// A single authoritative match instance. Owns its own fixed-timestep simulation
// loop, the player list, and snapshot broadcasting. One Node process can host
// many Rooms concurrently (the spec's "multiple rooms in one process").
import {
  S2C, TICK_DT, TICK_HZ, SNAPSHOT_EVERY, encode,
  MAX_INPUT_AHEAD_MS, MAX_INPUT_AGE_MS,
} from '../../shared/net/protocol.js';
import { MOVE, WORLD } from '../../shared/config/world.js';
import { WEAPONS, COMBAT, computeDamage, REGION } from '../../shared/config/weapons.js';
import { MATCH, PHASE } from '../../shared/config/match.js';
import { OBJECTIVE } from '../../shared/config/objective.js';
import { ECON } from '../../shared/config/economy.js';
import { GRENADES, GRENADE_STARTER, THROW, freshGrenades } from '../../shared/config/grenades.js';
import { aimDir, raycastPlayer } from '../../shared/combat/raycast.js';
import { stepMovement } from '../../shared/movement/move.js';
import { Player } from '../Player.js';

export class Room {
  constructor(id) {
    this.id = id;
    this.players = new Map();   // playerId -> Player
    this.inputs = new Map();    // playerId -> queued input array
    this.tick = 0;

    // round / match state
    this.phase = PHASE.WARMUP;
    this.phaseEndsAt = Date.now() + MATCH.warmupMs;
    this.round = 0;
    this.scoreA = 0;            // score for the team CURRENTLY playing as A's side
    this.scoreD = 0;
    this.roundHistory = [];     // [{ round, winner, reason }]
    this.winner = null;         // 'A' | 'D' once phase === over
    this.lastRoundWin = null;   // { winner, reason } for the round-end banner
    this.swapped = false;       // sides swapped at halftime?
    this.lossStreakA = 0;       // consecutive round losses per side (economy)
    this.lossStreakD = 0;

    // objective ("Breach Charge") state — owned by the server
    this.objective = this.freshObjective();

    // grenade projectiles in flight + lingering area effects (smoke/fire)
    this.projectiles = [];   // [{ id, kind, owner, team, x,y,z, vx,vy,vz, fuseAt, bornAt }]
    this.effects = [];       // [{ id, kind, owner, team, x,z, radius, endsAt, lastTickAt }]
    this._nadeId = 0;

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
    p.money = MATCH.startMoney;
    // joining mid-round? sit out (dead) until the next round starts
    if (this.phase === PHASE.LIVE) p.alive = false;
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
    if (this.objective.carrier === id && !this.objective.planted) this.dropCharge(p);
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
    const now = Date.now();
    // Client and server wall clocks are NOT synchronized, so we cannot compare
    // input.t to `now` directly. Instead we learn a per-client offset from the
    // first input (and slowly track it), then judge each input's age relative to
    // that offset. This keeps the stale/future-packet guard meaningful without
    // a separate clock-sync handshake.
    if (typeof input.t === 'number') {
      const raw = now - input.t;
      if (p.clockOffset === null) p.clockOffset = raw;
      else p.clockOffset += (raw - p.clockOffset) * 0.02; // gentle drift tracking
      const age = raw - p.clockOffset; // ~0 for on-time packets
      if (age > MAX_INPUT_AGE_MS) return;        // arrived far too late
      if (age < -MAX_INPUT_AHEAD_MS) return;     // implausibly in the future
    }
    if (input.seq <= p.lastSeq) return; // already processed / duplicate
    const q = this.inputs.get(id);
    q.push(input);
    if (q.length > 120) q.splice(0, q.length - 120); // hard cap (spam guard)
  }

  // ---- fixed-step simulation --------------------------------------------
  step(dt) {
    this.tick++;
    const now = Date.now();

    for (const p of this.players.values()) {
      const q = this.inputs.get(p.id);
      if (q && q.length) {
        // process every queued input in sequence order this tick
        q.sort((a, b) => a.seq - b.seq);
        for (const inp of q) {
          if (inp.seq <= p.lastSeq) continue;
          this.applyInput(p, inp, dt);
          p.lastSeq = inp.seq;
        }
        q.length = 0;
      }

      // finish a pending reload
      if (p.reloading && now >= p.reloadDoneAt) this.finishReload(p);
      // free practice respawns ONLY in warmup; rounds control life otherwise
      if (this.phase === PHASE.WARMUP && !p.alive && p.respawnAt && now >= p.respawnAt) {
        p.spawn();
        this.broadcast(S2C.RESPAWN, { id: p.id, x: p.x, y: p.y, z: p.z });
      }
      // record a lag-compensation hitbox sample AFTER movement this tick
      p.recordHistory(now);
    }

    this.updateRounds(now);

    this.tickGrenades(dt, now);

    if (this.tick % SNAPSHOT_EVERY === 0) this.sendSnapshot();
  }

  // ---- round / match state machine --------------------------------------
  teamCounts() {
    let a = 0, d = 0, aliveA = 0, aliveD = 0;
    for (const p of this.players.values()) {
      if (p.team === 'A') { a++; if (p.alive) aliveA++; }
      else { d++; if (p.alive) aliveD++; }
    }
    return { a, d, aliveA, aliveD };
  }

  setPhase(phase, durMs) {
    this.phase = phase;
    this.phaseEndsAt = Date.now() + durMs;
    this.broadcastRoundState();
  }

  startRound() {
    this.round += 1;
    // a fresh "pistol round" opens each half; otherwise survivors keep their
    // weapon + armor and only players who died last round are reset to the
    // starting loadout. Money always carries over (the economy lives in money).
    const pistolRound = this.round === 1 || this.round === MATCH.halfRounds + 1;
    for (const p of this.players.values()) {
      if (pistolRound || !p.alive) {
        p.weapon = ECON.startWeapon;
        p.armor = ECON.startArmor;
        p.helmet = false;
        p.grenades = { ...GRENADE_STARTER };   // fresh utility for the new life
      }
      p.purchases = [];      // new buy phase -> refundable list resets
      p.spawn();
    }
    this.lastRoundWin = null;
    this.resetObjective();
    this.projectiles.length = 0;   // no grenades carry between rounds
    this.effects.length = 0;
    this.assignCarrier();
    this.setPhase(PHASE.BUY, MATCH.buyMs);
  }

  endRound(winnerTeam, reason) {
    if (winnerTeam === 'A') this.scoreA += 1; else this.scoreD += 1;
    this.awardRoundEconomy(winnerTeam);
    this.lastRoundWin = { winner: winnerTeam, reason };
    this.roundHistory.push({ round: this.round, winner: winnerTeam, reason });
    this.setPhase(PHASE.END, MATCH.endMs);
  }

  // team round-end money: winners get a flat reward, losers a streak-scaled
  // consolation. Loss streak grows while a side keeps losing, resets on a win.
  awardRoundEconomy(winnerTeam) {
    const loserStreak = winnerTeam === 'A' ? this.lossStreakD : this.lossStreakA;
    const lossReward = ECON.lossBase + Math.min(loserStreak, ECON.lossMaxSteps) * ECON.lossStep;
    for (const p of this.players.values()) {
      p.money += (p.team === winnerTeam) ? ECON.winReward : lossReward;
      if (p.money > ECON.moneyCap) p.money = ECON.moneyCap;
    }
    if (winnerTeam === 'A') { this.lossStreakA = 0; this.lossStreakD += 1; }
    else { this.lossStreakD = 0; this.lossStreakA += 1; }
  }

  advanceAfterRound() {
    // match win?
    if (this.scoreA >= MATCH.winScore || this.scoreD >= MATCH.winScore) {
      this.winner = this.scoreA > this.scoreD ? 'A' : 'D';
      this.setPhase(PHASE.OVER, 3600000);
      return;
    }
    // halftime swap after the first half
    if (!this.swapped && this.round >= MATCH.halfRounds) {
      this.swapSides();
      this.setPhase(PHASE.HALFTIME, MATCH.halftimeMs);
      return;
    }
    this.startRound();
  }

  swapSides() {
    this.swapped = true;
    for (const p of this.players.values()) p.team = p.team === 'A' ? 'D' : 'A';
    const tmp = this.scoreA; this.scoreA = this.scoreD; this.scoreD = tmp;
    const ls = this.lossStreakA; this.lossStreakA = this.lossStreakD; this.lossStreakD = ls;
  }

  resetToWarmup() {
    this.phase = PHASE.WARMUP;
    this.phaseEndsAt = Date.now() + MATCH.warmupMs;
    this.round = 0; this.scoreA = 0; this.scoreD = 0;
    this.roundHistory = []; this.winner = null; this.lastRoundWin = null; this.swapped = false;
    for (const p of this.players.values()) p.spawn();
    this.resetObjective();
    this.broadcastRoundState();
  }

  updateRounds(now) {
    const c = this.teamCounts();
    const bothTeams = c.a >= 1 && c.d >= 1;

    switch (this.phase) {
      case PHASE.WARMUP:
        if (bothTeams && now >= this.phaseEndsAt) this.startRound();
        else if (bothTeams && this.phaseEndsAt - now > MATCH.warmupMs) this.phaseEndsAt = now + MATCH.warmupMs;
        break;
      case PHASE.BUY:
        if (!bothTeams) { this.resetToWarmup(); break; }
        if (now >= this.phaseEndsAt) this.setPhase(PHASE.LIVE, MATCH.liveMs);
        break;
      case PHASE.LIVE: {
        if (!bothTeams) { this.resetToWarmup(); break; }
        this.tickObjective(now);
        if (this.phase !== PHASE.LIVE) break; // tickObjective may have ended the round
        const o = this.objective;
        if (o.planted) {
          // charge is armed: defenders must disarm or die; the live timer no
          // longer saves them. Wiping the defenders wins it for attackers.
          if (c.aliveD === 0) this.endRound('A', 'elimination');
        } else {
          if (c.aliveA === 0 && c.aliveD === 0) this.endRound('D', 'draw');
          else if (c.aliveA === 0) this.endRound('D', 'elimination');
          else if (c.aliveD === 0) this.endRound('A', 'elimination');
          else if (now >= this.phaseEndsAt) this.endRound('D', 'timeout'); // defenders hold
        }
        break;
      }
      case PHASE.END:
        if (now >= this.phaseEndsAt) this.advanceAfterRound();
        break;
      case PHASE.HALFTIME:
        if (now >= this.phaseEndsAt) this.startRound();
        break;
      case PHASE.OVER:
        // idle on the result; a fresh room is created when this one empties
        break;
      default:
        break;
    }
  }

  broadcastRoundState() {
    this.broadcast(S2C.ROUND_STATE, this.roundStatePayload());
  }
  roundStatePayload() {
    const c = this.teamCounts();
    return {
      phase: this.phase, round: this.round,
      scoreA: this.scoreA, scoreD: this.scoreD,
      phaseEndsAt: this.phaseEndsAt, now: Date.now(),
      aliveA: c.aliveA, aliveD: c.aliveD,
      winner: this.winner, lastRoundWin: this.lastRoundWin,
      maxRounds: MATCH.maxRounds, winScore: MATCH.winScore,
    };
  }

  // ---- objective ("Breach Charge") --------------------------------------
  freshObjective() {
    return {
      carrier: null,       // id of the attacker holding the charge
      dropped: null,       // { x, y, z } when lying on the ground
      planted: false,
      plantPos: null,      // { x, y, z } once armed
      site: null,          // 'A' | 'B'
      detonateAt: 0,
      plantBy: null, plantStart: 0,    // an arm in progress
      defuseBy: null, defuseStart: 0,  // a disarm in progress
      plantedBy: null, defusedBy: null,
    };
  }

  resetObjective() {
    this.objective = this.freshObjective();
    for (const p of this.players.values()) p.interacting = false;
  }

  // hand the charge to the first alive attacker each round
  assignCarrier() {
    let chosen = null;
    for (const p of this.players.values()) {
      if (p.team === 'A' && p.alive) { chosen = p; break; }
    }
    this.objective.carrier = chosen ? chosen.id : null;
  }

  siteAt(x, z) {
    for (const s of OBJECTIVE.sites) {
      if (Math.hypot(x - s.x, z - s.z) <= s.r) return s;
    }
    return null;
  }

  dropCharge(p) {
    const o = this.objective;
    if (o.planted || o.carrier !== p.id) return;
    o.carrier = null;
    o.dropped = { x: p.x, y: WORLD.spawnY, z: p.z };
    o.plantBy = null;
    this.broadcast(S2C.OBJECTIVE_UPDATE, { event: 'dropped', x: round2(p.x), z: round2(p.z) });
  }

  onInteract(id, d) {
    const p = this.players.get(id);
    if (!p || !p.alive) return;
    p.interacting = !!(d && d.hold);
  }

  tickObjective(now) {
    const o = this.objective;
    if (this.phase !== PHASE.LIVE) { o.plantBy = null; o.defuseBy = null; return; }

    // 1) detonation wins the round for attackers
    if (o.planted) {
      if (now >= o.detonateAt) { this.endRound('A', 'detonation'); return; }
    } else {
      // 2) an attacker walking over a dropped charge collects it
      if (o.dropped && !o.carrier) {
        for (const p of this.players.values()) {
          if (p.team !== 'A' || !p.alive) continue;
          if (Math.hypot(p.x - o.dropped.x, p.z - o.dropped.z) <= OBJECTIVE.pickupRadius) {
            o.carrier = p.id; o.dropped = null;
            this.broadcast(S2C.OBJECTIVE_UPDATE, { event: 'pickup', by: p.id });
            break;
          }
        }
      }
      // 3) arming progress (carrier holding interact inside a site zone)
      const c = o.carrier && this.players.get(o.carrier);
      const site = c && c.alive ? this.siteAt(c.x, c.z) : null;
      if (c && c.alive && c.interacting && site) {
        if (o.plantBy !== c.id) { o.plantBy = c.id; o.plantStart = now; }
        if (now - o.plantStart >= OBJECTIVE.plantTimeMs) this.completePlant(c, site, now);
      } else {
        o.plantBy = null;
      }
      return;
    }

    // 4) disarm progress (a defender holding interact near the armed charge)
    let actor = null;
    for (const p of this.players.values()) {
      if (p.team !== 'D' || !p.alive || !p.interacting) continue;
      if (Math.hypot(p.x - o.plantPos.x, p.z - o.plantPos.z) <= OBJECTIVE.defuseRadius) { actor = p; break; }
    }
    if (actor) {
      if (o.defuseBy !== actor.id) { o.defuseBy = actor.id; o.defuseStart = now; }
      if (now - o.defuseStart >= OBJECTIVE.defuseTimeMs) this.completeDefuse(actor);
    } else {
      o.defuseBy = null;
    }
  }

  completePlant(c, site, now) {
    const o = this.objective;
    o.planted = true;
    o.carrier = null;
    o.plantPos = { x: c.x, y: WORLD.spawnY, z: c.z };
    o.site = site.id;
    o.detonateAt = now + OBJECTIVE.detonateMs;
    o.plantedBy = c.id;
    o.plantBy = null;
    c.money += OBJECTIVE.plantBonus;
    c.interacting = false;
    this.broadcast(S2C.OBJECTIVE_UPDATE, {
      event: 'planted', site: site.id, by: c.id,
      x: round2(o.plantPos.x), z: round2(o.plantPos.z), detonateAt: o.detonateAt,
    });
    this.broadcastRoundState();
  }

  completeDefuse(p) {
    const o = this.objective;
    o.defusedBy = p.id;
    o.defuseBy = null;
    p.money += OBJECTIVE.defuseBonus;
    this.broadcast(S2C.OBJECTIVE_UPDATE, { event: 'defused', by: p.id });
    this.endRound('D', 'defuse');
  }

  objectiveSnapshot(now) {
    const o = this.objective;
    let pp = 0, df = 0;
    if (o.plantBy) pp = clamp((now - o.plantStart) / OBJECTIVE.plantTimeMs, 0, 1);
    if (o.defuseBy) df = clamp((now - o.defuseStart) / OBJECTIVE.defuseTimeMs, 0, 1);
    return {
      c: o.carrier, dr: o.dropped ? { x: round2(o.dropped.x), z: round2(o.dropped.z) } : null,
      pl: o.planted ? 1 : 0, st: o.site,
      px: o.plantPos ? round2(o.plantPos.x) : 0, pz: o.plantPos ? round2(o.plantPos.z) : 0,
      dt: o.detonateAt, pp: round2(pp), df: round2(df),
    };
  }

  applyInput(p, inp, dt) {
    if (!p.alive) return;
    if (typeof inp.yaw === 'number') p.yaw = inp.yaw;
    if (typeof inp.pitch === 'number') p.pitch = clamp(inp.pitch, -1.55, 1.55);
    // frozen during the buy/halftime phase: aim only, no movement
    const frozen = this.phase === PHASE.BUY || this.phase === PHASE.HALFTIME;
    const move = frozen ? { x: 0, z: 0 } : inp.move;
    const buttons = frozen ? 0 : inp.buttons;
    const before = { x: p.x, z: p.z };
    stepMovement(p, { move, yaw: p.yaw, buttons }, dt);
    // anti-cheat: clamp impossible horizontal displacement for one tick
    const maxStep = (p.grounded ? MOVE.maxSpeedHardCap : MOVE.maxAirSpeedCap) * dt + 0.05;
    const moved = Math.hypot(p.x - before.x, p.z - before.z);
    if (moved > maxStep) {
      const k = maxStep / moved;
      p.x = before.x + (p.x - before.x) * k;
      p.z = before.z + (p.z - before.z) * k;
    }
  }

  // ---- combat (server-authoritative hitscan + lag compensation) ----------
  // Client sends only the intent to fire; the server uses its OWN authoritative
  // yaw/pitch for the ray (never trusts client aim) and validates ammo/cooldown.
  onFire(id) {
    const p = this.players.get(id);
    if (!p || !p.alive || p.reloading) return;
    // can only shoot in a live round (or warmup practice)
    if (this.phase !== PHASE.LIVE && this.phase !== PHASE.WARMUP) return;
    const w = WEAPONS[p.weapon];
    if (!w) return;
    const now = Date.now();
    if (now - p.lastFireAt < w.fireDelayMs) return; // fire-rate validation
    if (p.mag <= 0) return;                          // ammo validation
    p.lastFireAt = now;
    p.mag -= 1;

    const ox = p.x, oy = p.y + COMBAT.eyeHeight, oz = p.z;
    const d = aimDir(p.yaw, p.pitch);
    // tell everyone else this player fired (remote tracer/muzzle fx)
    this.broadcast(S2C.SHOT, { id, ox, oy, oz, dx: d.x, dy: d.y, dz: d.z, w: p.weapon }, id);

    // lag compensation: rewind every target to where the shooter likely saw it
    const rewind = clamp(p.ping * 0.5 + COMBAT.interpDelayMs, 0, COMBAT.maxRewindMs);
    const shotTime = now - rewind;

    let hit = null; // { target, t, region }
    for (const t of this.players.values()) {
      if (t.id === id || !t.alive || t.team === p.team) continue; // no FF for now
      const sample = t.sampleAt(shotTime);
      const r = raycastPlayer(ox, oy, oz, d.x, d.y, d.z, sample);
      if (r && (!hit || r.t < hit.t)) hit = { target: t, t: r.t, region: r.region };
    }

    if (!hit) return;
    const dmg = computeDamage(w, hit.region, hit.t, hit.target.armor, hit.target.helmet);
    const victim = hit.target;
    victim.armor = Math.max(0, victim.armor - dmg.armor);
    victim.hp -= dmg.hp;
    const head = hit.region === REGION.head;

    // hit confirmation to the shooter
    this.sendTo(p, S2C.DAMAGE_EVENT, {
      confirm: true, target: victim.id, region: hit.region, amount: dmg.hp,
      lethal: victim.hp <= 0 ? 1 : 0, head: head ? 1 : 0,
    });

    if (victim.hp <= 0) {
      victim.hp = 0;
      victim.alive = false;
      victim.respawnAt = now + COMBAT.respawnMs;
      victim.interacting = false;
      if (victim.id === this.objective.carrier) this.dropCharge(victim);
      p.kills += 1;
      p.money = Math.min(ECON.moneyCap, p.money + (ECON.killReward[p.weapon] ?? ECON.killRewardDefault));
      victim.deaths += 1;
      this.broadcast(S2C.DEATH_EVENT, {
        killer: id, killerName: p.name, victim: victim.id, victimName: victim.name,
        weapon: p.weapon, head: head ? 1 : 0,
      });
    } else {
      // damage indicator to the victim
      this.sendTo(victim, S2C.DAMAGE_EVENT, {
        victim: victim.id, amount: dmg.hp, hp: victim.hp, armor: victim.armor,
        from: id, region: hit.region,
      });
    }
  }

  onReload(id) {
    const p = this.players.get(id);
    if (!p || !p.alive || p.reloading) return;
    const w = WEAPONS[p.weapon];
    if (!w || p.reserve <= 0 || p.mag >= w.mag) return;
    p.reloading = true;
    p.reloadDoneAt = Date.now() + w.reloadMs;
  }

  // ---- economy / buy menu (server-authoritative) -------------------------
  buyableInPhase() {
    if (!ECON.buyOnlyInBuyPhase) return true;
    return this.phase === PHASE.BUY || this.phase === PHASE.WARMUP;
  }

  // price + effect resolver for a buy item id
  itemSpec(item) {
    if (item === 'armor') return { price: ECON.armorPrice, kind: 'armor' };
    if (item === 'armorhelmet') return { price: ECON.armorHelmetPrice, kind: 'armorhelmet' };
    if (item.startsWith('nade_')) {
      const g = GRENADES[item.slice(5)];
      if (g) return { price: g.price, kind: 'grenade', nade: item.slice(5) };
    }
    const w = WEAPONS[item];
    if (w && w.price !== undefined) return { price: w.price, kind: 'weapon' };
    return null;
  }

  onBuy(id, d) {
    const p = this.players.get(id);
    if (!p || !p.alive || !d) return;

    // refund a previously-bought item this buy phase
    if (d.refund) { this.refundItem(p, d.item); return; }

    if (!this.buyableInPhase()) return this.sendTo(p, S2C.ECONOMY_UPDATE, { money: p.money, err: 'not buy phase' });
    const spec = this.itemSpec(d.item);
    if (!spec) return;
    // grenade carry-limit check before charging
    if (spec.kind === 'grenade' && p.grenades[spec.nade] >= GRENADES[spec.nade].max) {
      return this.sendTo(p, S2C.ECONOMY_UPDATE, { money: p.money, err: 'grenade limit' });
    }
    if (p.money < spec.price) return this.sendTo(p, S2C.ECONOMY_UPDATE, { money: p.money, err: 'too expensive' });

    p.money -= spec.price;
    if (spec.kind === 'weapon') {
      const w = WEAPONS[d.item];
      p.weapon = d.item;
      p.mag = w.mag; p.reserve = w.reserve; p.reloading = false;
    } else if (spec.kind === 'armor') {
      p.armor = 100;
    } else if (spec.kind === 'armorhelmet') {
      p.armor = 100; p.helmet = true;
    } else if (spec.kind === 'grenade') {
      p.grenades[spec.nade] += 1;
    }
    p.purchases.push({ item: d.item, price: spec.price });
    this.sendTo(p, S2C.ECONOMY_UPDATE, { money: p.money, bought: d.item });
  }

  refundItem(p, item) {
    if (!this.buyableInPhase()) return;
    const idx = p.purchases.map((x) => x.item).lastIndexOf(item);
    if (idx < 0) return;
    const [bought] = p.purchases.splice(idx, 1);
    p.money = Math.min(ECON.moneyCap, p.money + bought.price);
    // revert effect
    if (bought.item === 'armor' || bought.item === 'armorhelmet') { p.armor = 0; p.helmet = false; }
    else if (bought.item.startsWith('nade_')) {
      const k = bought.item.slice(5);
      if (p.grenades[k] > 0) p.grenades[k] -= 1;
    } else if (WEAPONS[bought.item]) {
      p.weapon = ECON.startWeapon;
      const w = WEAPONS[p.weapon];
      p.mag = w.mag; p.reserve = w.reserve;
    }
    this.sendTo(p, S2C.ECONOMY_UPDATE, { money: p.money, refunded: bought.item });
  }

  finishReload(p) {
    const w = WEAPONS[p.weapon];
    const need = w.mag - p.mag;
    const take = Math.min(need, p.reserve);
    p.mag += take;
    p.reserve -= take;
    p.reloading = false;
  }

  // ---- grenades (server-authoritative throw + physics + area effects) -----
  // The client only asks to throw; the server owns the projectile, its bounce
  // physics, the fuse, and every effect (frag damage, flash blind, smoke volume,
  // fire DoT). d = { kind, soft }.
  onThrow(id, d) {
    const p = this.players.get(id);
    if (!p || !p.alive || !d) return;
    if (this.phase !== PHASE.LIVE && this.phase !== PHASE.WARMUP) return;
    const kind = d.kind;
    const g = GRENADES[kind];
    if (!g || !p.grenades[kind] || p.grenades[kind] <= 0) return;
    p.grenades[kind] -= 1;

    const now = Date.now();
    const dir = aimDir(p.yaw, p.pitch);
    const speed = d.soft ? THROW.speedSoft : THROW.speedStrong;
    const proj = {
      id: ++this._nadeId, kind, owner: p.id, team: p.team,
      x: p.x, y: p.y + COMBAT.eyeHeight, z: p.z,
      vx: dir.x * speed, vy: dir.y * speed + THROW.upBias, vz: dir.z * speed,
      fuseAt: now + g.fuseMs, bornAt: now, atRest: false,
    };
    this.projectiles.push(proj);
    this.broadcast(S2C.GRENADE_EVENT, {
      event: 'throw', id: proj.id, kind, by: p.id,
      x: round2(proj.x), y: round2(proj.y), z: round2(proj.z),
    });
  }

  // integrate every grenade projectile + age lingering effects. Called per tick.
  tickGrenades(dt, now) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const g = this.projectiles[i];
      this.stepProjectile(g, dt);
      if (now >= g.fuseAt || now - g.bornAt > THROW.maxLifeMs) {
        this.detonate(g, now);
        this.projectiles.splice(i, 1);
      }
    }
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      if (e.kind === 'fire' && now - e.lastTickAt >= GRENADES.fire.tickMs) {
        e.lastTickAt = now;
        this.applyFireTick(e, now);
      }
      if (now >= e.endsAt) this.effects.splice(i, 1);
    }
  }

  // simple projectile integration with floor + arena-wall bounces
  stepProjectile(g, dt) {
    g.vy -= WORLD.gravity * dt;
    g.x += g.vx * dt; g.y += g.vy * dt; g.z += g.vz * dt;
    const r = THROW.radius;
    // floor
    if (g.y <= r) {
      g.y = r;
      if (g.vy < 0) {
        g.vy = -g.vy * THROW.restitution;
        g.vx *= THROW.friction; g.vz *= THROW.friction;
        this.broadcast(S2C.GRENADE_EVENT, { event: 'bounce', id: g.id, kind: g.kind, x: round2(g.x), y: round2(g.y), z: round2(g.z) });
        if (g.vy < THROW.restSpeed) g.vy = 0;
      }
    }
    // arena walls (reflect on x/z bounds)
    const hx = WORLD.arenaHalfX - r, hz = WORLD.arenaHalfZ - r;
    if (g.x > hx) { g.x = hx; g.vx = -g.vx * THROW.restitution; }
    else if (g.x < -hx) { g.x = -hx; g.vx = -g.vx * THROW.restitution; }
    if (g.z > hz) { g.z = hz; g.vz = -g.vz * THROW.restitution; }
    else if (g.z < -hz) { g.z = -hz; g.vz = -g.vz * THROW.restitution; }
  }

  // a grenade reaches its fuse: apply its effect at its current position
  detonate(g, now) {
    const cfg = GRENADES[g.kind];
    this.broadcast(S2C.GRENADE_EVENT, {
      event: 'detonate', id: g.id, kind: g.kind,
      x: round2(g.x), y: round2(g.y), z: round2(g.z), r: cfg.radius,
    });
    if (g.kind === 'frag') this.detonateFrag(g, cfg);
    else if (g.kind === 'flash') this.detonateFlash(g, cfg, now);
    else if (g.kind === 'smoke') this.deployEffect(g, cfg, now, 'smoke');
    else if (g.kind === 'fire') this.deployEffect(g, cfg, now, 'fire');
  }

  detonateFrag(g, cfg) {
    for (const t of this.players.values()) {
      if (!t.alive) continue;
      const dist = Math.hypot(t.x - g.x, t.z - g.z, (t.y + 0.9) - g.y);
      if (dist > cfg.radius) continue;
      const u = dist / cfg.radius;                       // 0 centre .. 1 edge
      const scale = 1 - (1 - cfg.falloffMin) * u;
      let dmg = cfg.damage * scale;
      let armorLoss = 0;
      if (t.armor > 0) {
        const absorbed = dmg * (1 - cfg.armorPen) * 0.5;
        dmg -= absorbed; armorLoss = Math.min(t.armor, Math.round(absorbed));
      }
      t.armor = Math.max(0, t.armor - armorLoss);
      this.applyGrenadeDamage(g, t, Math.max(1, Math.round(dmg)));
    }
  }

  // flash blind: stronger the closer you are and the more you face the flash
  detonateFlash(g, cfg, now) {
    for (const t of this.players.values()) {
      if (!t.alive) continue;
      const dx = g.x - t.x, dy = g.y - (t.y + COMBAT.eyeHeight), dz = g.z - t.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > cfg.radius) continue;
      // how directly is the victim looking at the flash? (1 = straight at it)
      const view = aimDir(t.yaw, t.pitch);
      const inv = 1 / (dist || 1);
      const dot = view.x * dx * inv + view.y * dy * inv + view.z * dz * inv;
      const facing = Math.max(0, dot);                   // 0 facing away .. 1 straight on
      const prox = 1 - dist / cfg.radius;                // 0 edge .. 1 point blank
      const strength = Math.min(1, (0.4 + 0.6 * facing) * prox + facing * 0.15);
      const blindMs = cfg.minBlindMs + (cfg.maxBlindMs - cfg.minBlindMs) * strength;
      const until = now + blindMs;
      if (until > t.blindUntil) t.blindUntil = until;
      this.sendTo(t, S2C.GRENADE_EVENT, { event: 'flash', durationMs: Math.round(blindMs), by: g.owner });
    }
  }

  deployEffect(g, cfg, now, kind) {
    const e = {
      id: ++this._nadeId, kind, owner: g.owner, team: g.team,
      x: g.x, z: g.z, radius: cfg.radius, endsAt: now + cfg.durationMs, lastTickAt: now,
    };
    this.effects.push(e);
    this.broadcast(S2C.GRENADE_EVENT, {
      event: kind, id: e.id, x: round2(e.x), z: round2(e.z), r: e.radius, durationMs: cfg.durationMs,
    });
  }

  // incendiary DoT: damage anyone standing inside the fire this tick
  applyFireTick(e, now) {
    const cfg = GRENADES.fire;
    const per = cfg.dps * (cfg.tickMs / 1000);
    for (const t of this.players.values()) {
      if (!t.alive) continue;
      if (Math.hypot(t.x - e.x, t.z - e.z) > e.radius) continue;
      this.applyGrenadeDamage({ owner: e.owner, team: e.team, kind: 'fire' }, t, Math.max(1, Math.round(per)));
    }
  }

  // shared damage application for grenade sources (frag + fire) — handles death,
  // kill credit, charge-drop and the kill feed, mirroring onFire's death block.
  applyGrenadeDamage(src, victim, dmg) {
    const wasAlive = victim.alive;
    victim.hp -= dmg;
    const killer = this.players.get(src.owner);
    this.sendTo(victim, S2C.DAMAGE_EVENT, { victim: victim.id, amount: dmg, hp: victim.hp, armor: victim.armor, from: src.owner, region: 'body', src: src.kind });
    if (wasAlive && victim.hp <= 0) {
      victim.hp = 0; victim.alive = false;
      victim.respawnAt = Date.now() + COMBAT.respawnMs;
      victim.interacting = false;
      if (victim.id === this.objective.carrier) this.dropCharge(victim);
      victim.deaths += 1;
      if (killer && killer.id !== victim.id && killer.team !== victim.team) {
        killer.kills += 1;
        killer.money = Math.min(ECON.moneyCap, killer.money + (ECON.killReward[killer.weapon] ?? ECON.killRewardDefault));
      }
      this.broadcast(S2C.DEATH_EVENT, {
        killer: killer ? killer.id : null, killerName: killer ? killer.name : src.kind,
        victim: victim.id, victimName: victim.name, weapon: src.kind, head: 0,
      });
    }
  }


  sendSnapshot() {
    const snap = {
      tick: this.tick,
      ts: Date.now(),
      phase: this.phase,
      round: this.round,
      scoreA: this.scoreA, scoreD: this.scoreD,
      pEnd: this.phaseEndsAt,
      winner: this.winner,
      obj: this.objectiveSnapshot(Date.now()),
      nades: this.projectiles.map((g) => ({
        id: g.id, k: g.kind, x: round2(g.x), y: round2(g.y), z: round2(g.z),
      })),
      fx: this.effects.map((e) => ({
        id: e.id, k: e.kind, x: round2(e.x), z: round2(e.z), r: e.radius, end: e.endsAt,
      })),
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
function round2(n) { return Math.round(n * 100) / 100; }
function safeSend(ws, msg) {
  try { if (ws && ws.readyState === 1) ws.send(msg); } catch { /* ignore */ }
}
