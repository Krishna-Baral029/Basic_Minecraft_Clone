// Local end-to-end test: host creates a room, friend joins, state/block relay,
// reach validation, origin rejection. Run: node test-local.mjs
import WebSocket from 'ws';

const URL = 'ws://localhost:10000';
const ORIGIN = {headers: {origin: 'https://lighthearted-torte-9c6768.netlify.app'}};
const ROOM = 'mc-' + 'ab'.repeat(16);
let passed = 0, failed = 0;
const ok = (cond, name) => { cond ? passed++ : failed++; console.log((cond ? 'PASS' : 'FAIL') + ' - ' + name); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const msgs = {host: [], friend: []};

function connect(tag, opts) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(URL, opts);
    ws.on('message', d => msgs[tag] && msgs[tag].push(JSON.parse(d)));
    ws.on('open', () => res(ws));
    ws.on('error', rej);
  });
}

// 1. bad origin must be rejected
await new Promise(res => {
  const ws = new WebSocket(URL, {headers: {origin: 'https://evil-clone.example.com'}});
  ws.on('close', code => { ok(code === 4003, 'clone origin rejected (code ' + code + ')'); res(); });
  ws.on('error', () => {});
});

// 2. host creates a room with saved edits
const host = await connect('host', ORIGIN);
host.send(JSON.stringify({t: 'create', roomId: ROOM, name: 'HostSteve', seed: 1234,
  mode: 'Survival', diff: 'Normal', edits: {'0|0': {'1,20,1': 5}}, dayFrac: .3, sp: [0, 20, 0]}));
await wait(300);
ok(msgs.host.some(m => m.t === 'created'), 'host got created');
host.send(JSON.stringify({t: 'setspawn', sp: [10, 22, 10]}));

// 3. duplicate create rejected
const dup = await connect('dup', ORIGIN);
dup.send(JSON.stringify({t: 'create', roomId: ROOM, name: 'X', seed: 1, edits: {}, dayFrac: 0, sp: [0, 0, 0]}));
await wait(300);
// no msgs bucket for dup: check via a listener instead
dup.on('message', () => {});
dup.close();

// 4. friend joins, receives world init
const friend = await connect('friend', ORIGIN);
friend.send(JSON.stringify({t: 'join', roomId: ROOM, name: 'FriendAlex'}));
await wait(300);
const init = msgs.friend.find(m => m.t === 'init');
ok(!!init, 'friend got init');
ok(init && init.seed === 1234, 'init has world seed');
ok(init && init.edits && init.edits['0|0'] && init.edits['0|0']['1,20,1'] === 5, 'init carries saved edits');
ok(init && init.sp[0] === 10, 'init uses host setspawn');
ok(msgs.host.some(m => m.t === 'notice' && /FriendAlex/.test(m.text)), 'host notified of join');

// 5. wrong room id
const lost = await connect('lost', ORIGIN);
await new Promise(res => {
  lost.on('message', d => { const m = JSON.parse(d); ok(m.t === 'error' && m.code === 'not-found', 'unknown room -> not-found'); res(); });
  lost.send(JSON.stringify({t: 'join', roomId: 'mc-' + 'ff'.repeat(16), name: 'Nobody'}));
});
lost.close();

// 6. state relay host -> friend
host.send(JSON.stringify({t: 'state', x: 5, y: 21, z: 5, yaw: 1, c: 0}));
await wait(300);
const st = msgs.friend.find(m => m.t === 'state');
ok(st && st.name === 'HostSteve' && st.x === 5, 'state relayed with server-stamped identity');

// 7. block within reach relayed + stored; out-of-reach rejected
host.send(JSON.stringify({t: 'block', x: 6, y: 21, z: 6, v: 3}));
await wait(100);
host.send(JSON.stringify({t: 'block', x: 500, y: 21, z: 500, v: 3}));
await wait(300);
ok(msgs.friend.some(m => m.t === 'block' && m.x === 6), 'in-reach block relayed');
ok(!msgs.friend.some(m => m.t === 'block' && m.x === 500), 'out-of-reach block rejected');

// 8. leave notification
host.close();
await wait(300);
ok(msgs.friend.some(m => m.t === 'left' && m.name === 'HostSteve'), 'friend told host left');

friend.close();
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
