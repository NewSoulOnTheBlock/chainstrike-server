# ChainStrike Authoritative Server

Server-authoritative WebSocket game server for ChainStrike (browser tactical FPS).

The browser client may only submit **inputs**; this server owns all gameplay
truth — movement simulation, hit detection, health, ammo, economy, round state,
and objectives — running a fixed-timestep simulation loop and broadcasting
authoritative snapshots.

## Run locally

```bash
cd server
npm install
npm start          # PORT env, defaults to 8080
```

Health check: `GET /health` → `{ ok: true, rooms, players, uptime }`
WebSocket: connect to the same origin, then send a `join_match` packet.

## Architecture

- `shared/` — protocol, config, and movement code shared with the browser client
  so client prediction and server authority simulate identical physics.
- `server/index.js` — HTTP (health + WS upgrade) + room manager + idle sweep.
- `server/rooms/Room.js` — one authoritative match: fixed 60 Hz tick loop,
  20 Hz snapshot broadcast, validated input intake.
- `server/Player.js` — authoritative per-player state.

## Render deployment

- Root directory: `server`
- Build command: `npm install`
- Start command: `npm start`
- Health check path: `/health`

This is Phase 1 of the networking build (join → spawn → authoritative movement →
broadcast). Later phases add prediction/reconciliation, hitscan + lag
compensation, rounds, objectives, economy, and anti-cheat.
