'use strict';

// Run: node test.js   (regenerate samples first with: node scripts/make-samples.js)
const assert = require('assert');
const path = require('path');
const { readImageInfo, checkFile } = require('./check');

const sample = (name) => path.join(__dirname, 'samples', name);

// Samples written by scripts/make-samples.js
assert.deepStrictEqual(checkFile(sample('portrait.jpg'), 'person').ok, true);
assert.deepStrictEqual(checkFile(sample('small-selfie.png'), 'person').checks.short, false);
assert.deepStrictEqual(checkFile(sample('full-body.webp'), 'person').ok, true);
assert.deepStrictEqual(checkFile(sample('wide-banner.webp'), 'person').checks.ratio, false);
assert.deepStrictEqual(checkFile(sample('clothes/shirt-flat.png'), 'person').ok, false);
assert.deepStrictEqual(checkFile(sample('clothes/shirt-flat.png'), 'clothes').ok, true);
const heic = checkFile(sample('phone-photo.heic'), 'person');
assert.strictEqual(heic.ok, false);
assert.strictEqual(heic.note, '无法读取尺寸，请先转成 JPG 或 PNG');

// Lossy WebP (VP8) header: frame tag, start code 9d 01 2a, 14-bit width/height.
const vp8 = Buffer.alloc(30);
vp8.write('RIFF', 0, 'ascii');
vp8.write('WEBPVP8 ', 8, 'ascii');
vp8.set([0x9d, 0x01, 0x2a], 23);
vp8.writeUInt16LE(1000, 26);
vp8.writeUInt16LE(750, 28);
assert.deepStrictEqual(readImageInfo(vp8), { format: 'WebP', width: 1000, height: 750 });

// HEIC with an 'ispe' box: version/flags, then 32-bit width and height.
const ispe = Buffer.alloc(20);
ispe.writeUInt32BE(20, 0);
ispe.write('ispe', 4, 'ascii');
ispe.writeUInt32BE(3024, 12);
ispe.writeUInt32BE(4032, 16);
const ftyp = Buffer.from('00000018667479706865696300000000' + '6d69663168656963', 'hex');
assert.deepStrictEqual(readImageInfo(Buffer.concat([ftyp, ispe])), { format: 'HEIC', width: 3024, height: 4032 });

// Not an image at all.
assert.deepStrictEqual(readImageInfo(Buffer.from('hello world, not an image')), { format: 'unknown' });

console.log('all tests passed');
