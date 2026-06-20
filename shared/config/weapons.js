// Weapon + combat tuning shared by server authority and client visuals/HUD.
// Original, generic weapon archetypes only — no real-world or copyrighted names.
// Keep THREE-free so Node can import it directly.

export const COMBAT = {
  eyeHeight: 1.6,        // ray origin height above feet (matches client camera)
  respawnMs: 3000,       // auto-respawn delay (no rounds yet — Phase 5)
  maxRewindMs: 280,      // lag-compensation rewind ceiling (< HISTORY_MS)
  interpDelayMs: 100,    // remote interpolation delay the client renders at
};

// Hitbox boxes in player-local space (feet at y=0). Half-extents + center Y.
export const HITBOX = {
  head: { cy: 1.62, hx: 0.22, hy: 0.18, hz: 0.22 },
  body: { cy: 0.80, hx: 0.40, hy: 0.62, hz: 0.40 },
  legs: { cy: 0.18, hx: 0.34, hy: 0.18, hz: 0.34 },
};

// damageMult applied per hit region (before falloff/armor)
export const REGION = { head: 'head', body: 'body', legs: 'legs' };
export const LIMB_MULT = { head: 1, body: 1, legs: 0.75 }; // headshotMult is per-weapon

export const WEAPONS = {
  pistol: {
    name: 'Sidearm', slot: 'secondary',
    dmg: 26, headshotMult: 4.0,
    fireDelayMs: 150, auto: false,
    mag: 12, reserve: 48, reloadMs: 1400,
    falloffStart: 22, falloffEnd: 45, falloffMin: 0.6,
    armorPen: 0.50, price: 0,
  },
  smg: {
    name: 'Compact', slot: 'primary',
    dmg: 23, headshotMult: 3.0,
    fireDelayMs: 75, auto: true,
    mag: 25, reserve: 100, reloadMs: 1900,
    falloffStart: 16, falloffEnd: 38, falloffMin: 0.55,
    armorPen: 0.55, price: 1200,
  },
  rifle: {
    name: 'Carbine', slot: 'primary',
    dmg: 31, headshotMult: 4.0,
    fireDelayMs: 95, auto: true,
    mag: 30, reserve: 90, reloadMs: 2200,
    falloffStart: 35, falloffEnd: 70, falloffMin: 0.70,
    armorPen: 0.78, price: 2700,
  },
  shotgun: {
    name: 'Breacher', slot: 'primary',
    dmg: 22, headshotMult: 2.0, pellets: 7, spreadDeg: 4.5,
    fireDelayMs: 750, auto: false,
    mag: 7, reserve: 28, reloadMs: 2600,
    falloffStart: 8, falloffEnd: 22, falloffMin: 0.25,
    armorPen: 0.45, price: 1800,
  },
  sniper: {
    name: 'Marksman', slot: 'primary',
    dmg: 115, headshotMult: 2.2,
    fireDelayMs: 1400, auto: false,
    mag: 5, reserve: 20, reloadMs: 3000,
    falloffStart: 120, falloffEnd: 240, falloffMin: 0.9,
    armorPen: 0.95, price: 4500,
  },
};

export const DEFAULT_WEAPON = 'rifle';

// distance falloff multiplier (1 near, falloffMin far)
export function falloffMul(w, dist) {
  if (dist <= w.falloffStart) return 1;
  if (dist >= w.falloffEnd) return w.falloffMin;
  const u = (dist - w.falloffStart) / (w.falloffEnd - w.falloffStart);
  return 1 - (1 - w.falloffMin) * u;
}

// final HP damage for a hit, accounting for region, falloff and armor.
// returns { hp, armor } amounts to subtract. Armor absorbs body/leg hits always;
// it only absorbs headshots when the target also has a helmet.
export function computeDamage(w, region, dist, targetArmor, helmet) {
  let dmg = w.dmg;
  if (region === REGION.head) dmg *= w.headshotMult;
  else dmg *= (LIMB_MULT[region] || 1);
  dmg *= falloffMul(w, dist);
  let armorLoss = 0;
  const armorApplies = targetArmor > 0 && (region !== REGION.head || helmet);
  if (armorApplies) {
    const absorbed = dmg * (1 - w.armorPen) * 0.5;
    dmg -= absorbed;
    armorLoss = Math.min(targetArmor, Math.round(absorbed));
  }
  return { hp: Math.max(1, Math.round(dmg)), armor: armorLoss };
}
