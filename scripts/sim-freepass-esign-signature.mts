import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { hasMeaningfulFreepassSignature, inspectFreepassSignature } from '../lib/server/freepass-esign-signature';

const pngChunk = (type: string, data: Uint8Array) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 4, 'ascii');
  Buffer.from(data).copy(out, 8);
  // The parser intentionally does not depend on CRC; this fixture keeps the structural bytes minimal.
  return out;
};

function signaturePng(width: number, height: number, ink: Array<[number, number]>) {
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    rows[y * (width * 4 + 1)] = 0;
  }
  for (const [x, y] of ink) {
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    const offset = y * (width * 4 + 1) + 1 + x * 4;
    rows[offset] = 20;
    rows[offset + 1] = 20;
    rows[offset + 2] = 20;
    rows[offset + 3] = 255;
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(rows)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

const dot = signaturePng(600, 180, [[100, 60]]);
assert.equal(hasMeaningfulFreepassSignature(dot), false, '한 점 서명은 거부한다');
assert.equal(hasMeaningfulFreepassSignature(signaturePng(1, 1, [[0, 0]])), false, '1×1 PNG는 거부한다');

const drawn: Array<[number, number]> = [];
for (let x = 90; x < 150; x += 1) for (let y = 50; y < 64; y += 1) drawn.push([x, y]);
const meaningful = signaturePng(600, 180, drawn);
assert.deepEqual(inspectFreepassSignature(meaningful), { pixels: 840, width: 60, height: 14 });
assert.equal(hasMeaningfulFreepassSignature(meaningful), true, '충분한 크기의 서명 획은 통과한다');

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const browserSignature = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 180;
    const context = canvas.getContext('2d')!;
    context.strokeStyle = '#141414';
    context.lineWidth = 2.4;
    context.lineCap = 'round';
    context.beginPath();
    context.moveTo(90, 70);
    context.bezierCurveTo(120, 32, 146, 118, 190, 58);
    context.lineTo(225, 88);
    context.stroke();
    return canvas.toDataURL('image/png');
  });
  assert.equal(hasMeaningfulFreepassSignature(browserSignature), true, '실제 Chromium canvas 서명은 통과한다');
} finally {
  await browser.close();
}

const publicRoute = readFileSync('app/api/freepass-esign/public/[token]/route.ts', 'utf8');
assert.match(publicRoute, /hasMeaningfulFreepassSignature\(signature\)/);

console.log('PASS: 전자서명 PNG 크기·잉크 범위 서버 검증');
