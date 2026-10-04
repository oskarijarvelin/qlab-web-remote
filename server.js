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
    qlabWorkspace: '',
    pin: '',
    fadeSeconds: 2,
    fadeConfirm: false,
    playhead: false,
    spotify: true,
    spotifyFadeSeconds: 2,
    macVolume: true,
    backup: null,
    cues: [{ number: '1' }, { number: '2' }],
    ...fileConfig,
  };
  if (env.PORT) c.port = Number(env.PORT);
  if (env.QLAB_HOST) c.qlabHost = env.QLAB_HOST;
  if (env.QLAB_PORT) c.qlabPort = Number(env.QLAB_PORT);
  if (env.QLAB_PASSCODE) c.qlabPasscode = env.QLAB_PASSCODE;
  if (env.QLAB_WORKSPACE) c.qlabWorkspace = env.QLAB_WORKSPACE;
  if (env.QLAB_BACKUP_HOST) c.backup = { ...(c.backup || {}), host: env.QLAB_BACKUP_HOST };

  // Backup QLab: same workspace and passcode as the main one unless given separately.
  if (c.backup) {
    if (!c.backup.host) {
      console.error('config: backup needs a host, e.g. "backup": { "host": "192.168.1.21" }');
      process.exit(1);
    }
    c.backup = {
      host: String(c.backup.host),
      port: Number(c.backup.port) || 53000,
      workspace: c.backup.workspace ?? c.qlabWorkspace,
      passcode: c.backup.passcode ?? c.qlabPasscode,
    };
  }
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
  for (const q of [main, backup]) if (q) q.cues = {};
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
// Open workspaces are re-checked every this many polls (2 s), to notice one being opened or closed.
const WORKSPACE_CHECK_EVERY = 8;
// Main and backup may briefly disagree right after a command; only report a difference this old.
const SYNC_GRACE_MS = 1500;
const STATUS_KEYS = JSON.stringify(['displayName', 'isRunning', 'isPaused', 'duration', 'actionElapsed']);
const PLAYHEAD_KEYS = JSON.stringify(['number', 'displayName', 'type']);
// Messages addressed to QLab itself rather than to a workspace; never prefixed with /workspace/{id}.
const APP_LEVEL = new Set(['/alwaysReply', '/workspaces', '/version']);

// Pushed to every page. qlab/cues/playhead/workspace come from the QLab currently shown (the main
// machine, or the backup if the main one stops answering). qlab is one of: 'offline' (no TCP
// connection), 'noworkspace' (the configured workspace isn't open), 'noreply' (no workspace
// answering), 'badpass' (wrong passcode), 'denied' (no permissions) or 'ok'.
// lastCommand: the most recent command from any phone, so every phone can show who did what.
const status = {
  qlab: 'offline', cues: {}, playhead: null, workspace: { name: null, open: [] },
  backup: null, mac: null, spotify: { running: false }, lastCommand: null,
};

class QlabError extends Error {
  constructor(message, httpStatus) {
    super(message);
    this.httpStatus = httpStatus;
  }
}

// One OSC/TCP connection to a QLab, with its own polled cue state.
class QlabConnection {
  constructor({ label, host, port, workspace, passcode }) {
    Object.assign(this, { label, host, port, workspace, passcode });
    this.socket = null;
    this.pending = new Map(); // command replies keyed by the address sent (without workspace prefix)
    this.workspaceId = null; // uniqueID of `workspace`, once found among the open ones
    this.lastStatusReply = 0;
    this.lastDenied = 0;
    this.badPasscode = false;
    this.state = 'offline';
    this.cues = {};
    this.playhead = null;
    this.ws = { name: null, open: [] };
    this.connect();
  }

  log(msg) {
    log(backup ? `[${this.label}] ${msg}` : msg);
  }

  // Without a workspace setting, messages go to every open workspace (QLab 5 behaviour). With it,
  // they are addressed to that one workspace by its unique ID (display names may contain spaces).
  addressFor(address) {
    if (!this.workspace || APP_LEVEL.has(address)) return address;
    return `/workspace/${this.workspaceId}${address}`;
  }

  send(address, args) {
    this.socket?.write(slipEncode(encodeOsc(this.addressFor(address), args)));
  }

