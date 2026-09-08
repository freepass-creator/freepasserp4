/**
 * **공유 미리보기 그림(og:image) 만들기** — 채널마다 한 장.
 *
 * 사장님 2026-09-08 「이거 줄 때 CI 있잖아 이거 **카카오톡 붙여넣으면 좀 맞춰서** 주라」 ·
 * 「암튼 저거 **규격화** 좀 해」.
 *
 * ⚠⚠ 무엇이 문제였나 — `og:image` 가 **아예 없었다.** 그래서 카카오가 페이지에서 아무 그림이나
 *   주워 갔고(머리띠 심볼 232×190), 그걸 **정사각으로 잘라** 노란 웃음이 잘려 나갔다.
 *   ⇒ 우리가 «그림을 정해서» 준다. 안 정하면 상대가 고른다.
 *
 * ## 규격
 *
 * ```
 *  ┌──────────── 1200 ────────────┐
 *  │        ┌── 630 ──┐           │  630   ← 카카오 «작은 카드»는 가운데를 정사각으로 자른다
 *  │        │  간판   │           │           그래서 잉크는 가운데 630×630 «안»에만 둔다
 *  │        └─────────┘           │
 *  └──────────────────────────────┘
 * ```
 * ★1200×630 = OG 표준 비율(1.91:1). 카카오·라인·슬랙·페북이 다 이 비율로 «큰 카드»를 그린다.
 * ★★**안전 영역은 가운데 630×630** — 작은 카드에서 잘려도 간판이 통째로 남아야 한다.
 *   실제로 잘려 본 뒤에 정한 값이다(위 사장님 지적).
 * ★바탕은 **흰색**. 채널색으로 칠하면 색이 밝은 채널(하허호 오렌지)에서 마크가 안 읽히고,
 *   어두운 채널에서는 카톡 말풍선과 뭉친다. 흰 바탕은 어느 채널에서나 같은 값을 낸다.
 * ★**글자는 안 넣는다.** 카톡 카드가 제목(「이안카 ✕ freepass」)과 설명을 이미 글자로 그린다 —
 *   그림에 또 적으면 같은 말이 두 번 나오고, 한글 글꼴을 그림에 심어야 해서 무거워진다.
 *
 * 실행 = `npm run make:og`  (채널을 더하거나 마크를 바꾸면 다시 돌린다)
 * 검사 = `npm run check:brand` — 마크 있는 채널에 이 그림이 없으면 exit 1
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import sharp from 'sharp';
import { WHITELABELS } from '../lib/whitelabel.ts';

/** OG 표준 — 1.91:1. */
const W = 1200, H = 630;
/** 카카오 작은 카드가 자르는 가운데 정사각. 잉크는 여기 «안»에만 둔다. */
export const SAFE = 630;
/** 안전 영역 «안»에서도 숨 쉴 자리를 남긴다 — 꽉 채우면 잘린 것처럼 보인다. */
const PAD = 90;

const root = new URL('../', import.meta.url);
const made: string[] = [];

for (const wl of WHITELABELS) {
  if (!wl.logo) continue;
  const src = new URL(`public${wl.logo.src}`, root);
  if (!existsSync(src)) { console.error(`✗ ${wl.key} — 마크 파일이 없습니다: ${wl.logo.src}`); process.exit(1); }

  const mark = sharp(readFileSync(src));
  const meta = await mark.metadata();
  const mw = meta.width || 1, mh = meta.height || 1;

  /* 안전 영역 − 여백 안에 «통째로» 들어가게 줄인다. 가로로 긴 간판도 세로로 긴 심볼도 같은 규칙. */
  const box = SAFE - PAD * 2;
  const scale = Math.min(box / mw, box / mh);
  const w = Math.max(1, Math.round(mw * scale));
  const h = Math.max(1, Math.round(mh * scale));

  const resized = await sharp(readFileSync(src)).resize(w, h, { fit: 'inside' }).png().toBuffer();
  const out = await sharp({
    create: { width: W, height: H, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
  })
    .composite([{ input: resized, left: Math.round((W - w) / 2), top: Math.round((H - h) / 2) }])
    .png({ compressionLevel: 9 })
    .toBuffer();

  const dest = new URL(`public/brand/og-${wl.key}.png`, root);
  writeFileSync(dest, out);
  made.push(`${wl.key}  ${mw}×${mh} → ${w}×${h}  (안전영역 ${box})`);
}

console.log(`공유 미리보기 ${made.length}장 — ${W}×${H} · 안전영역 가운데 ${SAFE}`);
for (const m of made) console.log(`   ${m}`);
