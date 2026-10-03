// QLab web remote: serves a mobile page and forwards button presses to QLab as OSC over UDP.
// Cue playback status is polled from QLab over OSC/TCP (SLIP-framed), since QLab always replies on TCP.
// Spotify (desktop app on the same Mac) is controlled and polled via AppleScript.
const http = require('http');
const { execFile } = require('child_process');
const dgram = require('dgram');
const net = require('net');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = Number(process.env.PORT) || 8080;
const QLAB_HOST = process.env.QLAB_HOST || '127.0.0.1';
const QLAB_PORT = Number(process.env.QLAB_PORT) || 53000;
const FADE_SECONDS = Number(process.env.FADE_SECONDS) || 2;
const ALLOWED_CUES = (process.env.CUES || '1,2').split(',').map((c) => c.trim());

const udp = dgram.createSocket('udp4');

function oscString(str) {
  const buf = Buffer.from(str + '\0');
  const padded = Buffer.alloc(Math.ceil(buf.length / 4) * 4);
  buf.copy(padded);
  return padded;
}

function oscFloat(n) {
  const buf = Buffer.alloc(4);
  buf.writeFloatBE(n);
  return buf;
}

// Args may be strings (OSC 's') or numbers (OSC 'f').
function encodeOsc(address, args = []) {
  const tags = ',' + args.map((a) => (typeof a === 'number' ? 'f' : 's')).join('');
  return Buffer.concat([oscString(address), oscString(tags), ...args.map((a) => (typeof a === 'number' ? oscFloat(a) : oscString(a)))]);
}

function sendOsc(address, args) {
  const msg = encodeOsc(address, args);
  return new Promise((resolve, reject) => {
    udp.send(msg, QLAB_PORT, QLAB_HOST, (err) => (err ? reject(err) : resolve()));
  });
}

// Minimal OSC decoder: address plus string/int/float args (enough for QLab JSON replies).
function decodeOsc(buf) {
  let pos = 0;
  const readString = () => {
    const end = buf.indexOf(0, pos);
    const str = buf.toString('utf8', pos, end);
    pos = Math.ceil((end + 1) / 4) * 4;
    return str;
  };
  const address = readString();
  const tags = pos < buf.length ? readString() : ',';
  const args = [];
  for (const t of tags.slice(1)) {
    if (t === 's') args.push(readString());
    else if (t === 'i') { args.push(buf.readInt32BE(pos)); pos += 4; }
    else if (t === 'f') { args.push(buf.readFloatBE(pos)); pos += 4; }
  }
  return { address, args };
}

// SLIP framing (OSC 1.1 over TCP).
const SLIP_END = 0xc0, SLIP_ESC = 0xdb, SLIP_ESC_END = 0xdc, SLIP_ESC_ESC = 0xdd;

function slipEncode(buf) {
  const out = [SLIP_END];
  for (const b of buf) {
    if (b === SLIP_END) out.push(SLIP_ESC, SLIP_ESC_END);
    else if (b === SLIP_ESC) out.push(SLIP_ESC, SLIP_ESC_ESC);
    else out.push(b);
  }
  out.push(SLIP_END);
  return Buffer.from(out);
}

function slipDecoder(onPacket) {
  let bytes = [];
  let escaped = false;
  return (chunk) => {
    for (const b of chunk) {
      if (escaped) {
        bytes.push(b === SLIP_ESC_END ? SLIP_END : b === SLIP_ESC_ESC ? SLIP_ESC : b);
        escaped = false;
      } else if (b === SLIP_ESC) escaped = true;
      else if (b === SLIP_END) {
        if (bytes.length) onPacket(Buffer.from(bytes));
        bytes = [];
      } else bytes.push(b);
    }
  };
}

// --- Status polling ---
const POLL_MS = 250;
const STATUS_KEYS = JSON.stringify(['displayName', 'isRunning', 'isPaused', 'duration', 'actionElapsed']);
const status = { connected: false, cues: {}, spotify: { running: false } };

function connectQlab() {
  const sock = net.createConnection({ host: QLAB_HOST, port: QLAB_PORT });
  let pollTimer = null;

  sock.on('connect', () => {
    status.connected = true;
    console.log('Connected to QLab for status');
    pollTimer = setInterval(() => {
      for (const cue of ALLOWED_CUES) sock.write(slipEncode(encodeOsc(`/cue/${cue}/valuesForKeys`, [STATUS_KEYS])));
    }, POLL_MS);
  });

  sock.on('data', slipDecoder((packet) => {
    let reply;
    try {
      const { args } = decodeOsc(packet);
      reply = JSON.parse(args[0]);
    } catch {
      return;
    }
    const m = /^\/cue\/([^/]+)\/valuesForKeys$/.exec(reply.address || '');
    if (!m) return;
    const cue = m[1];
    if (reply.status !== 'ok' || !reply.data) {
      status.cues[cue] = { found: false };
      return;
    }
    const d = reply.data;
    status.cues[cue] = {
      found: true,
      name: d.displayName,
      running: !!d.isRunning,
      paused: !!d.isPaused,
      duration: Number(d.duration) || 0,
      elapsed: Number(d.actionElapsed) || 0,
    };
  }));

  sock.on('error', () => {});
  sock.on('close', () => {
    clearInterval(pollTimer);
    if (status.connected) console.log('QLab status connection lost, retrying...');
    status.connected = false;
    status.cues = {};
    setTimeout(connectQlab, 2000);
  });
}

