'use strict';

/**
 * GIF animé sans dépendance : décodage des captures PNG de Chrome, palette commune
 * (médiane), tramage ordonné (stable d'une image à l'autre), images différentielles
 * (seule la zone qui bouge est réécrite, le reste devient transparent), compression LZW.
 */

const zlib = require('zlib');

/* ------------------------------------------------------------------ */
/* PNG → RGB                                                           */
/* ------------------------------------------------------------------ */

function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('PNG attendu');
  let pos = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  let depth = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      colorType = data[9];
      if (data[12]) throw new Error('PNG entrelacé non pris en charge');
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (depth !== 8 || (colorType !== 2 && colorType !== 6)) throw new Error(`PNG ${colorType}/${depth} non pris en charge`);
  const bpp = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const out = Buffer.alloc(width * height * 3);
  let prev = Buffer.alloc(stride);
  let cur = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 255;
    }
    for (let x = 0, o = y * width * 3; x < width; x++, o += 3) {
      out[o] = cur[x * bpp];
      out[o + 1] = cur[x * bpp + 1];
      out[o + 2] = cur[x * bpp + 2];
    }
    [prev, cur] = [cur, prev];
  }
  return { width, height, rgb: out };
}

/* ------------------------------------------------------------------ */
/* Palette commune (coupe médiane)                                     */
/* ------------------------------------------------------------------ */

function buildPalette(frames, size = 255) {
  const total = frames.reduce((n, f) => n + f.rgb.length / 3, 0);
  const step = Math.max(1, Math.floor(total / 160000));
  const samples = [];
  let k = 0;
  for (const f of frames) {
    for (let i = 0; i < f.rgb.length; i += 3, k++) {
      if (k % step === 0) samples.push((f.rgb[i] << 16) | (f.rgb[i + 1] << 8) | f.rgb[i + 2]);
    }
  }
  const ch = (c, s) => (c >> (16 - 8 * s)) & 255;
  let boxes = [samples];
  while (boxes.length < size) {
    // Coupe la boîte la plus « étendue » (étendue × nombre de couleurs).
    let best = -1;
    let bestScore = -1;
    let bestCh = 0;
    boxes.forEach((box, i) => {
      if (box.length < 2) return;
      for (let s = 0; s < 3; s++) {
        let lo = 255;
        let hi = 0;
        for (const c of box) { const v = ch(c, s); if (v < lo) lo = v; if (v > hi) hi = v; }
        const score = (hi - lo) * Math.sqrt(box.length);
        if (score > bestScore) { bestScore = score; best = i; bestCh = s; }
      }
    });
    if (best < 0 || bestScore <= 0) break;
    const box = boxes[best].sort((a, b) => ch(a, bestCh) - ch(b, bestCh));
    const mid = box.length >> 1;
    boxes.splice(best, 1, box.slice(0, mid), box.slice(mid));
  }
  return boxes.map((box) => {
    let r = 0; let g = 0; let b = 0;
    for (const c of box) { r += (c >> 16) & 255; g += (c >> 8) & 255; b += c & 255; }
    const n = box.length || 1;
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
  });
}

/* ------------------------------------------------------------------ */
/* Couleurs → index (table 5 bits par canal + tramage ordonné)         */
/* ------------------------------------------------------------------ */

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v / 16 - 0.47) * 10);

function indexer(palette) {
  const table = new Int16Array(32768).fill(-1);
  const nearest = (key) => {
    const r = ((key >> 10) << 3) + 4;
    const g = (((key >> 5) & 31) << 3) + 4;
    const b = ((key & 31) << 3) + 4;
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < palette.length; i++) {
      const p = palette[i];
      const d = (p[0] - r) * (p[0] - r) * 2 + (p[1] - g) * (p[1] - g) * 3 + (p[2] - b) * (p[2] - b);
      if (d < bd) { bd = d; best = i; }
    }
    table[key] = best;
    return best;
  };
  return (rgb, width, height) => {
    const out = new Uint8Array(width * height);
    for (let y = 0, i = 0; y < height; y++) {
      for (let x = 0; x < width; x++, i++) {
        const d = BAYER[((y & 3) << 2) | (x & 3)];
        const o = i * 3;
        const r = Math.min(255, Math.max(0, rgb[o] + d)) >> 3;
        const g = Math.min(255, Math.max(0, rgb[o + 1] + d)) >> 3;
        const b = Math.min(255, Math.max(0, rgb[o + 2] + d)) >> 3;
        const key = (r << 10) | (g << 5) | b;
        const v = table[key];
        out[i] = v >= 0 ? v : nearest(key);
      }
    }
    return out;
  };
}

