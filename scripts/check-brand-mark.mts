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
/* ★PNG 푸는 일은 «자»(measure-brand-mark)와 한 코드를 본다 — 둘이 갈리면 같은 그림을 두 값으로 읽는다. */
import { decodePng, type Png } from './lib/png.mts';
import { WHITELABELS } from '../lib/whitelabel.ts';

const root = new URL('../', import.meta.url);
const read = (f: string) => readFileSync(new URL(f, root));

/** 채널 표(`lib/whitelabel.ts`)가 실제로 «화면에 거는» 마크만 검사한다 — 안 쓰는 예비 파일은 뺀다. */
function markPaths(): string[] {
  const src = readFileSync(new URL('lib/whitelabel.ts', root), 'utf8');
  const found = new Set<string>();
  for (const m of src.matchAll(/logo:\s*\{[^}]*?src:\s*'([^']+)'/g)) found.add(m[1]);
  return [...found];
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

/* ── 공유 미리보기 그림이 있는가 ────────────────────────────────────────────
 * 카톡·라인에 링크를 붙였을 때 뜨는 그림(`og:image`)이다.
 * ⚠ 안 정해 주면 **상대가 고른다** — 실제로 카카오가 머리띠 심볼(232×190)을 주워다
 *   정사각으로 잘라, 간판이 잘린 채 나갔다(2026-09-08 사장님 지적).
 * ★굽는 것은 `npm run make:og` — 채널을 더하거나 마크를 바꾸면 다시 돌린다.
 *   여기서 막지 않으면 «채널을 판 그날»에는 아무도 모르고, 링크를 보낸 뒤에야 안다.
 * ★1200×630 = OG 표준 비율. 크기까지 재는 이유는, 마크를 바꾸고 다시 굽지 않으면
 *   옛 그림이 그대로 남기 때문이다(파일이 있기만 하면 통과해 버린다).
 */
{
  /* ★표를 «읽지» 말고 그대로 «쓴다» — 정규식으로 훑으면 이웃 줄을 물어 엉뚱한 채널을 잡는다
       (실제로 노브랜드 `freepass` 를 잡았다). 굽는 쪽(`make-og`)과 같은 목록을 본다. */
  for (const wl of WHITELABELS) {
    if (!wl.logo) continue;   // 워드마크뿐인 채널은 글자 카드로 나가는 편이 낫다(`ogImage` 머리말)
    const file = `public/brand/og-${wl.key}.png`;
    let png: Png | null = null;
    try { png = decodePng(read(file)); } catch { png = null; }
    if (!png) {
      fails.push(
        `${file} — **공유 미리보기 그림이 없습니다**(채널 「${wl.key}」).
` +
        '      → `npm run make:og` 를 돌리세요. 없으면 카톡이 페이지에서 아무 그림이나 주워 갑니다.',
      );
      continue;
    }
    if (png.w !== 1200 || png.h !== 630) {
      fails.push(
        `${file} — 크기가 ${png.w}×${png.h} 입니다(1200×630 이어야 합니다).
` +
        '      → `npm run make:og` 로 다시 구우세요.',
      );
    }
  }
}

if (fails.length) {
  console.error('\n채널 마크(CI) 규격에 어긋납니다:\n');
  for (const f of fails) console.error(`  ✗ ${f}`);
  console.error('\n규격 = 투명 배경(RGBA) · 여백 없음(잉크가 네 변에 닿는다).\n');
  process.exit(1);
}

console.log(`채널 마크 ${markPaths().length}개 — 투명 배경 · 여백 없음 ✓`);
