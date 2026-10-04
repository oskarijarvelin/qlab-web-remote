// QLab web remote: serves a mobile page and controls QLab over OSC/TCP (SLIP-framed).
// Commands wait for QLab's reply, so the page only shows success once QLab has confirmed it.
// Spotify (desktop app on the same Mac) is controlled and polled via AppleScript.
const http = require('http');
const { execFile, execFileSync } = require('child_process');
const net = require('net');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { qrTerminal } = require('./qr');

const PORT = Number(process.env.PORT) || 8080;
const QLAB_HOST = process.env.QLAB_HOST || '127.0.0.1';
const QLAB_PORT = Number(process.env.QLAB_PORT) || 53000;
const FADE_SECONDS = Number(process.env.FADE_SECONDS) || 2;
const FADE_CONFIRM = process.env.FADE_CONFIRM === '1';
const ALLOWED_CUES = (process.env.CUES || '1,2').split(',').map((c) => c.trim());

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

// --- QLab connection ---
const POLL_MS = 250;
const COMMAND_TIMEOUT_MS = 1000;
// If status polls go unanswered this long, QLab is reachable but not responding (e.g. no workspace open).
const STALE_MS = 2000;
const STATUS_KEYS = JSON.stringify(['displayName', 'isRunning', 'isPaused', 'duration', 'actionElapsed']);

// qlab: 'offline' (no TCP connection), 'noreply' (connected, no workspace answering) or 'ok'.
const status = { qlab: 'offline', cues: {}, spotify: { running: false } };
let qlabSocket = null;
let lastStatusReply = 0;
// Pending command replies keyed by the OSC address that was sent; QLab replies to /x on /reply/x.
const pending = new Map();

class QlabError extends Error {
  constructor(message, httpStatus) {
    super(message);
    this.httpStatus = httpStatus;
  }
}

function qlabRequest(address, args) {
  if (!qlabSocket) return Promise.reject(new QlabError('Ei yhteyttä QLabiin', 503));
  return new Promise((resolve, reject) => {
    const entry = { resolve, reject };
    entry.timer = setTimeout(() => {
      pending.get(address).splice(pending.get(address).indexOf(entry), 1);
      reject(new QlabError('QLab ei vastannut', 504));
    }, COMMAND_TIMEOUT_MS);
    if (!pending.has(address)) pending.set(address, []);
    pending.get(address).push(entry);
    qlabSocket.write(slipEncode(encodeOsc(address, args)));
  });
}

function handleReply(address, reply) {
  const cueStatus = /^\/cue\/([^/]+)\/valuesForKeys$/.exec(address);
  if (cueStatus) {
    lastStatusReply = Date.now();
    const cue = cueStatus[1];
    const d = reply.data;
    status.cues[cue] = reply.status === 'ok' && d
      ? {
          found: true,
          name: d.displayName,
          running: !!d.isRunning,
          paused: !!d.isPaused,
          duration: Number(d.duration) || 0,
          elapsed: Number(d.actionElapsed) || 0,
        }
      : { found: false };
    return;
  }

  const entry = pending.get(address)?.shift();
  if (!entry) return;
  clearTimeout(entry.timer);
  if (reply.status === 'ok') entry.resolve(reply);
  else if (reply.status === 'denied') entry.reject(new QlabError('QLab esti komennon (passcode?)', 502));
  else entry.reject(new QlabError('QLab: virhe (onko cue olemassa?)', 502));
}

function connectQlab() {
  const sock = net.createConnection({ host: QLAB_HOST, port: QLAB_PORT });
  let pollTimer = null;

  sock.on('connect', () => {
    qlabSocket = sock;
    lastStatusReply = Date.now(); // grace period so the first poll isn't reported as unanswered
    console.log('Connected to QLab');
    // Without this QLab doesn't reply to action commands like /start and /stop.
    sock.write(slipEncode(encodeOsc('/alwaysReply', [1])));
    pollTimer = setInterval(() => {
      for (const cue of ALLOWED_CUES) sock.write(slipEncode(encodeOsc(`/cue/${cue}/valuesForKeys`, [STATUS_KEYS])));
      status.qlab = Date.now() - lastStatusReply < STALE_MS ? 'ok' : 'noreply';
      if (status.qlab === 'noreply') status.cues = {};
    }, POLL_MS);
  });

  sock.on('data', slipDecoder((packet) => {
    try {
      const { address, args } = decodeOsc(packet);
      if (address.startsWith('/reply/')) handleReply(address.slice('/reply'.length), JSON.parse(args[0]));
    } catch {
      // Ignore malformed packets.
    }
  }));

  sock.on('error', () => {});
  sock.on('close', () => {
    clearInterval(pollTimer);
    if (qlabSocket === sock) console.log('QLab connection lost, retrying...');
    qlabSocket = null;
    status.qlab = 'offline';
    status.cues = {};
    for (const entries of pending.values()) {
      for (const entry of entries) {
        clearTimeout(entry.timer);
        entry.reject(new QlabError('Yhteys QLabiin katkesi', 503));
      }
    }
    pending.clear();
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

// --- HTTP ---
const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'));

async function runQlabCommand(res, label, address, args) {
  try {
    await qlabRequest(address, args);
    console.log(`${new Date().toLocaleTimeString()}  ${label}`);
    res.writeHead(204);
    res.end();
  } catch (err) {
    console.error(`${new Date().toLocaleTimeString()}  ${label} FAILED: ${err.message}`);
    res.writeHead(err.httpStatus || 500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(err.message);
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(indexHtml);
  }

  if (req.method === 'GET' && req.url === '/cues') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(ALLOWED_CUES));
  }

  if (req.method === 'GET' && req.url === '/config') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ fadeSeconds: FADE_SECONDS, fadeConfirm: FADE_CONFIRM }));
  }

  if (req.method === 'GET' && req.url === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify(status));
  }

  if (req.method === 'POST' && req.url === '/fade') {
    return runQlabCommand(res, `FADE all (${FADE_SECONDS}s)`, '/panicInTime', [FADE_SECONDS]);
  }

  if (req.method === 'POST' && req.url === '/stop') {
    return runQlabCommand(res, 'STOP all', '/stop');
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
    return runQlabCommand(res, `GO cue ${cue}`, `/cue/${cue}/start`);
  }

  res.writeHead(404);
  res.end('Not found');
});

// The Bonjour name (e.g. My-MacBook.local) stays the same when the Mac moves to another network.
function localHostname() {
  try {
    return execFileSync('scutil', ['--get', 'LocalHostName'], { encoding: 'utf8' }).trim() + '.local';
  } catch {
    return null;
  }
}

server.listen(PORT, '0.0.0.0', () => {
  const host = localHostname();
  const ips = Object.values(os.networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => a.address);
  const mainUrl = `http://${host || ips[0] || 'localhost'}:${PORT}`;

  console.log(`\nQLab remote running (QLab at ${QLAB_HOST}:${QLAB_PORT})\n`);
  console.log(qrTerminal(mainUrl));
  console.log(`\n  Open on phone: ${mainUrl}`);
  for (const ip of ips) console.log(`  or by IP:      http://${ip}:${PORT}`);
  console.log('\n  Stop with Ctrl+C\n');
});
