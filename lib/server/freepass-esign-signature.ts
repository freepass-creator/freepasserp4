import { inflateSync } from 'node:zlib';

const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const SIGNATURE_WIDTH = 600;
const SIGNATURE_HEIGHT = 180;
const MIN_INK_PIXELS = 70;
const MIN_INK_WIDTH = 40;
const MIN_INK_HEIGHT = 10;

export type FreepassSignatureInk = {
  pixels: number;
  width: number;
  height: number;
};

const readU32 = (bytes: Uint8Array, offset: number) => (
  ((bytes[offset] * 0x1000000) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]) >>> 0
);

function paeth(left: number, up: number, upLeft: number): number {
  const p = left + up - upLeft;
  const pl = Math.abs(p - left);
  const pu = Math.abs(p - up);
  const pul = Math.abs(p - upLeft);
  return pl <= pu && pl <= pul ? left : pu <= pul ? up : upLeft;
}

/**
 * 고객 화면의 600×180 canvas PNG만 해석한다.
 * 1×1 픽셀·한 점 클릭은 완료 계약서의 서명 증거가 될 수 없으므로 서버에서도 막는다.
 * 서명의 사람다운 형태 판정은 관리자의 본인확인 검토에 남겨 둔다.
 */
export function inspectFreepassSignature(value: unknown): FreepassSignatureInk | null {
  const dataUrl = String(value ?? '').trim();
  const prefix = 'data:image/png;base64,';
  if (!dataUrl.startsWith(prefix)) return null;
  const encoded = dataUrl.slice(prefix.length);
  if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return null;

  let bytes: Uint8Array;
  try { bytes = Buffer.from(encoded, 'base64'); }
  catch { return null; }
  if (bytes.length < 8 + 12 + 13 || !PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) return null;

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const compressed: Uint8Array[] = [];
  while (offset + 12 <= bytes.length) {
    const length = readU32(bytes, offset);
    offset += 4;
    if (length > bytes.length - offset - 8) return null;
    const type = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
    offset += 4;
    const data = bytes.subarray(offset, offset + length);
    offset += length + 4; // CRC is covered by PNG decoder / not security-relevant after strict structural bounds.
    if (type === 'IHDR') {
      if (data.length !== 13 || width || height) return null;
      width = readU32(data, 0);
      height = readU32(data, 4);
      bitDepth = data[8];
      colorType = data[9];
      if (data[10] !== 0 || data[11] !== 0 || data[12] !== 0) return null;
    } else if (type === 'IDAT') {
      compressed.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }
  if (width !== SIGNATURE_WIDTH || height !== SIGNATURE_HEIGHT || bitDepth !== 8 || !compressed.length) return null;
  const bytesPerPixel = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!bytesPerPixel) return null;
  const stride = width * bytesPerPixel;
  const expected = (stride + 1) * height;
  let inflated: Uint8Array;
  try {
    inflated = inflateSync(Buffer.concat(compressed.map((chunk) => Buffer.from(chunk))), { maxOutputLength: expected });
  } catch { return null; }
  if (inflated.length !== expected) return null;

  let source = 0;
  let previous = new Uint8Array(stride);
  let pixels = 0;
  let minX = width;
  let maxX = -1;
  let minY = height;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[source++];
    if (filter > 4) return null;
    const row = new Uint8Array(stride);
    for (let index = 0; index < stride; index += 1) {
      const raw = inflated[source++];
      const left = index >= bytesPerPixel ? row[index - bytesPerPixel] : 0;
      const up = previous[index];
      const upLeft = index >= bytesPerPixel ? previous[index - bytesPerPixel] : 0;
      const adjustment = filter === 0 ? 0
        : filter === 1 ? left
          : filter === 2 ? up
            : filter === 3 ? Math.floor((left + up) / 2)
              : paeth(left, up, upLeft);
      row[index] = (raw + adjustment) & 0xff;
    }
    for (let x = 0; x < width; x += 1) {
      const index = x * bytesPerPixel;
      const red = row[index];
      const green = row[index + 1];
      const blue = row[index + 2];
      const alpha = colorType === 6 ? row[index + 3] : 255;
      // 투명 캔버스 배경과 흰 종이 배경 모두 잉크로 세지 않는다.
      if (alpha < 24 || (red > 245 && green > 245 && blue > 245)) continue;
      pixels += 1;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    previous = row;
  }
  if (!pixels) return null;
  return { pixels, width: maxX - minX + 1, height: maxY - minY + 1 };
}

export function hasMeaningfulFreepassSignature(value: unknown): boolean {
  const ink = inspectFreepassSignature(value);
  return !!ink
    && ink.pixels >= MIN_INK_PIXELS
    && ink.width >= MIN_INK_WIDTH
    && ink.height >= MIN_INK_HEIGHT;
}
