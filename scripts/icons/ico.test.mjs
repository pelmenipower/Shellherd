import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildIco, parseIco } from './ico.mjs';

const res = (name) => readFileSync(fileURLToPath(new URL(`../../resources/${name}`, import.meta.url)));
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Reads IHDR and the alpha of pixel (0,0); raw bytes equal decoded ones there for every filter type. */
function inspectPng(png) {
  expect(png.subarray(0, 8).equals(SIGNATURE)).toBe(true);
  let pos = 8;
  let ihdr;
  const idat = [];
  while (pos < png.length) {
    const len = png.readUInt32BE(pos);
    const type = png.toString('latin1', pos + 4, pos + 8);
    const data = png.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') ihdr = data;
    if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  return {
    width: ihdr.readUInt32BE(0),
    height: ihdr.readUInt32BE(4),
    bitDepth: ihdr[8],
    colorType: ihdr[9],
    interlace: ihdr[12],
    cornerAlpha: raw[1 + 3],
  };
}

function fakePng(tag) {
  return Buffer.concat([SIGNATURE, Buffer.from(tag)]);
}

describe('ico', () => {
  it('round-trips with 256 stored as 0 and gapless offsets', () => {
    const entries = [
      { size: 16, png: fakePng('a') },
      { size: 48, png: fakePng('bb') },
      { size: 256, png: fakePng('ccc') },
    ];
    const buf = buildIco(entries);
    expect([buf.readUInt16LE(0), buf.readUInt16LE(2), buf.readUInt16LE(4)]).toEqual([0, 1, 3]);
    expect(buf[6 + 32]).toBe(0);
    expect(buf[6 + 32 + 1]).toBe(0);
    const parsed = parseIco(buf);
    expect(parsed.map((e) => e.width)).toEqual([16, 48, 256]);
    expect(parsed.map((e) => e.height)).toEqual([16, 48, 256]);
    let offset = 6 + 16 * 3;
    parsed.forEach((e, i) => {
      expect(e.offset).toBe(offset);
      expect(e.png.equals(entries[i].png)).toBe(true);
      offset += e.length;
    });
    expect(buf.length).toBe(offset);
  });
});

describe('icon artifacts', () => {
  const check = (png, size) => {
    const info = inspectPng(png);
    expect([info.width, info.height]).toEqual([size, size]);
    expect(info.bitDepth).toBe(8);
    expect(info.colorType).toBe(6);
    expect(info.interlace).toBe(0);
    expect(info.cornerAlpha).toBeLessThan(16);
  };

  it('icon.png is 256 square with a transparent corner', () => check(res('icon.png'), 256));
  it('mark-64.png is 64 square with a transparent corner', () => check(res('mark-64.png'), 64));

  it('icon.ico holds exactly the expected sizes, consistent and gapless', () => {
    const buf = res('icon.ico');
    const entries = parseIco(buf);
    expect(entries.map((e) => e.width)).toEqual([16, 24, 32, 48, 64, 256]);
    let offset = 6 + 16 * entries.length;
    for (const e of entries) {
      expect(e.offset).toBe(offset);
      check(e.png, e.width);
      expect(e.height).toBe(e.width);
      offset += e.length;
    }
    expect(buf.length).toBe(offset);
  });
});