/* ------------------------------------------------------------------ */
/* LZW (variante GIF)                                                  */
/* ------------------------------------------------------------------ */

const dict = new Int16Array(4096 * 256);
const stamp = new Uint32Array(4096 * 256);
let generation = 1;

function lzw(indices, minCode = 8) {
  const clear = 1 << minCode;
  const eoi = clear + 1;
  const bytes = [];
  let acc = 0;
  let bits = 0;
  let size = minCode + 1;
  let next = eoi + 1;
  const emit = (code) => {
    acc |= code << bits;
    bits += size;
    while (bits >= 8) { bytes.push(acc & 255); acc >>>= 8; bits -= 8; }
  };
  const reset = () => { generation++; next = eoi + 1; size = minCode + 1; };
  emit(clear);
  reset();
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = prefix * 256 + k;
    if (stamp[key] === generation) { prefix = dict[key]; continue; }
    emit(prefix);
    if (next < 4096) {
      dict[key] = next;
      stamp[key] = generation;
      if (next === 1 << size && size < 12) size++;
      next++;
    } else {
      emit(clear);
      reset();
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (bits > 0) bytes.push(acc & 255);
  return Buffer.from(bytes);
}

function subBlocks(data) {
  const parts = [];
  for (let i = 0; i < data.length; i += 255) {
    const chunk = data.subarray(i, i + 255);
    parts.push(Buffer.from([chunk.length]), chunk);
  }
  parts.push(Buffer.from([0]));
  return Buffer.concat(parts);
}

/* ------------------------------------------------------------------ */
/* GIF animé                                                           */
/* ------------------------------------------------------------------ */

/**
 * frames : [{ width, height, rgb }] (même taille). delayMs : durée d'une image.
 * Renvoie un Buffer GIF qui tourne en boucle.
 */
function encodeGif(frames, { delayMs = 80 } = {}) {
  const { width, height } = frames[0];
  const palette = buildPalette(frames, 255);
  while (palette.length < 255) palette.push([0, 0, 0]);
  const TRANSPARENT = 255;
  const toIndex = indexer(palette);
  const delay = Math.max(2, Math.round(delayMs / 10));

  const head = Buffer.alloc(13);
  head.write('GIF89a', 0, 'latin1');
  head.writeUInt16LE(width, 6);
  head.writeUInt16LE(height, 8);
  head[10] = 0xf7; // table globale de 256 couleurs
  const gct = Buffer.alloc(256 * 3);
  palette.forEach((p, i) => { gct[i * 3] = p[0]; gct[i * 3 + 1] = p[1]; gct[i * 3 + 2] = p[2]; });
  const loop = Buffer.from([0x21, 0xff, 0x0b, ...Buffer.from('NETSCAPE2.0', 'latin1'), 0x03, 0x01, 0x00, 0x00, 0x00]);
  const parts = [head, gct, loop];

  let prev = null;
  for (const f of frames) {
    const idx = toIndex(f.rgb, width, height);
    let x0 = 0; let y0 = 0; let x1 = width - 1; let y1 = height - 1;
    let pixels = idx;
    let transparent = false;
    if (prev) {
      // Zone qui a changé depuis l'image précédente.
      x0 = width; y0 = height; x1 = -1; y1 = -1;
      for (let y = 0, i = 0; y < height; y++) {
        for (let x = 0; x < width; x++, i++) {
          if (idx[i] !== prev[i]) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
        }
      }
      if (x1 < 0) { x0 = 0; y0 = 0; x1 = 0; y1 = 0; }
      const w = x1 - x0 + 1;
      const h = y1 - y0 + 1;
      pixels = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y + y0) * width + x + x0;
          pixels[y * w + x] = idx[i] === prev[i] ? TRANSPARENT : idx[i];
        }
      }
      transparent = true;
    }
    const w = x1 - x0 + 1;
    const h = y1 - y0 + 1;
    // Extension de contrôle : durée, « laisser en place », transparence.
    parts.push(Buffer.from([0x21, 0xf9, 0x04, (1 << 2) | (transparent ? 1 : 0), delay & 255, delay >> 8, TRANSPARENT, 0]));
    const desc = Buffer.alloc(10);
    desc[0] = 0x2c;
    desc.writeUInt16LE(x0, 1);
    desc.writeUInt16LE(y0, 3);
    desc.writeUInt16LE(w, 5);
    desc.writeUInt16LE(h, 7);
    parts.push(desc, Buffer.from([8]), subBlocks(lzw(pixels, 8)));
    prev = idx;
  }
  parts.push(Buffer.from([0x3b]));
  return Buffer.concat(parts);
}

module.exports = { decodePng, buildPalette, encodeGif, lzw };