  request(address, args) {
    if (!this.socket) return Promise.reject(new QlabError('Ei yhteyttä QLabiin', 503));
    if (this.workspace && !this.workspaceId) {
      return Promise.reject(new QlabError(`Workspace "${this.workspace}" ei ole auki QLabissa`, 503));
    }
    return new Promise((resolve, reject) => {
      const entry = { resolve, reject };
      entry.timer = setTimeout(() => {
        this.pending.get(address).splice(this.pending.get(address).indexOf(entry), 1);
        reject(new QlabError('QLab ei vastannut', 504));
      }, COMMAND_TIMEOUT_MS);
      if (!this.pending.has(address)) this.pending.set(address, []);
      this.pending.get(address).push(entry);
      this.send(address, args);
    });
  }

  // Matches the workspace setting against an open workspace's unique ID or display name ("Gala" or "Gala.qlab5").
  findWorkspace(list) {
    const plain = (name) => String(name || '').toLowerCase().replace(/\.qlab5$/, '');
    const want = plain(this.workspace);
    return list.find((w) => plain(w.uniqueID) === want || plain(w.displayName) === want) || null;
  }

  handleWorkspaces(list) {
    this.ws.open = list.map((w) => w.displayName);
    if (!this.workspace) {
      this.ws.name = list.length === 1 ? list[0].displayName : null;
      return;
    }
    const ws = this.findWorkspace(list);
    this.ws.name = ws ? ws.displayName : null;
    if ((ws?.uniqueID || null) === this.workspaceId) return;

    this.workspaceId = ws?.uniqueID || null;
    this.cues = {};
    this.playhead = null;
    this.badPasscode = false;
    if (ws) {
      this.log(`Workspace: ${ws.displayName}`);
      this.lastStatusReply = Date.now(); // grace period for the first polls
      if (this.passcode) this.send('/connect', [this.passcode]);
    } else {
      this.log(`Workspace "${this.workspace}" is not open (open: ${this.ws.open.join(', ') || 'none'})`);
    }
  }

