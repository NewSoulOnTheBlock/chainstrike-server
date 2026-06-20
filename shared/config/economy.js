// Phase 7 — tactical buy economy. Original values, shared by server (authority)
// and client (buy-menu pricing/affordability). THREE-free for Node import.

export const ECON = {
  startWeapon: 'pistol',   // loadout you respawn with on a reset / pistol round
  startArmor: 0,
  moneyCap: 16000,

  // round-end team rewards
  winReward: 3000,
  lossBase: 1400,          // base consolation for the losing side
  lossStep: 500,           // extra per consecutive loss
  lossMaxSteps: 4,         // cap: lossBase + 4*lossStep = 3400

  // per-kill reward, keyed by the killer's weapon (fallback = default)
  killReward: { pistol: 300, smg: 600, rifle: 300, shotgun: 900, sniper: 100, knife: 1500 },
  killRewardDefault: 300,

  // purchasable utility
  armorPrice: 650,         // armor to 100
  helmetPrice: 350,        // upgrade: armor also absorbs headshots
  armorHelmetPrice: 1000,  // both (kevlar + helmet)

  // buy restrictions
  buyOnlyInBuyPhase: true,
};

// items the buy menu offers, grouped into categories. Weapon prices/stats come
// from WEAPONS; armor entries are resolved against ECON above.
export const BUY_MENU = [
  { cat: 'Pistols', items: [{ id: 'pistol', key: '1' }] },
  { cat: 'Mid Tier', items: [{ id: 'smg', key: '2' }, { id: 'shotgun', key: '3' }] },
  { cat: 'Rifles', items: [{ id: 'rifle', key: '4' }, { id: 'sniper', key: '5' }] },
  { cat: 'Equipment', items: [
    { id: 'armor', key: '6', name: 'Body Armor', price: 650 },
    { id: 'armorhelmet', key: '7', name: 'Armor + Helmet', price: 1000 },
  ] },
];
