// Wire protocol shared by the authoritative Node server and the browser client.
// Plain ESM with no dependencies so the exact same file is imported by Node
// (server) and the browser (client) — guaranteeing both sides agree on packet
// shapes and constants. JSON packets for the prototype; binary encoding is a
// later optimization (see OPTIMIZE notes in the spec).

// ---- simulation constants -------------------------------------------------
export const PROTOCOL_VERSION = 1;

export const TICK_HZ = 60;            // server simulation rate
export const TICK_DT = 1 / TICK_HZ;  // fixed delta time per tick (seconds)
export const SNAPSHOT_HZ = 20;        // state broadcast rate to clients
export const SNAPSHOT_EVERY = Math.round(TICK_HZ / SNAPSHOT_HZ); // ticks/snapshot

export const HEARTBEAT_MS = 2000;     // client → server ping cadence
export const TIMEOUT_MS = 10000;      // drop a player after this silence
export const MAX_INPUT_AHEAD_MS = 250; // reject inputs timestamped too far ahead
export const MAX_INPUT_AGE_MS = 1000;  // reject inputs that are too old

export const HISTORY_MS = 300;        // lag-comp hitbox history window

// ---- client → server message types ----------------------------------------
export const C2S = {
  JOIN_MATCH: 'join_match',
  LEAVE_MATCH: 'leave_match',
  PLAYER_INPUT: 'player_input',
  FIRE_WEAPON: 'fire_weapon',
  RELOAD_WEAPON: 'reload_weapon',
  SWITCH_WEAPON: 'switch_weapon',
  BUY_ITEM: 'buy_item',
  DROP_WEAPON: 'drop_weapon',
  INTERACT_OBJECTIVE: 'interact_objective',
  CHAT_MESSAGE: 'chat_message',
  PING: 'ping',
};

// ---- server → client message types ----------------------------------------
export const S2C = {
  WELCOME: 'welcome',           // sent once on successful join (ids, config, spawn)
  MATCH_SNAPSHOT: 'match_snapshot',
  PLAYER_STATE: 'player_state',
  DAMAGE_EVENT: 'damage_event',
  DEATH_EVENT: 'death_event',
  ROUND_STATE: 'round_state',
  ECONOMY_UPDATE: 'economy_update',
  INVENTORY_UPDATE: 'inventory_update',
  OBJECTIVE_UPDATE: 'objective_update',
  CHAT_MESSAGE: 'chat_message',
  PLAYER_JOINED: 'player_joined',
  PLAYER_LEFT: 'player_left',
  ERROR: 'error',
  PONG: 'pong',
};

// Button bitmask for compact input encoding.
export const BTN = {
  FORWARD: 1 << 0,
  BACK: 1 << 1,
  LEFT: 1 << 2,
  RIGHT: 1 << 3,
  JUMP: 1 << 4,
  CROUCH: 1 << 5,
  WALK: 1 << 6,
  FIRE: 1 << 7,
};

// envelope: every packet is { t: type, d: payload, s?: seq }
export function encode(type, data, seq) {
  return JSON.stringify(seq === undefined ? { t: type, d: data } : { t: type, d: data, s: seq });
}
export function decode(raw) {
  try { return JSON.parse(raw); } catch { return null; }
}
