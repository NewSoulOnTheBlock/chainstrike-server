// Round / match structure tuning. Original tactical-shooter pacing, no copied
// names or values. THREE-free so Node imports it directly.

export const MATCH = {
  warmupMs: 6000,     // free practice until both teams have a player
  buyMs: 8000,        // freeze/buy phase at the start of every round
  liveMs: 95000,      // live round length
  endMs: 5000,        // round-end result display
  halftimeMs: 6000,   // intermission while sides swap

  maxRounds: 12,                 // regulation rounds
  get halfRounds() { return this.maxRounds / 2; }, // sides swap after this many
  get winScore() { return this.maxRounds / 2 + 1; }, // first to this wins (7)

  startMoney: 800,
};

export const PHASE = {
  WARMUP: 'warmup',
  BUY: 'buy',
  LIVE: 'live',
  END: 'end',
  HALFTIME: 'halftime',
  OVER: 'over',
};
