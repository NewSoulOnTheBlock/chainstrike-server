// Authoritative game server entrypoint. One Node process, an HTTP server (for
// Render health checks + the WebSocket upgrade), and an in-memory map of Rooms.
// Run: `node server/index.js`  (PORT from env, defaults to 8080).
import http from 'http';
import { WebSocketServer } from 'ws';
import {
  C2S, S2C, decode, encode, PROTOCOL_VERSION,
  TIMEOUT_MS, HEARTBEAT_MS,
} from '../shared/net/protocol.js';
import { Room } from './rooms/Room.js';

const PORT = process.env.PORT || 8080;
const rooms = new Map(); // roomId -> Room

function getRoom(id) {
  let r = rooms.get(id);
  if (!r) { r = new Room(id); rooms.set(id, r); console.log(`[room] created ${id}`); }
  return r;
}
function cleanupRoom(r) {
  if (r && r.empty) { r.stop(); rooms.delete(r.id); console.log(`[room] destroyed ${r.id}`); }
}

// ---- HTTP (health + info) --------------------------------------------------
const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true, protocol: PROTOCOL_VERSION,
      rooms: rooms.size,
      players: [...rooms.values()].reduce((n, r) => n + r.players.size, 0),
      uptime: Math.round(process.uptime()),
    }));
    return;
  }
  res.writeHead(404); res.end('not found');
});

// ---- WebSocket -------------------------------------------------------------
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  // connection-scoped session; the player binds to a room on join_match
  const conn = { id: null, room: null, alive: true };

  ws.on('message', (raw) => {
    const msg = decode(raw.toString());
    if (!msg || typeof msg.t !== 'string') return;
    const d = msg.d || {};

    switch (msg.t) {
      case C2S.JOIN_MATCH: {
        if (conn.room) break; // already joined
        const roomId = String(d.room || 'public').slice(0, 32);
        const team = d.team === 'A' || d.team === 'D' ? d.team : autoTeam(getRoom(roomId));
        const id = (d.reconnect && String(d.reconnect)) || genId();
        const room = getRoom(roomId);
        conn.id = id; conn.room = room;
        room.addPlayer(id, d.name, team, ws);
        console.log(`[join] ${id} (${team}) -> ${roomId}  (${room.players.size} players)`);
        break;
      }
      case C2S.PLAYER_INPUT: {
        if (conn.room && conn.id) conn.room.queueInput(conn.id, d);
        break;
      }
      case C2S.LEAVE_MATCH: {
        leave();
        break;
      }
      case C2S.PING: {
        const p = conn.room && conn.room.players.get(conn.id);
        if (p) { p.lastSeenAt = Date.now(); if (typeof d.t === 'number') p.ping = d.ping || p.ping; }
        try { ws.send(encode(S2C.PONG, { t: d.t, now: Date.now() })); } catch { /* ignore */ }
        break;
      }
      default:
        // Phase 1 only wires join/input/ping/leave; later phases add the rest.
        break;
    }
  });

  ws.on('close', leave);
  ws.on('error', leave);

  function leave() {
    if (conn.room && conn.id) {
      const r = conn.room;
      r.removePlayer(conn.id);
      console.log(`[leave] ${conn.id} <- ${r.id}  (${r.players.size} players)`);
      conn.room = null; conn.id = null;
      cleanupRoom(r);
    }
  }
});

// ---- idle timeout sweep ----------------------------------------------------
setInterval(() => {
  const now = Date.now();
  for (const r of rooms.values()) {
    for (const p of [...r.players.values()]) {
      if (now - p.lastSeenAt > TIMEOUT_MS) {
        try { p.ws.close(); } catch { /* ignore */ }
        r.removePlayer(p.id);
        console.log(`[timeout] ${p.id} <- ${r.id}`);
      }
    }
    cleanupRoom(r);
  }
}, HEARTBEAT_MS);

function autoTeam(room) {
  let a = 0, d = 0;
  for (const p of room.players.values()) (p.team === 'A' ? a++ : d++);
  return a <= d ? 'A' : 'D';
}
function genId() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }

server.listen(PORT, () => console.log(`[server] authoritative FPS server on :${PORT}`));
