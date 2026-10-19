// Minimal ICO container with embedded PNG entries (Vista+).

/** @param {Array<{ size: number; png: Buffer }>} entries  @returns {Buffer} */
export function buildIco(entries) {
  const header = Buffer.alloc(6 + 16 * entries.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  let offset = header.length;
  entries.forEach(({ size, png }, i) => {
    const at = 6 + 16 * i;
    header[at] = size >= 256 ? 0 : size;
    header[at + 1] = size >= 256 ? 0 : size;
    header[at + 2] = 0;
    header[at + 3] = 0;
    header.writeUInt16LE(1, at + 4);
    header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(png.length, at + 8);
    header.writeUInt32LE(offset, at + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...entries.map((e) => e.png)]);
}

/** @param {Buffer} buffer  @returns {Array<{ width: number; height: number; offset: number; length: number; png: Buffer }>} width/height 256 for stored 0 */
export function parseIco(buffer) {
  if (buffer.readUInt16LE(0) !== 0 || buffer.readUInt16LE(2) !== 1) throw new Error('Kein ICO');
  const count = buffer.readUInt16LE(4);
  const result = [];
  for (let i = 0; i < count; i++) {
    const at = 6 + 16 * i;
    const length = buffer.readUInt32LE(at + 8);
    const offset = buffer.readUInt32LE(at + 12);
    result.push({
      width: buffer[at] || 256,
      height: buffer[at + 1] || 256,
      offset,
      length,
      png: buffer.subarray(offset, offset + length),
    });
  }
  return result;
}
