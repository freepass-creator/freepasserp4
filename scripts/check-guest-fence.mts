/**
 * **공급사 전용 채널의 «울타리»가 모든 문에 서 있는가.** 읽기 전용. 없으면 exit 1.
 *
 * ★왜(2026-09-10 코덱스 집중검토 — 운영에서 재현된 «치명»):
 * ```
 *   /api/catalog/feed?p=RP023&wl=eancar  → 오토플러스 71대가 이안카 채널로 나왔다
 *   /q/RP023_05수4035?wl=eancar          → 200 · 이안카 간판 아래 남의 차 상세가 열렸다
 * ```
 *   이안카에 「**이안카 차만 모아서 주는 거**」라고 약속하고 만든 채널인데, 주소 한 줄로 무너졌다.
 *
 * ★★**문이 넷이었다** — 하나씩 막다가 세 번 새는 것을 봤다:
 *   ㉠ 목록 API(`feed`) — 손님이 준 `?p=` 를 그대로 믿었다
 *   ㉡ 상세 API(`quote`) — 화면이 못 찾으면 이리로 다시 묻는 폴백이 있다
 *   ㉢ 상세 페이지 본문
 *   ㉣ **상세 페이지 «메타»** — 제목·설명·OG 를 만드느라 같은 함수를 한 번 더 부른다.
 *      ㉢만 막았더니 HTML 에 남의 차번·차명이 **여섯 번** 남았고, 카톡 미리보기로 나갈 참이었다.
 *
 * ⚠ 그래서 이 자는 「울타리를 쳤나」가 아니라 **「문마다 쳤나」**를 센다.
 *   `loadGuestQuote(...)` 를 부르면서 **셋째 인자(공급사)를 안 넘긴 자리**가 있으면 그게 구멍이다.
 * ⚠ 판정 규칙 자체는 표 한 곳(`lib/whitelabel.ts` `channelSellsProduct`)이다 — 여기서 또 판정하지 않는다.
 *
 *   npm run check:fence
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const hits: string[] = [];
const CALL = 'loadGuestQuote(';

function* walk(dir: string): Generator<string> {
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) { if (e.name !== 'node_modules') yield* walk(rel); continue; }
    if (/\.tsx?$/.test(e.name)) yield rel;
  }
}

/* ── ① 상세를 여는 «모든» 자리가 공급사를 넘기는가 ─────────────────────── */
for (const f of walk('app')) {
  const src = readFileSync(join(ROOT, f), 'utf8');
  if (!src.includes('loadGuestQuote(')) continue;
  /*
   * 호출 하나하나를 본다 — 한 파일에 둘 있는 곳이 있다(본문 + 메타).
   * ⚠ **괄호를 «세어» 인자를 뗀다.** 정규식으로 첫 `)` 까지 끊었더니
   *   `S(url.searchParams.get('a'))` 의 안쪽 괄호에서 잘려 **멀쩡한 호출을 구멍이라 했다**(2026-09-10).
   */
  let at = src.indexOf(CALL);
  while (at >= 0) {
    let i = at + CALL.length;
    let depth = 1;
    while (i < src.length && depth > 0) {
      if (src[i] === '(') depth += 1;
      else if (src[i] === ')') depth -= 1;
      i += 1;
    }
    const args = src.slice(at + CALL.length, i - 1);
    if (!/providerCode/.test(args)) {
      const line = src.slice(0, at).split('\n').length;
      hits.push(`  ${f}:${line}\n    loadGuestQuote 에 «공급사»를 안 넘겼습니다 — 이 문으로 남의 차가 나갑니다\n    → 세 번째 인자로 String(wl.providerCode || '') 를 넘기세요`);
    }
    at = src.indexOf(CALL, i);
  }
}

/* ── ② 목록 API 가 손님이 준 `?p=` 를 그대로 믿지 않는가 ────────────────── */
const feed = readFileSync(join(ROOT, 'app/api/catalog/feed/route.ts'), 'utf8');
if (!feed.includes('guestProviderFence')) {
  hits.push('  app/api/catalog/feed/route.ts\n    guestProviderFence 가 없습니다 — 손님이 준 ?p= 를 그대로 믿고 있습니다\n    → 호스트(+?wl=)로 채널을 풀고 그 채널의 providerCode 를 강제하세요');
}

/* ── ③ 판정 규칙이 표 한 곳에 있는가 ─────────────────────────────────── */
const table = readFileSync(join(ROOT, 'lib/whitelabel.ts'), 'utf8');
for (const fn of ['channelSellsProduct', 'guestProviderFence']) {
  if (!table.includes(`export function ${fn}`)) {
    hits.push(`  lib/whitelabel.ts\n    ${fn} 가 없습니다 — 울타리 판정은 표 한 곳에 있어야 합니다`);
  }
}
/* 울타리를 «정제 전»에 쳐야 한다 — 정제 뒤에는 공급사 칸이 지워져 있어 아무것도 못 막는다. */
const quote = readFileSync(join(ROOT, 'lib/server/guest-quote.ts'), 'utf8');
if (!quote.includes('channelSellsProduct')) {
  hits.push('  lib/server/guest-quote.ts\n    울타리가 «정제 전»에 없습니다 — 정제 뒤에는 공급사 칸이 지워져 막을 수 없습니다\n    → sanitizeProductForGuest 보다 «앞»에서 판정하세요');
}

void relative; void sep;
console.log('\n공급사 전용 채널 — 울타리가 문마다 서 있는가\n');
if (hits.length) {
  console.error(`✗ 구멍 ${hits.length}건\n\n${hits.join('\n')}\n`);
  process.exit(1);
}
console.log('  ✓ 상세를 여는 자리가 모두 공급사를 넘긴다(본문 · 메타 · API)');
console.log('  ✓ 목록 API 가 서버에서 채널을 판정한다');
console.log('  ✓ 판정 규칙이 표 한 곳에 있고, 울타리가 «정제 전»에 선다\n');