  handleReply(address, reply) {
    if (address === '/workspaces') return this.handleWorkspaces(Array.isArray(reply.data) ? reply.data : []);

    if (address === '/connect') {
      this.badPasscode = reply.status === 'badpass' || reply.data === 'badpass';
      this.log(this.badPasscode ? 'QLab rejected the passcode' : 'QLab passcode accepted');
      return;
    }

    if (reply.status === 'denied') this.lastDenied = Date.now();

    if (address === '/cue/playhead/valuesForKeys') {
      this.lastStatusReply = Date.now();
      // QLab answers with an error when no cue is standing by.
      this.playhead = reply.status === 'ok' && reply.data
        ? { number: reply.data.number || '', name: reply.data.displayName || '', type: reply.data.type || '' }
        : null;
      return;
    }

    const cueStatus = /^\/cue\/([^/]+)\/valuesForKeys$/.exec(address);
    if (cueStatus) {
      this.lastStatusReply = Date.now();
      const d = reply.data;
      this.cues[cueStatus[1]] = reply.status === 'ok' && d
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

    const entry = this.pending.get(address)?.shift();
    if (!entry) return;
    clearTimeout(entry.timer);
    if (reply.status === 'ok') entry.resolve(reply);
    else if (reply.status === 'denied') entry.reject(new QlabError('QLab esti komennon (passcode?)', 502));
    else entry.reject(new QlabError('QLab: virhe (onko cue olemassa?)', 502));
  }

  computeState() {
    if (!this.socket) return 'offline';
    if (this.workspace && !this.workspaceId) return 'noworkspace';
    if (this.badPasscode) return 'badpass';
    if (Date.now() - this.lastDenied < STALE_MS) return 'denied';
    return Date.now() - this.lastStatusReply < STALE_MS ? 'ok' : 'noreply';
  }

  connect() {
    const sock = net.createConnection({ host: this.host, port: this.port });
    let pollTimer = null;

    sock.on('connect', () => {
      this.socket = sock;
      this.badPasscode = false;
      this.workspaceId = null;
      this.lastStatusReply = Date.now(); // grace period so the first poll isn't reported as unanswered
      this.log(`Connected to QLab at ${this.host}:${this.port}`);
      // The passcode must come before any other message to the workspace. With a workspace setting
      // it is sent once that workspace has been found (see handleWorkspaces).
      if (this.passcode && !this.workspace) this.send('/connect', [this.passcode]);
      // Without this QLab doesn't reply to action commands like /start and /stop.
      this.send('/alwaysReply', [1]);
      this.send('/workspaces');
      let tick = 0;
      pollTimer = setInterval(() => {
        if (++tick % WORKSPACE_CHECK_EVERY === 0) this.send('/workspaces');
        if (!this.workspace || this.workspaceId) {
          for (const cue of config.cues) this.send(`/cue/${cue.number}/valuesForKeys`, [STATUS_KEYS]);
          if (config.playhead) this.send('/cue/playhead/valuesForKeys', [PLAYHEAD_KEYS]);
        }
        this.state = this.computeState();
        if (this.state !== 'ok') {
          this.cues = {};
          this.playhead = null;
        }
      }, POLL_MS);
    });

    sock.on('data', slipDecoder((packet) => {
      try {
        const { address, args } = decodeOsc(packet);
        if (!address.startsWith('/reply/')) return;
        const reply = JSON.parse(args[0]);
        let replyTo = address.slice('/reply'.length);
        // Replies to workspace-addressed messages carry the same /workspace/{id} prefix.
        const prefixed = /^\/workspace\/([^/]+)(\/.*)$/.exec(replyTo);
        if (prefixed) replyTo = prefixed[2];
        // With a target workspace, ignore anything another workspace says.
        if (this.workspaceId && reply.workspace_id && reply.workspace_id !== this.workspaceId) return;
        this.handleReply(replyTo, reply);
      } catch {
        // Ignore malformed packets.
      }
    }));

    sock.on('error', () => {});
    sock.on('close', () => {
      clearInterval(pollTimer);
      if (this.socket === sock) this.log('QLab connection lost, retrying...');
      this.socket = null;
      this.workspaceId = null;
      this.state = 'offline';
      this.cues = {};
      this.playhead = null;
      this.ws = { name: null, open: [] };
      for (const entries of this.pending.values()) {
        for (const entry of entries) {
          clearTimeout(entry.timer);
          entry.reject(new QlabError('Yhteys QLabiin katkesi', 503));
        }
      }
      this.pending.clear();
      setTimeout(() => this.connect(), 2000);
    });
  }
}

const main = new QlabConnection({
  label: 'pääkone', host: config.qlabHost, port: config.qlabPort, workspace: config.qlabWorkspace, passcode: config.qlabPasscode,
});
const backup = config.backup ? new QlabConnection({ label: 'varakone', ...config.backup }) : null;

// The QLab whose state is shown: the main machine, or the backup while the main one is down.
function activeQlab() {
  if (backup && main.state !== 'ok' && backup.state === 'ok') return backup;
  return main;
}

// Compares what main and backup are doing, so a backup that has drifted out of step is noticed
// before it is needed. A difference has to last SYNC_GRACE_MS to count.
let syncMismatchSince = null;
function checkSync() {
  if (main.state !== 'ok' || backup.state !== 'ok') { syncMismatchSince = null; return null; }
  const describe = (c) => (!c?.found ? 'puuttuu' : c.paused ? 'tauolla' : c.running ? 'soi' : 'ei soi');
  let reason = null;
  for (const cue of config.cues) {
    const a = describe(main.cues[cue.number]);
    const b = describe(backup.cues[cue.number]);
    if (a !== b) { reason = `Cue ${cue.number}: pääkoneella ${a}, varakoneella ${b}`; break; }
  }
  if (!reason && config.playhead && (main.playhead?.number || '') !== (backup.playhead?.number || '')) {
    reason = `Playhead: pääkoneella ${main.playhead?.number || '–'}, varakoneella ${backup.playhead?.number || '–'}`;
  }
  if (!reason) { syncMismatchSince = null; return null; }
  syncMismatchSince ??= Date.now();
  return Date.now() - syncMismatchSince >= SYNC_GRACE_MS ? reason : null;
}

function updateStatus() {
  const q = activeQlab();
  status.qlab = q.state;
  status.cues = q.cues;
  status.playhead = q.playhead;
  status.workspace = q.ws;
  status.backup = backup && {
    active: q === backup, // the main machine is down and the backup is being shown
    main: main.state,
    backup: backup.state,
    host: backup.host,
    outOfSync: checkSync(),
  };
}

// Sends a command to the main QLab and the backup at the same time. Succeeds if at least one of
// them confirmed it; the other's failure is returned as a warning for the status line.
async function qlabCommandAll(address, args) {
  const targets = backup ? [main, backup] : [main];
  const results = await Promise.allSettled(targets.map((q) => q.request(address, args)));
  const failures = results
    .map((r, i) => (r.status === 'rejected' ? { q: targets[i], err: r.reason } : null))
    .filter(Boolean);
  if (!backup) {
    if (failures.length) throw failures[0].err;
    return null;
  }
  const describe = ({ q, err }) => `${q === main ? 'Pääkone' : 'Varakone'}: ${err.message}`;
  if (failures.length === targets.length) throw new QlabError(failures.map(describe).join(' · '), failures[0].err.httpStatus || 502);
  return failures.length ? failures.map(describe).join(' · ') : null;
}

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

// --- Mac output volume ---
// macOS volume of the default output device. "missing value" means the device (e.g. many audio
// interfaces) has no software volume, so the slider is shown disabled.
const MAC_STATUS_SCRIPT = `
set s to get volume settings
return (output volume of s as string) & "|" & (output muted of s as string)`;

async function refreshMac() {
  try {
    const [volume, muted] = (await osascript(MAC_STATUS_SCRIPT)).split('|');
    status.mac = { volume: /^\d+$/.test(volume) ? Number(volume) : null, muted: muted === 'true' };
  } catch {
    status.mac = null;
  }
}

if (config.macVolume) {
  (async function pollMac() {
    await refreshMac();
    setTimeout(pollMac, SPOTIFY_POLL_MS);
  })();
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
  updateStatus();
  if (sseClients.size) broadcast(`data: ${JSON.stringify(status)}\n\n`);
}, POLL_MS);

