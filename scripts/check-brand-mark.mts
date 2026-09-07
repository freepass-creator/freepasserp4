/**
 * **채널 마크(CI)는 «잉크에 딱 맞게» 잘라서 넣는다** — 그림 안에 여백이 붙어 있으면
 * 화면 코드가 아무리 맞아도 간판이 본문 왼쪽 줄에서 밀린다.
 *
 * 무슨 일이 있었나 (2026-09-07) — 사장님 「좌측에 **CI 끝부분과 딱 정렬**되어야 하고
 * **CI가 너무 떨어져 있어**」. 머리띠 코드는 멀쩡했다(`padding: 0 24px` · 마크↔글자 `snug` 8).
 * 어긋난 것은 **그림 파일**이었다 — `uni-mark.png` 이 978×561 짜리 «흰 바탕 RGB» 였고
 * 실제 마크는 그 안 x 229~748 에만 그려져 있었다. 좌우로 각각 24% 가 빈 칸이라,
 * 높이 28 로 줄여 그리면 **왼쪽에 12px 짜리 보이지 않는 여백**이 생긴다.
 *   · 간판 잉크가 24 가 아니라 35.4 에서 시작 → 밑의 검색줄·조건칸(24)과 안 맞음
 *   · 마크↔「UNI」 간격이 8 이 아니라 19.4 → 「하나의 브랜드」로 안 읽힘
 *
 * ★그래서 여기서 막는다. 채널이 늘 때마다(= `WHITELABELS` 에 줄 하나) 새 마크가 들어오는데,
 *   여백 붙은 그림을 그대로 넣으면 **같은 어긋남이 채널마다 되풀이된다.**
 * ★규칙 둘 —
 *   ㉠ **투명 배경**(RGBA). 흰 네모를 깔고 있으면 머리띠 색이 흰색이 아닌 순간 네모가 드러난다.
 *   ㉡ **여백 없음**. 잉크가 그림의 네 변에 닿아야 한다(허용 1%).
 *
 * 실행 = `npm run check:brand`
 */
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const root = new URL('../', import.meta.url);
const read = (f: string) => readFileSync(new URL(f, root));

/** 채널 표(`lib/whitelabel.ts`)가 실제로 «화면에 거는» 마크만 검사한다 — 안 쓰는 예비 파일은 뺀다. */
function markPaths(): string[] {
  const src = readFileSync(new URL('lib/whitelabel.ts', root), 'utf8');
  const found = new Set<string>();
  for (const m of src.matchAll(/logo:\s*\{[^}]*?src:\s*'([^']+)'/g)) found.add(m[1]);
  return [...found];
}

type Png = { w: number; h: number; colorType: number; ink: (x: number, y: number) => boolean };

/** PNG 을 손으로 푼다 — 이 검사 하나 때문에 이미지 라이브러리를 새로 들이지 않는다. */
function decodePng(buf: Buffer): Png {
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

  /* 「잉크」 = 알파가 있으면 «비지 않은 화소», 없으면 «흰색이 아닌 화소». */
  const hasAlpha = colorType === 6 || colorType === 4;
  const ink = (x: number, y: number) => {
    const o = y * stride + x * ch;
    if (hasAlpha) return px[o + ch - 1] > 8;
    const min = ch === 1 ? px[o] : Math.min(px[o], px[o + 1], px[o + 2]);
    return min < 250;
  };
  return { w, h, colorType, ink };
}

const fails: string[] = [];

for (const rel of markPaths()) {
  const file = `public${rel}`;
  let png: Png;
  try {
    png = decodePng(read(file));
  } catch (e) {
    fails.push(`${file} — 읽지 못했습니다: ${(e as Error).message}`);
    continue;
  }

  if (png.colorType !== 6 && png.colorType !== 4) {
    fails.push(
      `${file} — **투명 배경이 아닙니다**(colorType ${png.colorType}).\n` +
      '      → 흰 네모를 깔고 있어, 머리띠 색이 흰색이 아닌 자리에서 네모가 드러납니다.',
    );
  }

  let x0 = png.w, x1 = -1, y0 = png.h, y1 = -1;
  for (let y = 0; y < png.h; y++) {
    for (let x = 0; x < png.w; x++) {
      if (!png.ink(x, y)) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) { fails.push(`${file} — 그려진 것이 없습니다(빈 그림).`); continue; }

  /* 허용 1% — 안티에일리어싱으로 한두 줄 옅어지는 것까지 잡지는 않는다. */
  const slack = (n: number) => Math.max(1, Math.round(n * 0.01));
  const pad = { 왼: x0, 오른: png.w - 1 - x1, 위: y0, 아래: png.h - 1 - y1 };
  const over = Object.entries(pad).filter(([k, v]) => v > slack(k === '왼' || k === '오른' ? png.w : png.h));
  if (over.length) {
    fails.push(
      `${file} — **여백이 붙어 있습니다**(${png.w}×${png.h} 중 ` +
      over.map(([k, v]) => `${k} ${v}px`).join(' · ') + ').\n' +
      '      → 간판 잉크가 그만큼 안으로 밀려, 밑의 본문 왼쪽 줄과 안 맞습니다.\n' +
      '      → 잉크에 딱 맞게 자른 뒤 넣습니다(잘린 원본은 git 이력에 남습니다).',
    );
  }
}

if (fails.length) {
  console.error('\n채널 마크(CI) 규격에 어긋납니다:\n');
  for (const f of fails) console.error(`  ✗ ${f}`);
  console.error('\n규격 = 투명 배경(RGBA) · 여백 없음(잉크가 네 변에 닿는다).\n');
  process.exit(1);
}

console.log(`채널 마크 ${markPaths().length}개 — 투명 배경 · 여백 없음 ✓`);
