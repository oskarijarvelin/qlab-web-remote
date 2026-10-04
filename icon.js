// Draws the app icon (green rounded square with a white play triangle on a dark background)
// as a PNG, so the home screen icon needs no image files or dependencies.
const zlib = require('zlib');

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, pixel) {
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixel(x, y);
      const i = y * (size * 3 + 1) + 1 + x * 3;
      raw[i] = r; raw[i + 1] = g; raw[i + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const BG = [17, 17, 17];
const GREEN = [31, 122, 58];
const WHITE = [255, 255, 255];

// Shape in unit coordinates (0..1): which color is at (u, v)?
function shade(u, v) {
  const inset = 0.14, radius = 0.16;
  const dx = Math.max(inset + radius - u, 0, u - (1 - inset - radius));
  const dy = Math.max(inset + radius - v, 0, v - (1 - inset - radius));
  if (dx * dx + dy * dy > radius * radius) return BG;
  // Play triangle pointing right, optically centred.
  const left = 0.4, right = 0.68, top = 0.32, bottom = 0.68;
  const half = (bottom - top) / 2;
  if (u >= left && u <= right && Math.abs(v - 0.5) <= half * (1 - (u - left) / (right - left))) return WHITE;
  return GREEN;
}

const SAMPLES = 4; // 4x4 supersampling for smooth edges
const cache = new Map();

function iconPng(size) {
  if (!cache.has(size)) {
    cache.set(size, encodePng(size, (x, y) => {
      const sum = [0, 0, 0];
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const c = shade((x + (sx + 0.5) / SAMPLES) / size, (y + (sy + 0.5) / SAMPLES) / size);
          sum[0] += c[0]; sum[1] += c[1]; sum[2] += c[2];
        }
      }
      return sum.map((s) => Math.round(s / (SAMPLES * SAMPLES)));
    }));
  }
  return cache.get(size);
}

module.exports = { iconPng };
