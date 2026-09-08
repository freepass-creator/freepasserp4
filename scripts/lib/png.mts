/**
 * **PNG 을 손으로 푼다** — 그림 하나 재자고 이미지 라이브러리를 새로 들이지 않는다.
 *
 * ★왜 여기 있나 — 간판(CI) 을 다루는 도구가 둘이다:
 *   · `check-brand-mark.mts`  (게이트) 투명 배경·여백을 «막는다»
 *   · `measure-brand-mark.mts`(자)     치수·색·대비를 «잰다»
 *   둘이 각자 PNG 을 풀면 언젠가 한쪽만 고쳐져 **같은 그림을 두 값으로** 읽는다.
 *
 * 읽는 범위 = 8비트 · 인터레이스 아님 · 팔레트 아님. 우리 간판은 전부 여기 든다.
 * 벗어나면 던진다 — 조용히 0 을 돌려주면 「여백 없음 ✓」 같은 거짓 통과가 난다.
 */
import { inflateSync } from 'node:zlib';

export type Png = {
  w: number; h: number; colorType: number; hasAlpha: boolean;
  /** 화소 하나 → `[r, g, b, a]`. 알파가 없는 그림은 a = 255. */
  at: (x: number, y: number) => [number, number, number, number];
  /** 「잉크」 = 알파가 있으면 «비지 않은 화소», 없으면 «흰색이 아닌 화소». */
  ink: (x: number, y: number) => boolean;
};

export function decodePng(buf: Buffer): Png {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (sig.some((b, i) => buf[i] !== b)) throw new Error('PNG 이 아닙니다');

  let w = 0, h = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat: Buffer[] = [];
  for (let p = 8; p + 8 <= buf.length;) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const body = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      w = body.readUInt32BE(0); h = body.readUInt32BE(4);
      bitDepth = body[8]; colorType = body[9]; interlace = body[12];
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (bitDepth !== 8) throw new Error(`8비트 채널만 읽습니다(지금 ${bitDepth}비트)`);
  if (interlace !== 0) throw new Error('인터레이스 PNG 는 읽지 않습니다');

  const ch = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : colorType === 0 ? 1 : 0;
  if (!ch) throw new Error(`팔레트 PNG(colorType ${colorType})는 읽지 않습니다`);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const px = Buffer.alloc(h * stride);
  /* 필터 되돌리기 — PNG 은 줄마다 앞줄·왼쪽 화소를 빼 두고 저장한다. */
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? px[y * stride + i - ch] : 0;
      const b = y > 0 ? px[(y - 1) * stride + i] : 0;
      const c = i >= ch && y > 0 ? px[(y - 1) * stride + i - ch] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      px[y * stride + i] = v & 0xff;
    }
  }

  const hasAlpha = colorType === 6 || colorType === 4;
  const at = (x: number, y: number): [number, number, number, number] => {
    const o = y * stride + x * ch;
    if (ch === 4) return [px[o], px[o + 1], px[o + 2], px[o + 3]];
    if (ch === 3) return [px[o], px[o + 1], px[o + 2], 255];
    if (ch === 2) return [px[o], px[o], px[o], px[o + 1]];
    return [px[o], px[o], px[o], 255];
  };
  const ink = (x: number, y: number) => {
    const [r, g, b, a] = at(x, y);
    if (hasAlpha) return a > 8;
    return Math.min(r, g, b) < 250;
  };
  return { w, h, colorType, hasAlpha, at, ink };
}
