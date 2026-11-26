#!/usr/bin/env node
'use strict';

// img-precheck: check photos before uploading them to an AI outfit try-on tool.
// Zero dependencies, no network access. Reads image headers itself.

const fs = require('fs');
const path = require('path');

// ---- Thresholds (from the upload rules) ----------------------------------
// From the upload rules: largest accepted file, 10 MB.
const MAX_FILE_BYTES = 10 * 1024 * 1024;
// From the upload rules: shortest side of a person photo, in pixels.
const PERSON_MIN_SHORT_SIDE = 640;
// From the upload rules: shortest side of a clothes photo, in pixels.
const CLOTHES_MIN_SHORT_SIDE = 400;
// From the upload rules: long side divided by short side may be at most 3.
const MAX_ASPECT_RATIO = 3;
// From the upload rules: accepted formats, by file extension.
const ALLOWED_EXTENSIONS = {
  '.jpg': 'JPEG',
  '.jpeg': 'JPEG',
  '.png': 'PNG',
  '.webp': 'WebP',
  '.heic': 'HEIC',
};

const MIN_SHORT_SIDE = { person: PERSON_MIN_SHORT_SIDE, clothes: CLOTHES_MIN_SHORT_SIDE };
const HEIC_NO_SIZE = '无法读取尺寸，请先转成 JPG 或 PNG';

const HELP = `img-precheck - check photos before uploading

Usage:
  node check.js [--role person|clothes] <file-or-folder> [...more]

Options:
  --role person    photo of a person (default): shortest side >= ${PERSON_MIN_SHORT_SIDE}px
  --role clothes   photo of a garment: shortest side >= ${CLOTHES_MIN_SHORT_SIDE}px
  -h, --help       show this help

Checks, for every file:
  format   JPG, PNG, WebP or HEIC (read from the file's own bytes)
  size     at most ${MAX_FILE_BYTES / 1024 / 1024} MB
  short    shortest side at least the --role minimum
  ratio    long side / short side at most ${MAX_ASPECT_RATIO}

Folders are searched recursively. Files with other extensions are listed
under "已跳过" (skipped). A HEIC file whose size cannot be read fails with
"${HEIC_NO_SIZE}".

Exit code: 0 if every checked file passes, 1 otherwise.
`;

// ---- Dimension parsers ----------------------------------------------------

function pngSize(b) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length < 24 || !sig.every((v, i) => b[i] === v)) return null;
  if (b.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { format: 'PNG', width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

function jpegSize(b) {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) return { format: 'JPEG' };
    while (b[i] === 0xff) i++; // skip fill bytes
    const marker = b[i++];
    if (marker === 0xd9 || marker === 0xda) break; // end of image / start of scan
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue; // no length
    if (i + 2 > b.length) break;
    const len = b.readUInt16BE(i);
    // SOF0 (baseline), SOF1 (extended), SOF2 (progressive)
    if (marker >= 0xc0 && marker <= 0xc2 && i + 7 <= b.length) {
      return { format: 'JPEG', height: b.readUInt16BE(i + 3), width: b.readUInt16BE(i + 5) };
    }
    i += len;
  }
  return { format: 'JPEG' };
}

