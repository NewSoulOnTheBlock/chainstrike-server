// Phase 6 — tactical objective ("plant / disarm") mode config.
// Original naming only: the objective is a "Breach Charge" the Attackers (team A)
// must arm at one of two Breach Sites; Defenders (team D) disarm it. No
// copyrighted names/branding. Shared by server authority and the client UI so
// both agree on site positions, radii, and timings.

import { MAP_SITES } from './mapColliders.js';

export const OBJECTIVE = {
  name: 'Breach Charge',

  // timings (ms)
  plantTimeMs: 3200,    // hold to arm the charge
  defuseTimeMs: 5000,   // hold to disarm a planted charge
  detonateMs: 38000,    // countdown from plant -> detonation

  // distances (world units)
  plantRadius: 5.0,     // attacker must be inside a site zone to arm
  defuseRadius: 2.4,    // defender must be this close to the armed charge
  pickupRadius: 1.8,    // attacker auto-collects a dropped charge

  // economy rewards
  plantBonus: 300,
  defuseBonus: 300,

  // two original arena breach sites (placed on open, reachable map cells)
  sites: MAP_SITES,
};