connectQlab();

// --- Spotify ---
const SPOTIFY_POLL_MS = 1000;
const SPOTIFY_COMMANDS = { playpause: 'playpause', next: 'next track', previous: 'previous track' };

function osascript(script) {
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', script], { timeout: 3000 }, (err, stdout) => (err ? reject(err) : resolve(stdout.trim())));
  });
}

// Position is converted to integer ms in AppleScript so the output doesn't depend on the locale's decimal separator.
const SPOTIFY_STATUS_SCRIPT = `
if application "Spotify" is running then
  tell application "Spotify"
    set d to "|"
    return (player state as string) & d & (sound volume) & d & ((player position * 1000) as integer) & d & (duration of current track) & d & (artist of current track) & d & (name of current track)
  end tell
end if
return ""`;

async function refreshSpotify() {
  try {
    const out = await osascript(SPOTIFY_STATUS_SCRIPT);
    if (!out) {
      status.spotify = { running: false };
    } else {
      const [state, volume, positionMs, durationMs, artist, ...name] = out.split('|');
      status.spotify = {
        running: true,
        state,
        volume: Number(volume),
        position: Number(positionMs) / 1000,
        duration: Number(durationMs) / 1000,
        artist,
        name: name.join('|'),
      };
    }
  } catch {
    status.spotify = { running: false };
  }
}

(async function pollSpotify() {
  await refreshSpotify();
  setTimeout(pollSpotify, SPOTIFY_POLL_MS);
})();

const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'));

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(indexHtml);
  }

  if (req.method === 'GET' && req.url === '/cues') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(ALLOWED_CUES));
  }

  if (req.method === 'GET' && req.url === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify(status));
  }

  if (req.method === 'POST' && req.url === '/fade') {
    try {
      await sendOsc('/panicInTime', [FADE_SECONDS]);
      console.log(`${new Date().toLocaleTimeString()}  FADE all (${FADE_SECONDS}s)`);
      res.writeHead(204);
      return res.end();
    } catch (err) {
      console.error(err);
      res.writeHead(500);
      return res.end('OSC send failed');
    }
  }

  if (req.method === 'GET' && req.url === '/config') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ fadeSeconds: FADE_SECONDS }));
  }

  if (req.method === 'POST' && req.url === '/stop') {
    try {
      await sendOsc('/stop');
      console.log(`${new Date().toLocaleTimeString()}  STOP all`);
      res.writeHead(204);
      return res.end();
    } catch (err) {
      console.error(err);
      res.writeHead(500);
      return res.end('OSC send failed');
    }
  }

  const spotifyMatch = req.method === 'POST' && req.url.match(/^\/spotify\/(\w+)(?:\/(\d+))?$/);
  if (spotifyMatch) {
    const [, action, value] = spotifyMatch;
    let script;
    if (action === 'volume' && value !== undefined) script = `tell application "Spotify" to set sound volume to ${Math.min(100, Number(value))}`;
    else if (SPOTIFY_COMMANDS[action]) script = `tell application "Spotify" to ${SPOTIFY_COMMANDS[action]}`;
    if (!script) {
      res.writeHead(404);
      return res.end('Unknown Spotify command');
    }
    try {
      await osascript(script);
      console.log(`${new Date().toLocaleTimeString()}  Spotify ${action}${value !== undefined ? ' ' + value : ''}`);
      refreshSpotify();
      res.writeHead(204);
      return res.end();
    } catch (err) {
      console.error(err.message);
      res.writeHead(500);
      return res.end('Spotify command failed');
    }
  }

  const match = req.method === 'POST' && req.url.match(/^\/go\/([^/]+)$/);
  if (match) {
    const cue = decodeURIComponent(match[1]);
    if (!ALLOWED_CUES.includes(cue)) {
      res.writeHead(404);
      return res.end('Unknown cue');
    }
    try {
      await sendOsc(`/cue/${cue}/start`);
      console.log(`${new Date().toLocaleTimeString()}  GO cue ${cue}`);
      res.writeHead(204);
      return res.end();
    } catch (err) {
      console.error(err);
      res.writeHead(500);
      return res.end('OSC send failed');
    }
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`QLab remote running. Sending OSC to ${QLAB_HOST}:${QLAB_PORT}`);
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) console.log(`  Open on phone: http://${a.address}:${PORT}`);
    }
  }
});
