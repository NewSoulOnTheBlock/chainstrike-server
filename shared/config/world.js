// World / movement tuning shared by client prediction and server authority so
// both simulate identical physics. Keep this free of engine (THREE) imports so
// Node can require it directly.

export const WORLD = {
  gravity: 22,          // units/s^2
  playerHeight: 1.8,
  playerRadius: 0.4,
  spawnY: 0,
  arenaHalfX: 12.75,    // matches the GLB map (tdm_arena) footprint
  arenaHalfZ: 24.6,
};

export const MOVE = {
  maxSpeed: 7.0,        // ground run speed (units/s)
  walkSpeed: 3.6,
  crouchSpeed: 2.6,
  accel: 70,            // ground acceleration
  airAccel: 14,
  friction: 8,
  jumpVel: 7.2,
  // anti-cheat ceilings: never accept movement faster than this between ticks
  maxSpeedHardCap: 9.0, // run + small slack for slopes/bhop
  maxAirSpeedCap: 13.0,
};

export const SPAWN = {
  // teams spawn at fixed z lines (north attackers / south defenders), matching
  // the existing ChainStrike convention.
  attackerZ: -30,
  defenderZ: 30,
  spread: 4,            // lateral spacing between teammates
};