// --- HTTP ---
const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'));
const log = (msg) => console.log(`${new Date().toLocaleTimeString()}  ${msg}`);

// Which phone sent a request: the name the user gave it on the page (X-Device), or a guess from the
// browser and the last part of its IP address, e.g. "iPhone (.42)". X-Device-Id lets a phone
// recognise its own commands.
function deviceOf(req) {
  let name = '';
  try { name = decodeURIComponent(String(req.headers['x-device'] || '')).trim().slice(0, 40); } catch { /* bad encoding */ }
  if (!name) {
    const ua = req.headers['user-agent'] || '';
    const kind = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android'
      : /Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Selain';
    const ip = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
    name = ip === '127.0.0.1' || ip === '::1' ? `${kind} (tämä kone)` : `${kind} (.${ip.split(/[.:]/).pop()})`;
  }
  return { name, id: String(req.headers['x-device-id'] || '').slice(0, 40) };
}

// warning: the command went through, but something is worth knowing (e.g. the backup didn't confirm).
function recordCommand(req, text, error, warning) {
  const device = deviceOf(req);
  status.lastCommand = { text, device: device.name, deviceId: device.id, at: Date.now(), ok: !error, error: error || null, warning: warning || null };
  log(`${text} [${device.name}]${error ? ' FAILED: ' + error : ''}${warning ? ' WARNING: ' + warning : ''}`);
}

