// QLab web remote: serves a mobile page and controls QLab over OSC/TCP (SLIP-framed).
// Commands wait for QLab's reply, so the page only shows success once QLab has confirmed it.
// Status is pushed to the page with Server-Sent Events.
// Spotify (desktop app on the same Mac) is controlled and polled via AppleScript.
const http = require('http');
const crypto = require('crypto');
const { execFile, execFileSync } = require('child_process');
const net = require('net');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { qrTerminal } = require('./qr');
const { iconPng } = require('./icon');

// --- Config: defaults <- config.json <- environment variables ---
const COLORS = {
  green: '#1f7a3a', blue: '#1f4f8a', purple: '#5b2d8a', orange: '#a0521a',
  red: '#8a1f1f', teal: '#1a6b6b', gray: '#444444',
};

// CONFIG lets you keep one file per event, e.g. CONFIG=events/gala.json npm start
const CONFIG_FILE = process.env.CONFIG ? path.resolve(process.env.CONFIG) : path.join(__dirname, 'config.json');

const MAX_CUES = 24;

// Validates one cue entry from config.json or the editor. Returns { cue } or { error }.
function normalizeCue(cue) {
  const number = String(cue?.number ?? '').trim();
  if (!number || /[\s/#*?,[\]{}]/.test(number)) {
    return { error: `Virheellinen cuenumero "${cue?.number ?? ""}" (ei välilyöntejä eikä merkkejä / # * ? , [ ] { })` };
  }
  const color = COLORS[cue.color] || (/^#[0-9a-f]{6}$/i.test(cue.color || '') ? cue.color.toLowerCase() : COLORS.green);
  const label = cue.label ? String(cue.label).slice(0, 40) : '';
  return { cue: { number, label, color, spotifyFadeOut: !!cue.spotifyFadeOut } };
}

function loadConfig() {
  const file = CONFIG_FILE;
  let fileConfig = {};
  if (process.env.CONFIG && !fs.existsSync(file)) {
    console.error(`Config file not found: ${file}`);
    process.exit(1);
  }
  if (fs.existsSync(file)) {
    try {
      fileConfig = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      console.error(`${path.basename(file)} is not valid JSON: ${err.message}`);
      process.exit(1);
    }
    console.log(`Using config: ${file}`);
  }
  const env = process.env;
  const c = {
    port: 8080,
    qlabHost: '127.0.0.1',
    qlabPort: 53000,
    qlabPasscode: '',
    pin: '',
    fadeSeconds: 2,
    fadeConfirm: false,
    playhead: false,
    spotify: true,
    spotifyFadeSeconds: 2,
    cues: [{ number: '1' }, { number: '2' }],
    ...fileConfig,
  };
  if (env.PORT) c.port = Number(env.PORT);
  if (env.QLAB_HOST) c.qlabHost = env.QLAB_HOST;
  if (env.QLAB_PORT) c.qlabPort = Number(env.QLAB_PORT);
  if (env.QLAB_PASSCODE) c.qlabPasscode = env.QLAB_PASSCODE;
  if (env.PIN) c.pin = env.PIN;
  if (env.FADE_SECONDS) c.fadeSeconds = Number(env.FADE_SECONDS);
  if (env.FADE_CONFIRM) c.fadeConfirm = env.FADE_CONFIRM === '1';
  if (env.CUES) c.cues = env.CUES.split(',').map((n) => ({ number: n.trim() }));

  c.cues = c.cues.map((entry) => {
    const { cue, error } = normalizeCue(entry);
    if (error) {
      console.error(`config: ${error}`);
      process.exit(1);
    }
    return cue;
  });
  if (!c.cues.length && !c.playhead) {
    console.error('Nothing to control: add cues to config.json or set "playhead": true');
    process.exit(1);
  }
  return c;
}

const config = loadConfig();
let cueConfig = new Map(config.cues.map((cue) => [cue.number, cue]));

// Saves the cue list from the editor into the config file, keeping the file's other settings.
// Colors that match the palette are written by name so the file stays readable.
function saveCues(cues) {
  let fileConfig = {};
  if (fs.existsSync(CONFIG_FILE)) fileConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  const colorNames = Object.fromEntries(Object.entries(COLORS).map(([name, hex]) => [hex, name]));
  fileConfig.cues = cues.map((cue) => {
    const out = { number: cue.number };
    if (cue.label) out.label = cue.label;
    out.color = colorNames[cue.color] || cue.color;
    if (cue.spotifyFadeOut) out.spotifyFadeOut = true;
    return out;
  });
  const tmp = CONFIG_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(fileConfig, null, 2) + '\n');
  fs.renameSync(tmp, CONFIG_FILE);

  config.cues = cues;
  cueConfig = new Map(cues.map((cue) => [cue.number, cue]));
  status.cues = {};
}

// Flattens QLab's nested cue lists (groups contain cues) into rows for the cue picker.
function flattenCueLists(lists) {
  const rows = [];
  const walk = (cues, depth, list) => {
    for (const cue of cues || []) {
      rows.push({ list, depth, number: cue.number || '', name: cue.listName || cue.name || '', type: cue.type });
      walk(cue.cues, depth + 1, list);
    }
  };
  for (const list of lists || []) walk(list.cues, 0, list.listName || list.name || '');
  return rows;
}

// --- OSC encoding ---
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
const PLAYHEAD_KEYS = JSON.stringify(['number', 'displayName', 'type']);

// qlab: 'offline' (no TCP connection), 'noreply' (no workspace answering), 'badpass' (wrong passcode),
// 'denied' (connection lacks permissions) or 'ok'.
const status = { qlab: 'offline', cues: {}, playhead: null, spotify: { running: false } };
let qlabSocket = null;
let lastStatusReply = 0;
let lastDenied = 0;
let badPasscode = false;
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
  if (address === '/connect') {
    badPasscode = reply.status === 'badpass' || reply.data === 'badpass';
    console.log(badPasscode ? 'QLab rejected the passcode' : 'QLab passcode accepted');
    return;
  }

  if (reply.status === 'denied') lastDenied = Date.now();

  if (address === '/cue/playhead/valuesForKeys') {
    lastStatusReply = Date.now();
    // QLab answers with an error when no cue is standing by.
    status.playhead = reply.status === 'ok' && reply.data
      ? { number: reply.data.number || '', name: reply.data.displayName || '', type: reply.data.type || '' }
      : null;
    return;
  }

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

function qlabState() {
  if (!qlabSocket) return 'offline';
  if (badPasscode) return 'badpass';
  if (Date.now() - lastDenied < STALE_MS) return 'denied';
  return Date.now() - lastStatusReply < STALE_MS ? 'ok' : 'noreply';
}

function connectQlab() {
  const sock = net.createConnection({ host: config.qlabHost, port: config.qlabPort });
  let pollTimer = null;
  const send = (address, args) => sock.write(slipEncode(encodeOsc(address, args)));

  sock.on('connect', () => {
    qlabSocket = sock;
    badPasscode = false;
    lastStatusReply = Date.now(); // grace period so the first poll isn't reported as unanswered
    console.log('Connected to QLab');
    // The passcode must come before any other message.
    if (config.qlabPasscode) send('/connect', [config.qlabPasscode]);
    // Without this QLab doesn't reply to action commands like /start and /stop.
    send('/alwaysReply', [1]);
    pollTimer = setInterval(() => {
      for (const cue of config.cues) send(`/cue/${cue.number}/valuesForKeys`, [STATUS_KEYS]);
      if (config.playhead) send('/cue/playhead/valuesForKeys', [PLAYHEAD_KEYS]);
      status.qlab = qlabState();
      if (status.qlab !== 'ok') {
        status.cues = {};
        status.playhead = null;
      }
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
    status.playhead = null;
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

function osascript(script, timeout = 3000) {
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', script], { timeout }, (err, stdout) => (err ? reject(err) : resolve(stdout.trim())));
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

// Fades Spotify to silence, pauses it and restores the original volume for the next play.
// Runs as one osascript process so the steps stay evenly timed.
let spotifyFading = false;
async function fadeOutSpotify(seconds) {
  if (spotifyFading) return;
  spotifyFading = true;
  const steps = Math.max(1, Math.round(seconds * 10));
  const script = `
if application "Spotify" is running then
  tell application "Spotify"
    if player state is playing then
      set v to sound volume
      repeat with i from 1 to ${steps}
        set sound volume to (v * (${steps} - i) / ${steps}) as integer
        delay ${(seconds / steps).toFixed(3)}
      end repeat
      pause
      set sound volume to v
    end if
  end tell
end if`;
  try {
    await osascript(script, seconds * 1000 + 5000);
    console.log(`${new Date().toLocaleTimeString()}  Spotify faded out (${seconds}s)`);
  } catch (err) {
    console.error(`Spotify fade failed: ${err.message}`);
  }
  spotifyFading = false;
  refreshSpotify();
}

if (config.spotify) {
  (async function pollSpotify() {
    await refreshSpotify();
    setTimeout(pollSpotify, SPOTIFY_POLL_MS);
  })();
} else {
  status.spotify = null;
}

// --- PIN ---
// The cookie holds a hash of the PIN, so it survives server restarts and stops working when the PIN changes.
const AUTH_COOKIE = 'qlr';
const authToken = config.pin ? crypto.createHash('sha256').update('qlab-web-remote:' + config.pin).digest('hex') : null;

function isAuthorized(req) {
  if (!authToken) return true;
  const match = /(?:^|;\s*)qlr=([0-9a-f]{64})/.exec(req.headers.cookie || '');
  return !!match && crypto.timingSafeEqual(Buffer.from(match[1]), Buffer.from(authToken));
}

function readBody(req, limit = 1024) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > limit) { reject(new Error('Body too large')); req.destroy(); }
    });
    req.on('end', () => resolve(body));
  });
}

// --- Server-Sent Events ---
const sseClients = new Set();
function broadcast(payload) {
  for (const res of sseClients) res.write(payload);
}
setInterval(() => {
  if (sseClients.size) broadcast(`data: ${JSON.stringify(status)}\n\n`);
}, POLL_MS);

// --- HTTP ---
const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'));
const log = (msg) => console.log(`${new Date().toLocaleTimeString()}  ${msg}`);

async function runQlabCommand(res, label, address, args) {
  try {
    await qlabRequest(address, args);
    log(label);
    res.writeHead(204);
    res.end();
  } catch (err) {
    log(`${label} FAILED: ${err.message}`);
    res.writeHead(err.httpStatus || 500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(err.message);
  }
}

function sendJson(res, data) {
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function sendText(res, code, text) {
  res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

const server = http.createServer(async (req, res) => {
  const { method, url } = req;

  if (method === 'GET' && url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(indexHtml);
  }

  // Home screen icon and manifest are public: the phone fetches them before any PIN is entered.
  const iconMatch = method === 'GET' && url.match(/^\/icon-(180|192|512)\.png$/);
  if (iconMatch) {
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'max-age=86400' });
    return res.end(iconPng(Number(iconMatch[1])));
  }

  if (method === 'GET' && url === '/manifest.webmanifest') {
    res.writeHead(200, { 'Content-Type': 'application/manifest+json' });
    return res.end(JSON.stringify({
      name: 'QLab Remote',
      short_name: 'QLab',
      start_url: '/',
      display: 'standalone',
      orientation: 'any',
      background_color: '#111111',
      theme_color: '#111111',
      icons: [192, 512].map((size) => ({ src: `/icon-${size}.png`, sizes: `${size}x${size}`, type: 'image/png' })),
    }));
  }

  if (method === 'POST' && url === '/login') {
    let pin = '';
    try { pin = (await readBody(req)).trim(); } catch { return sendText(res, 413, 'Too large'); }
    if (!authToken || pin === config.pin) {
      res.writeHead(204, authToken ? { 'Set-Cookie': `${AUTH_COOKIE}=${authToken}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000` } : {});
      return res.end();
    }
    // Slow down guessing.
    await new Promise((r) => setTimeout(r, 1000));
    log('Wrong PIN attempt');
    return sendText(res, 401, 'Väärä PIN');
  }

  if (!isAuthorized(req)) return sendText(res, 401, 'PIN vaaditaan');

  if (method === 'GET' && url === '/config') {
    return sendJson(res, {
      fadeSeconds: config.fadeSeconds,
      fadeConfirm: config.fadeConfirm,
      playhead: config.playhead,
      spotify: config.spotify,
      cues: config.cues,
      colors: COLORS,
      // The cue editor would be overridden on the next start if cues come from the environment.
      cuesEditable: !process.env.CUES,
    });
  }

  if (method === 'GET' && url === '/qlab/cues') {
    try {
      const reply = await qlabRequest('/cueLists');
      return sendJson(res, flattenCueLists(reply.data));
    } catch (err) {
      return sendText(res, err.httpStatus || 500, err.message);
    }
  }

  if (method === 'PUT' && url === '/config/cues') {
    if (process.env.CUES) return sendText(res, 409, 'CUES-ympäristömuuttuja ohittaa asetukset');
    let entries;
    try {
      entries = JSON.parse(await readBody(req, 64 * 1024));
    } catch {
      return sendText(res, 400, 'Virheellinen pyyntö');
    }
    if (!Array.isArray(entries) || entries.length > MAX_CUES) return sendText(res, 400, `Enintään ${MAX_CUES} cueta`);
    if (!entries.length && !config.playhead) return sendText(res, 400, 'Valitse vähintään yksi cue');
    const cues = [];
    for (const entry of entries) {
      const { cue, error } = normalizeCue(entry);
      if (error) return sendText(res, 400, error);
      if (cues.some((c) => c.number === cue.number)) return sendText(res, 400, `Cue ${cue.number} on listassa kahdesti`);
      cues.push(cue);
    }
    try {
      saveCues(cues);
    } catch (err) {
      console.error(err);
      return sendText(res, 500, 'Tallennus epäonnistui: ' + err.message);
    }
    log(`Cues saved to ${path.basename(CONFIG_FILE)}: ${cues.map((c) => c.number).join(', ') || '(none)'}`);
    broadcast('event: config\ndata: {}\n\n');
    res.writeHead(204);
    return res.end();
  }

  if (method === 'GET' && url === '/status') return sendJson(res, status);

  if (method === 'GET' && url === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(`retry: 1000\ndata: ${JSON.stringify(status)}\n\n`);
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  if (method === 'POST' && url === '/fade') {
    return runQlabCommand(res, `FADE all (${config.fadeSeconds}s)`, '/panicInTime', [config.fadeSeconds]);
  }

  if (method === 'POST' && url === '/stop') return runQlabCommand(res, 'STOP all', '/stop');

  const playheadMatch = method === 'POST' && config.playhead && url.match(/^\/playhead\/(go|next|previous)$/);
  if (playheadMatch) {
    const action = playheadMatch[1];
    if (action === 'go') {
      const cue = status.playhead ? `${status.playhead.number || '?'} ${status.playhead.name}` : '(none)';
      return runQlabCommand(res, `GO playhead ${cue}`, '/go');
    }
    return runQlabCommand(res, `Playhead ${action}`, `/playhead/${action}`);
  }

  const spotifyMatch = method === 'POST' && config.spotify && url.match(/^\/spotify\/(\w+)(?:\/(\d+))?$/);
  if (spotifyMatch) {
    const [, action, value] = spotifyMatch;
    let script;
    if (action === 'volume' && value !== undefined) script = `tell application "Spotify" to set sound volume to ${Math.min(100, Number(value))}`;
    else if (SPOTIFY_COMMANDS[action]) script = `tell application "Spotify" to ${SPOTIFY_COMMANDS[action]}`;
    if (!script) return sendText(res, 404, 'Unknown Spotify command');
    try {
      await osascript(script);
      log(`Spotify ${action}${value !== undefined ? ' ' + value : ''}`);
      refreshSpotify();
      res.writeHead(204);
      return res.end();
    } catch (err) {
      console.error(err.message);
      return sendText(res, 500, 'Spotify command failed');
    }
  }

  const cueMatch = method === 'POST' && url.match(/^\/cue\/([^/]+)\/(pause|stop|fade)$/);
  if (cueMatch) {
    const cue = decodeURIComponent(cueMatch[1]);
    if (!cueConfig.has(cue)) return sendText(res, 404, 'Unknown cue');
    const action = cueMatch[2];
    if (action === 'pause') return runQlabCommand(res, `Toggle pause cue ${cue}`, `/cue/${cue}/togglePause`);
    if (action === 'stop') return runQlabCommand(res, `STOP cue ${cue}`, `/cue/${cue}/stop`);
    return runQlabCommand(res, `FADE cue ${cue} (${config.fadeSeconds}s)`, `/cue/${cue}/panicInTime`, [config.fadeSeconds]);
  }

  const goMatch = method === 'POST' && url.match(/^\/go\/([^/]+)$/);
  if (goMatch) {
    const cue = cueConfig.get(decodeURIComponent(goMatch[1]));
    if (!cue) return sendText(res, 404, 'Unknown cue');
    // Music fades while the cue starts; waiting for the fade would feel like lag to the operator.
    if (cue.spotifyFadeOut && config.spotify && status.spotify?.state === 'playing') fadeOutSpotify(config.spotifyFadeSeconds);
    return runQlabCommand(res, `GO cue ${cue.number}`, `/cue/${cue.number}/start`);
  }

  sendText(res, 404, 'Not found');
});

// The Bonjour name (e.g. My-MacBook.local) stays the same when the Mac moves to another network.
function localHostname() {
  try {
    return execFileSync('scutil', ['--get', 'LocalHostName'], { encoding: 'utf8' }).trim() + '.local';
  } catch {
    return null;
  }
}

server.listen(config.port, '0.0.0.0', () => {
  const host = localHostname();
  const ips = Object.values(os.networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => a.address);
  const mainUrl = `http://${host || ips[0] || 'localhost'}:${config.port}`;

  console.log(`\nQLab remote running (QLab at ${config.qlabHost}:${config.qlabPort})`);
  console.log(`Cues: ${config.cues.map((c) => c.number + (c.label ? ` (${c.label})` : '')).join(', ')}`);
  if (config.playhead) console.log('Playhead mode on');
  if (config.pin) console.log('PIN required');
  console.log('\n' + qrTerminal(mainUrl));
  console.log(`\n  Open on phone: ${mainUrl}`);
  for (const ip of ips) console.log(`  or by IP:      http://${ip}:${config.port}`);
  console.log('\n  Stop with Ctrl+C\n');
});
