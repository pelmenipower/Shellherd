// Renders resources/icon.ico, icon.png and mark-64.png from resources/brand/*.png.
// Run: electron scripts/icons/make-icons.mjs (needs Electron's nativeImage).
import { app, nativeImage } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { buildIco } from './ico.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const brand = (name) => join(root, 'resources', 'brand', name);
const out = (name) => join(root, 'resources', name);

/** Bounding box of dark pixels (luminance < 200) in a BGRA bitmap. */
function boundingBox(bmp, w, h) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (0.299 * bmp[i + 2] + 0.587 * bmp[i + 1] + 0.114 * bmp[i] < 200) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) throw new Error('Kein Motiv gefunden');
  return { x0, y0, bw: x1 - x0 + 1, bh: y1 - y0 + 1 };
}

/** Crops the motif square (3 px inset) and applies a rounded-corner mask, premultiplied. */
function prepare(file) {
  const img = nativeImage.createFromPath(file);
  const { width: w, height: h } = img.getSize();
  if (!w) throw new Error(`Quelle nicht lesbar: ${file}`);
  const { x0, y0, bw, bh } = boundingBox(img.toBitmap(), w, h);
  const s = Math.min(bw, bh) - 6;
  const x = x0 + Math.floor((bw - s) / 2);
  const y = y0 + Math.floor((bh - s) / 2);
  console.log(`${file}: ${w}x${h}, bbox x ${x0}..${x0 + bw - 1} y ${y0}..${y0 + bh - 1}, square ${s} at ${x},${y}`);
  if (s < 0.85 * Math.min(w, h)) throw new Error(`Ausschnitt ${s}px zu klein für ${file}`);
  const crop = img.crop({ x, y, width: s, height: s });
  const px = Buffer.from(crop.toBitmap());
  const r = 0.2 * s;
  const half = s / 2;
  for (let py = 0; py < s; py++) {
    for (let pxl = 0; pxl < s; pxl++) {
      const qx = Math.abs(pxl + 0.5 - half) - (half - r);
      const qy = Math.abs(py + 0.5 - half) - (half - r);
      const d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
      const cov = Math.min(1, Math.max(0, 0.5 - d));
      if (cov < 1) {
        const i = (py * s + pxl) * 4;
        for (let c = 0; c < 4; c++) px[i + c] = Math.round(px[i + c] * cov);
      }
    }
  }
  return nativeImage.createFromBitmap(px, { width: s, height: s });
}

const render = (masked, size) => masked.resize({ width: size, height: size, quality: 'best' }).toPNG();

async function main() {
  await app.whenReady();
  mkdirSync(join(root, 'resources'), { recursive: true });
  const master = prepare(brand('shellherd-master.png'));
  const small32 = prepare(brand('shellherd-small-32.png'));
  const small16 = prepare(brand('shellherd-small-16.png'));
  const ico = buildIco([
    { size: 16, png: render(small16, 16) },
    { size: 24, png: render(small32, 24) },
    { size: 32, png: render(small32, 32) },
    { size: 48, png: render(master, 48) },
    { size: 64, png: render(master, 64) },
    { size: 256, png: render(master, 256) },
  ]);
  writeFileSync(out('icon.ico'), ico);
  writeFileSync(out('icon.png'), render(master, 256));
  writeFileSync(out('mark-64.png'), render(master, 64));
  console.log('icon.ico, icon.png, mark-64.png geschrieben');
}

main().then(() => app.exit(0), (err) => { console.error(err); app.exit(1); });