async function runQlabCommand(req, res, text, address, args) {
  try {
    const warning = await qlabCommandAll(address, args);
    recordCommand(req, text, null, warning);
    res.writeHead(204);
    res.end();
  } catch (err) {
    recordCommand(req, text, err.message);
    res.writeHead(err.httpStatus || 500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(err.message);
  }
}

// "GO 1 · Intro" for messages shown to people.
const cueText = (cue) => `${cue.number}${cue.label ? ' · ' + cue.label : ''}`;

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
      macVolume: config.macVolume,
      backup: !!config.backup,
      workspace: config.qlabWorkspace || null,
      cues: config.cues,
      colors: COLORS,
      // The cue editor would be overridden on the next start if cues come from the environment.
      cuesEditable: !process.env.CUES,
    });
  }

  if (method === 'GET' && url === '/qlab/cues') {
    try {
      const reply = await activeQlab().request('/cueLists');
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
    recordCommand(req, 'Napit päivitetty');
    broadcast('event: config\ndata: {}\n\n');
    res.writeHead(204);
    return res.end();
  }

  if (method === 'GET' && url === '/status') {
    updateStatus();
    return sendJson(res, status);
  }

  if (method === 'GET' && url === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(`retry: 1000\ndata: ${JSON.stringify(status)}\n\n`);
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  if (method === 'POST' && url === '/fade') {
    return runQlabCommand(req, res, `FADE kaikki (${config.fadeSeconds} s)`, '/panicInTime', [config.fadeSeconds]);
  }

  if (method === 'POST' && url === '/stop') return runQlabCommand(req, res, 'STOP kaikki', '/stop');

  const playheadMatch = method === 'POST' && config.playhead && url.match(/^\/playhead\/(go|next|previous)$/);
  if (playheadMatch) {
    const action = playheadMatch[1];
    if (action === 'go') {
      const cue = status.playhead ? `${status.playhead.number || '?'} · ${status.playhead.name}` : '(ei cuea valmiina)';
      return runQlabCommand(req, res, `GO ${cue}`, '/go');
    }
    return runQlabCommand(req, res, action === 'next' ? 'Playhead alas' : 'Playhead ylös', `/playhead/${action}`);
  }

  const spotifyMatch = method === 'POST' && config.spotify && url.match(/^\/spotify\/(\w+)(?:\/(\d+))?$/);
  if (spotifyMatch) {
    const [, action, value] = spotifyMatch;
    let script;
    if (action === 'volume' && value !== undefined) script = `tell application "Spotify" to set sound volume to ${Math.min(100, Number(value))}`;
    else if (SPOTIFY_COMMANDS[action]) script = `tell application "Spotify" to ${SPOTIFY_COMMANDS[action]}`;
    if (!script) return sendText(res, 404, 'Unknown Spotify command');
    // Volume changes arrive many times a second while dragging; they aren't worth announcing.
    const text = { playpause: status.spotify?.state === 'playing' ? 'Spotify tauko' : 'Spotify toisto', next: 'Spotify seuraava', previous: 'Spotify edellinen' }[action];
    try {
      await osascript(script);
      if (text) recordCommand(req, text);
      refreshSpotify();
      res.writeHead(204);
      return res.end();
    } catch (err) {
      console.error(err.message);
      if (text) recordCommand(req, text, 'Spotify ei vastannut');
      return sendText(res, 500, 'Spotify command failed');
    }
  }

  const macMatch = method === 'POST' && config.macVolume && url.match(/^\/mac\/(volume\/(\d+)|mute)$/);
  if (macMatch) {
    const volume = macMatch[2];
    const muted = status.mac?.muted;
    const script = volume !== undefined
      ? `set volume output volume ${Math.min(100, Number(volume))}`
      : `set volume output muted ${muted ? 'false' : 'true'}`;
    try {
      await osascript(script);
      // Volume changes arrive many times a second while dragging; only mute is announced.
      if (volume === undefined) recordCommand(req, muted ? 'Mac ääni päälle' : 'Mac mykistetty');
      refreshMac();
      res.writeHead(204);
      return res.end();
    } catch (err) {
      console.error(err.message);
      return sendText(res, 500, 'Äänenvoimakkuuden säätö epäonnistui');
    }
  }

  const cueMatch = method === 'POST' && url.match(/^\/cue\/([^/]+)\/(pause|stop|fade)$/);
  if (cueMatch) {
    const cue = decodeURIComponent(cueMatch[1]);
    if (!cueConfig.has(cue)) return sendText(res, 404, 'Unknown cue');
    const action = cueMatch[2];
    const name = cueText(cueConfig.get(cue));
    if (action === 'pause') return runQlabCommand(req, res, `Tauko/jatka ${name}`, `/cue/${cue}/togglePause`);
    if (action === 'stop') return runQlabCommand(req, res, `STOP ${name}`, `/cue/${cue}/stop`);
    return runQlabCommand(req, res, `FADE ${name} (${config.fadeSeconds} s)`, `/cue/${cue}/panicInTime`, [config.fadeSeconds]);
  }

  const goMatch = method === 'POST' && url.match(/^\/go\/([^/]+)$/);
  if (goMatch) {
    const cue = cueConfig.get(decodeURIComponent(goMatch[1]));
    if (!cue) return sendText(res, 404, 'Unknown cue');
    // Music fades while the cue starts; waiting for the fade would feel like lag to the operator.
    const fadeMusic = cue.spotifyFadeOut && config.spotify && status.spotify?.state === 'playing';
    if (fadeMusic) fadeOutSpotify(config.spotifyFadeSeconds);
    return runQlabCommand(req, res, `GO ${cueText(cue)}${fadeMusic ? ' + musiikki alas' : ''}`, `/cue/${cue.number}/start`);
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
  if (config.qlabWorkspace) console.log(`Workspace: ${config.qlabWorkspace}`);
  if (config.backup) console.log(`Backup QLab: ${config.backup.host}:${config.backup.port}`);
  if (config.playhead) console.log('Playhead mode on');
  if (config.pin) console.log('PIN required');
  console.log('\n' + qrTerminal(mainUrl));
  console.log(`\n  Open on phone: ${mainUrl}`);
  for (const ip of ips) console.log(`  or by IP:      http://${ip}:${config.port}`);
  console.log('\n  Stop with Ctrl+C\n');
});
