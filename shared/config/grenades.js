// Phase 8 — tactical utility grenades. Original archetypes (no copyrighted
// names). Shared by the server (authoritative physics + effects) and the client
// (rendering + buy menu). THREE-free so Node can import it directly.

// throw physics — a grenade is a small bouncing projectile under gravity.
export const THROW = {
  speedStrong: 17,     // left-click full throw (units/s)
  speedSoft: 8,        // right-click underhand lob
  upBias: 3.2,         // added vertical velocity so throws arc
  radius: 0.18,        // collision radius vs floor/walls
  restitution: 0.42,   // velocity kept after a bounce
  friction: 0.72,      // horizontal velocity kept after a floor bounce
  restSpeed: 1.2,      // below this speed (and grounded) it's "at rest"
  maxLifeMs: 6000,     // hard cap so a stuck grenade still resolves
};

// per-type tuning. fuseMs is measured from the throw; at fuse time the grenade
// detonates wherever it currently is (airburst for frag/flash, a lingering
// volume for smoke/fire).
export const GRENADES = {
  frag: {
    name: 'Fragmentation', kind: 'frag', price: 300, max: 1,
    fuseMs: 1600,
    damage: 110,         // max damage at the epicentre
    radius: 7.5,         // outer edge (0 damage beyond)
    falloffMin: 0.0,     // fraction of damage at the edge
    armorPen: 0.5,       // how much armor is bypassed
    color: 0x6fae5a,
  },
  flash: {
    name: 'Flash', kind: 'flash', price: 200, max: 2,
    fuseMs: 800,
    radius: 13,          // beyond this you aren't blinded at all
    maxBlindMs: 2600,    // looking straight at it, point blank
    minBlindMs: 350,     // edge / facing away but in range
    color: 0xdfe8ff,
  },
  smoke: {
    name: 'Smoke', kind: 'smoke', price: 250, max: 1,
    fuseMs: 1200,
    radius: 5.0,         // vision-blocking volume radius
    durationMs: 14000,   // how long the cloud lingers
    color: 0xbfc6cf,
  },
  fire: {
    name: 'Incendiary', kind: 'fire', price: 350, max: 1,
    fuseMs: 1400,
    radius: 4.2,         // ground fire zone radius
    durationMs: 7000,
    dps: 30,             // damage per second standing in the fire
    tickMs: 250,         // DoT application cadence
    color: 0xff7a3c,
  },
};

// order shown in the buy menu / thrown by quick keys
export const GRENADE_ORDER = ['flash', 'smoke', 'frag', 'fire'];

// free utility handed out at the start of every round (on top of anything
// bought). Keeps pistol rounds playable without forcing a buy.
export const GRENADE_STARTER = { flash: 1, smoke: 0, frag: 0, fire: 0 };

export function freshGrenades() {
  return { frag: 0, flash: 0, smoke: 0, fire: 0 };
}