function webpSize(b) {
  if (b.length < 16 || b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WEBP') return null;
  const chunk = b.toString('ascii', 12, 16);
  if (chunk === 'VP8 ' && b.length >= 30) {
    // 3-byte frame tag, then start code 9d 01 2a, then 14-bit width and height
    if (b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) {
      return { format: 'WebP', width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    }
  } else if (chunk === 'VP8L' && b.length >= 25 && b[20] === 0x2f) {
    const bits = b.readUInt32LE(21);
    return { format: 'WebP', width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  } else if (chunk === 'VP8X' && b.length >= 30) {
    return { format: 'WebP', width: b.readUIntLE(24, 3) + 1, height: b.readUIntLE(27, 3) + 1 };
  }
  return { format: 'WebP' };
}

function heicSize(b) {
  if (b.length < 12 || b.toString('ascii', 4, 8) !== 'ftyp') return null;
  const brand = b.toString('ascii', 8, 12);
  if (!['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1'].includes(brand)) return null;
  // Best effort: take the largest 'ispe' (image spatial extent) box found.
  let best = null;
  let i = b.indexOf('ispe');
  while (i !== -1 && i + 16 <= b.length) {
    const width = b.readUInt32BE(i + 8);
    const height = b.readUInt32BE(i + 12);
    if (width > 0 && height > 0 && (!best || width * height > best.width * best.height)) best = { width, height };
    i = b.indexOf('ispe', i + 4);
  }
  return Object.assign({ format: 'HEIC' }, best || {});
}

function readImageInfo(buf) {
  return pngSize(buf) || jpegSize(buf) || webpSize(buf) || heicSize(buf) || { format: 'unknown' };
}

// ---- Checking -------------------------------------------------------------

function checkFile(file, role) {
  const bytes = fs.statSync(file).size;
  const info = readImageInfo(fs.readFileSync(file));
  const hasSize = Number.isInteger(info.width) && Number.isInteger(info.height) && info.width > 0 && info.height > 0;
  const short = hasSize ? Math.min(info.width, info.height) : null;
  const ratio = hasSize ? Math.max(info.width, info.height) / short : null;

  const checks = {
    format: info.format !== 'unknown',
    size: bytes <= MAX_FILE_BYTES,
    short: hasSize ? short >= MIN_SHORT_SIDE[role] : false,
    ratio: hasSize ? ratio <= MAX_ASPECT_RATIO : false,
  };
  let note = '';
  if (!hasSize) note = info.format === 'HEIC' ? HEIC_NO_SIZE : 'could not read dimensions';
  return { file, bytes, info, hasSize, ratio, checks, note, ok: Object.values(checks).every(Boolean) };
}

function collect(target, found, skipped) {
  const stat = fs.statSync(target);
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(target).sort()) {
      if (name.startsWith('.')) continue;
      collect(path.join(target, name), found, skipped);
    }
  } else if (ALLOWED_EXTENSIONS[path.extname(target).toLowerCase()]) {
    found.push(target);
  } else {
    skipped.push(target);
  }
}

function formatBytes(n) {
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(2) + ' MB';
  if (n >= 1024) return (n / 1024).toFixed(1) + ' KB';
  return n + ' B';
}

function formatLine(r) {
  const mark = (ok, label) => `${label} ${ok ? 'pass' : 'FAIL'}`;
  const dims = r.hasSize ? `${r.info.width}x${r.info.height}` : '?x?';
  const ratio = r.hasSize ? ` (${r.ratio.toFixed(2)})` : '';
  return [
    r.file,
    r.info.format,
    dims,
    formatBytes(r.bytes),
    mark(r.checks.format, 'format'),
    mark(r.checks.size, 'size'),
    mark(r.checks.short, 'short'),
    mark(r.checks.ratio, 'ratio') + ratio,
    (r.ok ? 'PASS' : 'FAIL') + (r.note ? ` - ${r.note}` : ''),
  ].join(' | ');
}

function main(argv) {
  let role = 'person';
  const targets = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') {
      process.stdout.write(HELP);
      return 0;
    } else if (a === '--role' || a.startsWith('--role=')) {
      role = a.includes('=') ? a.split('=')[1] : argv[++i];
      if (!MIN_SHORT_SIDE[role]) {
        console.error(`Unknown --role "${role}". Use person or clothes.`);
        return 1;
      }
    } else if (a.startsWith('-')) {
      console.error(`Unknown option ${a}. Try --help.`);
      return 1;
    } else {
      targets.push(a);
    }
  }
  if (targets.length === 0) {
    process.stdout.write(HELP);
    return 1;
  }

  const found = [];
  const skipped = [];
  for (const t of targets) {
    if (!fs.existsSync(t)) {
      console.error(`Not found: ${t}`);
      return 1;
    }
    collect(t, found, skipped);
  }

  console.log(`role: ${role} (shortest side >= ${MIN_SHORT_SIDE[role]}px, <= ${MAX_FILE_BYTES / 1024 / 1024} MB, ratio <= ${MAX_ASPECT_RATIO})`);
  const results = found.map((f) => checkFile(f, role));
  for (const r of results) console.log(formatLine(r));
  if (skipped.length) {
    console.log(`已跳过 (${skipped.length}):`);
    for (const s of skipped) console.log(`  ${s}`);
  }
  const passed = results.filter((r) => r.ok).length;
  console.log(`${passed}/${results.length} passed`);
  return passed === results.length ? 0 : 1;
}

module.exports = { readImageInfo, checkFile, MAX_FILE_BYTES, PERSON_MIN_SHORT_SIDE, CLOTHES_MIN_SHORT_SIDE, MAX_ASPECT_RATIO };

if (require.main === module) process.exitCode = main(process.argv.slice(2));
