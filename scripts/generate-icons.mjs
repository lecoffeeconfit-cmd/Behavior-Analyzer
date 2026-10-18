import { mkdir, writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
const table = Array.from({ length: 256 }, (_, n) => { let crc = n; for (let k = 0; k < 8; k++) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1; return crc >>> 0; });
function crc32(buffer) { let crc = 0xffffffff; for (const b of buffer) crc = table[(crc ^ b) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const name = Buffer.from(type), length = Buffer.alloc(4), crc = Buffer.alloc(4);
  length.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, crc]);
}
export async function generateIcons() {
  const directory = new URL("../apps/extension/public/icons/", import.meta.url);
  await mkdir(directory, { recursive: true });
  for (const size of [16, 32, 48, 128]) {
    const raw = Buffer.alloc((size * 4 + 1) * size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size, v = (y + 0.5) / size;
      const round = Math.hypot(Math.max(0, Math.abs(u - 0.5) - 0.27), Math.max(0, Math.abs(v - 0.5) - 0.27));
      const alpha = Math.max(0, Math.min(1, (0.225 - round) * size));
      const ring = Math.abs(Math.hypot(u - 0.5, v - 0.5) - 0.33) < 0.012;
      const bars = [[0.32, 0.39, 0.62], [0.46, 0.27, 0.73], [0.60, 0.35, 0.65]];
      const bright = bars.some(([left, top, bottom]) => u >= left && u <= left + 0.08 && v >= top && v <= bottom);
      const at = y * (size * 4 + 1) + 1 + x * 4;
      const color = bright ? [136, 186, 255] : ring ? [63, 91, 135] : [13 + v * 8, 23 + v * 12, 38 + v * 10];
      raw[at] = color[0]; raw[at + 1] = color[1]; raw[at + 2] = color[2]; raw[at + 3] = Math.round(alpha * 255);
    }
    const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
    await writeFile(new URL(`icon${size}.png`, directory), Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
  }
}
if (process.argv[1]?.endsWith("generate-icons.mjs")) await generateIcons();
