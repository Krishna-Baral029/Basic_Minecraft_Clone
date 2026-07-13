// Authoritative game server: owns rooms, world edits, player state and the day
// clock. Clients are renderers — every action is validated here, and only
// connections from the real game site are accepted (anti-clone enforcement).
import http from 'http';
import {WebSocketServer} from 'ws';

const PORT = process.env.PORT || 10000;
const SITE = 'lighthearted-torte-9c6768.netlify.app';
const EXTRA_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean);
const CH = 16, CYCLE = 1200;              // must match the client's chunk size / day length
const REACH = 10, MAX_PLAYERS = 12, EMPTY_ROOM_TTL = 120e3;
const MAX_CONNS = 100, MAX_ROOMS = 40;             // abuse caps: one small machine, friends-scale traffic

function originOk(origin) {
  if (!origin) return false;
  if (origin === 'https://' + SITE) return true;
  if (new RegExp('^https://[a-z0-9-]+--' + SITE.replace(/\./g, '\\.') + '$').test(origin)) return true;
  return EXTRA_ORIGINS.includes(origin);
}

const rooms = new Map();
let nextId = 1;

function roomDayFrac(room) {
  return (room.dayFrac0 + (Date.now() - room.dayT0) / 1000 / CYCLE) % 1;
}
function broadcast(room, data, except) {
  const s = JSON.stringify(data);
  for (const c of room.clients.values()) if (c !== except && c.ws.readyState === 1) c.ws.send(s);
}
function send(ws, data) { if (ws.readyState === 1) ws.send(JSON.stringify(data)); }

function dropClient(client) {
  const room = client.room;
  if (!room || !room.clients.has(client.id)) return;
  room.clients.delete(client.id);
  broadcast(room, {t: 'left', id: client.id, name: client.name});
  if (!room.clients.size) {
    room.emptyTimer = setTimeout(() => rooms.delete(room.id), EMPTY_ROOM_TTL);
  }
}

function handle(client, data) {
  const ws = client.ws;
  if (data.t === 'ping') return;

  if (data.t === 'create') {
    if (typeof data.roomId !== 'string' || !/^mc-[0-9a-f]{32}$/.test(data.roomId)) return send(ws, {t: 'error', code: 'bad-room'});
    if (rooms.size >= MAX_ROOMS) return send(ws, {t: 'error', code: 'server-busy'});
    const existing = rooms.get(data.roomId);
    if (existing && existing.clients.size) return send(ws, {t: 'error', code: 'room-exists'});
    if (existing) { clearTimeout(existing.emptyTimer); rooms.delete(data.roomId); }
    const room = {
      id: data.roomId, seed: data.seed | 0,
      mode: data.mode === 'Creative' ? 'Creative' : 'Survival',
      diff: typeof data.diff === 'string' ? data.diff.slice(0, 12) : 'Normal',
      edits: (data.edits && typeof data.edits === 'object') ? data.edits : {},
      sp: Array.isArray(data.sp) ? data.sp.slice(0, 3).map(Number) : [0, 20, 0],
      dayFrac0: typeof data.dayFrac === 'number' ? data.dayFrac % 1 : .3,
      dayT0: Date.now(), clients: new Map(), emptyTimer: null
    };
    rooms.set(room.id, room);
    client.room = room; client.isHost = true; client.name = String(data.name || 'Steve').slice(0, 24);
    client.pos = room.sp.slice();
    room.clients.set(client.id, client);
    return send(ws, {t: 'created', id: client.id});
  }

  if (data.t === 'join') {
    const room = rooms.get(data.roomId);
    if (!room) return send(ws, {t: 'error', code: 'not-found'});
    if (room.clients.size >= MAX_PLAYERS) return send(ws, {t: 'error', code: 'full'});
    client.room = room; client.name = String(data.name || 'Steve').slice(0, 24);
    client.pos = room.sp.slice();
    room.clients.set(client.id, client);
    send(ws, {t: 'init', id: client.id, seed: room.seed, mode: room.mode, diff: room.diff,
      dayFrac: roomDayFrac(room), edits: room.edits, pos: room.sp, sp: room.sp});
    broadcast(room, {t: 'notice', text: client.name + ' joined the game'}, client);
    return;
  }

  const room = client.room;
  if (!room) return;

  if (data.t === 'state') {
    const now = Date.now();
    if (now - client.lastState < 40) return;      // ~25/s cap
    client.lastState = now;
    const x = +data.x, y = +data.y, z = +data.z;
    if (!isFinite(x) || !isFinite(y) || !isFinite(z)) return;
    client.pos = [x, y, z];
    broadcast(room, {t: 'state', id: client.id, name: client.name, x, y, z,
      yaw: +data.yaw || 0, c: data.c ? 1 : 0}, client);
    return;
  }

  if (data.t === 'block') {
    const x = data.x | 0, y = data.y | 0, z = data.z | 0, v = data.v | 0;
    if (y < 0 || y >= 48) return;
    const d = Math.hypot(x - client.pos[0], y - client.pos[1], z - client.pos[2]);
    if (d > REACH) return;                        // out of reach: rejected, never broadcast
    if (Date.now() - client.lastBlock < 30) return;
    client.lastBlock = Date.now();
    const ck = Math.floor(x / CH) + '|' + Math.floor(z / CH);
    (room.edits[ck] || (room.edits[ck] = {}))[x + ',' + y + ',' + z] = v;
    broadcast(room, {t: 'block', x, y, z, v}, client);
    return;
  }

  if (data.t === 'setspawn' && client.isHost && Array.isArray(data.sp)) {
    const sp = data.sp.slice(0, 3).map(Number);
    if (sp.every(isFinite)) room.sp = sp;
    return;
  }

  if (data.t === 'chat' && typeof data.text === 'string') {
    broadcast(room, {t: 'notice', text: (client.name + ': ' + data.text).slice(0, 140)}, client);
  }
}

const server = http.createServer((req, res) => {
  res.writeHead(200, {'content-type': 'text/plain'});
  res.end('mineclone server ok | rooms: ' + rooms.size);
});
const wss = new WebSocketServer({server, maxPayload: 4 * 1024 * 1024});

wss.on('connection', (ws, req) => {
  if (!originOk(req.headers.origin)) { ws.close(4003, 'forbidden origin'); return; }
  if (wss.clients.size > MAX_CONNS) { ws.close(4008, 'server full'); return; }
  const client = {id: 'p' + (nextId++), ws, room: null, name: '', pos: [0, 0, 0], lastState: 0, lastBlock: 0};
  ws.isAlive = true;
  ws.on('pong', () => ws.isAlive = true);
  ws.on('message', raw => {
    if (raw.length > 4 * 1024 * 1024) return;
    let data; try { data = JSON.parse(raw); } catch (e) { return; }
    if (data && typeof data.t === 'string') try { handle(client, data); } catch (e) {}
  });
  ws.on('close', () => dropClient(client));
  ws.on('error', () => {});
});

setInterval(() => {                                // dead-connection sweep + proxy keepalive
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false; ws.ping();
  }
}, 30e3);

server.listen(PORT, () => console.log('mineclone server listening on :' + PORT));
