#!/usr/bin/env node
'use strict';

// Writes small synthetic sample images into ./samples (solid gray, no real photos).
// Zero dependencies: PNG uses the built-in zlib, JPEG and WebP are encoded by hand.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'samples');

// ---- PNG: 8-bit grayscale, every pixel 128 ----
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // grayscale
  const row = Buffer.alloc(width + 1, 128);
  row[0] = 0; // filter: none
  const raw = Buffer.concat(Array(height).fill(row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- JPEG: baseline (SOF0) grayscale; every block has DC diff 0 and no AC ----
function jpegSegment(marker, data) {
  const len = Buffer.alloc(2);
  len.writeUInt16BE(data.length + 2);
  return Buffer.concat([Buffer.from([0xff, marker]), len, data]);
}
function jpeg(width, height) {
  const sof = Buffer.from([8, height >> 8, height & 255, width >> 8, width & 255, 1, 1, 0x11, 0]);
  const dqt = Buffer.concat([Buffer.from([0]), Buffer.alloc(64, 1)]);
  // One Huffman code of length 1 per table: DC symbol 0 (diff 0), AC symbol 0 (end of block).
  const oneCode = (cls) => Buffer.concat([Buffer.from([cls << 4]), Buffer.from([1, ...Array(15).fill(0)]), Buffer.from([0])]);
  const sos = Buffer.from([1, 1, 0x00, 0, 63, 0]);
  const blocks = Math.ceil(width / 8) * Math.ceil(height / 8);
  const scan = Buffer.alloc(Math.ceil((blocks * 2) / 8), 0); // 2 zero bits per block
  const padBits = scan.length * 8 - blocks * 2;
  if (padBits) scan[scan.length - 1] |= (1 << padBits) - 1; // pad with 1 bits
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    jpegSegment(0xdb, dqt),
    jpegSegment(0xc0, sof),
    jpegSegment(0xc4, oneCode(0)),
    jpegSegment(0xc4, oneCode(1)),
    jpegSegment(0xda, sos),
    scan,
    Buffer.from([0xff, 0xd9]),
  ]);
}

// ---- WebP: lossless (VP8L), one color, optionally wrapped in VP8X ----
function vp8lPayload(width, height) {
  const bits = [];
  const put = (value, n) => { for (let i = 0; i < n; i++) bits.push((value >> i) & 1); };
  put(width - 1, 14);
  put(height - 1, 14);
  put(0, 1); // alpha hint
  put(0, 3); // version
  put(0, 1); // no transforms
  put(0, 1); // no color cache
  put(0, 1); // no meta prefix codes
  // Five prefix codes (green, red, blue, alpha, distance), each a "simple" code with one 8-bit symbol.
  for (const symbol of [128, 128, 128, 255, 0]) {
    put(1, 1); // simple code
    put(0, 1); // one symbol
    put(1, 1); // symbol is 8 bits
    put(symbol, 8);
  }
  // Pixel data: a single-symbol code needs 0 bits per pixel.
  const out = Buffer.alloc(1 + Math.ceil(bits.length / 8));
  out[0] = 0x2f;
  bits.forEach((bit, i) => { out[1 + (i >> 3)] |= bit << (i & 7); });
  return out;
}
function riffChunk(type, data) {
  const head = Buffer.alloc(8);
  head.write(type, 0, 'ascii');
  head.writeUInt32LE(data.length, 4);
  return Buffer.concat([head, data, data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
}
function webp(width, height, extended) {
  let body = riffChunk('VP8L', vp8lPayload(width, height));
  if (extended) {
    const x = Buffer.alloc(10);
    x.writeUIntLE(width - 1, 4, 3);
    x.writeUIntLE(height - 1, 7, 3);
    body = Buffer.concat([riffChunk('VP8X', x), body]);
  }
  const head = Buffer.alloc(12);
  head.write('RIFF', 0, 'ascii');
  head.writeUInt32LE(body.length + 4, 4);
  head.write('WEBP', 8, 'ascii');
  return Buffer.concat([head, body]);
}

// ---- HEIC stub: only an 'ftyp' box, so there is no size to read ----
function heicStub() {
  const box = Buffer.alloc(24);
  box.writeUInt32BE(24, 0);
  box.write('ftypheic', 4, 'ascii');
  box.write('mif1heic', 16, 'ascii');
  return box;
}

const files = {
  'portrait.jpg': jpeg(1200, 1600),
  'small-selfie.png': png(480, 640),
  'full-body.webp': webp(720, 1280, false),
  'wide-banner.webp': webp(2400, 600, true),
  'phone-photo.heic': heicStub(),
  'notes.txt': Buffer.from('Not an image. img-precheck should list this file as skipped.\n'),
  'clothes/shirt-flat.png': png(500, 700),
};

for (const [name, data] of Object.entries(files)) {
  const file = path.join(OUT, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
  console.log(`wrote samples/${name} (${data.length} bytes)`);
}
