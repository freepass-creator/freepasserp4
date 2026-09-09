/**
 * **채널이 «바꿀 수 있는 것»이 문서와 어긋났는지 본다.** 읽기 전용.
 *
 * ★왜(사장님 2026-09-09 「커스터마이징 하는 부분을 골라보자. **공통 영역과 커스터마이징 할 거**」)
 *   가르는 선은 하나다 — **표(`lib/whitelabel.ts`)에 «칸»이 있으면 채널 몫, 없으면 공통.**
 *   그 선을 `docs/화이트라벨-공통과-개별.md` 에 적어 뒀는데, 칸은 **코드에서 늘어난다.**
 *   누가 칸 하나를 조용히 더하면 문서는 그날부터 틀린 말이 되고, 다음 사람은 그 문서를 믿고
 *   「그건 공통이야」라고 답한다. **거짓말하는 매뉴얼은 없느니만 못하다.**
 *
 * ★기계가 확인할 수 있는 것만 본다:
 *   ① `Whitelabel` 타입의 칸이 전부 문서에 적혀 있나
 *   ② 필터 두 축의 «집 기본»이 문서와 같나(빠른필터 수 · 세부필터 이름과 순서)
 *   판단·이력은 사람 몫이라 여기서 안 본다.
 *
 *   npm run check:whitelabel
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { AXIS_LABEL, DEFAULT_QUICK, SHOP_AXES } from '../lib/shop/query';
import { FREEPASS, WHITELABELS } from '../lib/whitelabel';

/** 폴더든 파일이든 받아 `.ts`/`.tsx` 만 훑는다. */
function* walk(path: string): Generator<string> {
  if (!statSync(path, { throwIfNoEntry: false })) return;
  if (statSync(path).isFile()) { yield path; return; }
  for (const name of readdirSync(path)) yield* walk(join(path, name));
}

const DOC = 'docs/화이트라벨-공통과-개별.md';
const SRC = 'lib/whitelabel.ts';
const doc = readFileSync(DOC, 'utf8');
const src = readFileSync(SRC, 'utf8');

let bad = 0;
const ok = (what: string, detail: string) => console.log(`  ✓ ${what} — ${detail}`);
const fail = (what: string, detail: string) => { bad++; console.log(`  ✗ ${what}\n      ${detail}`); };
const must = (cond: boolean, what: string, detail: string) => (cond ? ok(what, detail) : fail(what, detail));

console.log('\n화이트라벨 — 공통과 개별이 문서와 맞나\n');

/* ── ① 표의 «칸»이 전부 문서에 있나 ─────────────────────────────────────
   `Whitelabel` 타입 본문에서 최상위 칸 이름만 긁는다(들여쓰기 두 칸 = 최상위). */
const body = src.slice(src.indexOf('export type Whitelabel = {'), src.indexOf('\n};'));
const fields = [...body.matchAll(/^ {2}([a-zA-Z][a-zA-Z0-9]*)\??:/gm)].map((m) => m[1]);
must(fields.length > 10, '칸을 읽었다', `${fields.length}칸 — ${fields.join(' · ')}`);

const undocumented = fields.filter((f) => !doc.includes(`\`${f}\``));
must(undocumented.length === 0, '모든 칸이 문서에 있다',
  undocumented.length
    ? `문서에 없는 칸: ${undocumented.join(', ')}\n      → ${DOC} §2 표에 한 줄 적는다. 「안 적으면 어떻게 되는지」까지 적어야 그게 그 칸의 공통값이다.`
    : `${fields.length}칸 전부 §2 표에 있다`);

/* ── ② 필터 두 축의 «집 기본» ───────────────────────────────────────── */
must(doc.includes(`**아홉**`) && DEFAULT_QUICK.length === 9, '빠른필터 기본 수',
  `코드 ${DEFAULT_QUICK.length}개 · 문서 「아홉」`);

must(doc.includes('**열둘**') && SHOP_AXES.length === 12, '세부필터 기본 수',
  `코드 ${SHOP_AXES.length}축 · 문서 「열둘」`);

/* 축은 «순서»가 뜻이다(손님이 좁혀 가는 차례) — 이름을 그 순서대로 이어 적었는지 본다. */
const axisLine = SHOP_AXES.map((a) => AXIS_LABEL[a]).join(' · ');
must(doc.includes(axisLine), '세부필터 축 이름과 순서',
  doc.includes(axisLine) ? axisLine : `문서가 이 줄을 그대로 담아야 한다:\n      ${axisLine}`);

/* ── ③ 화면이 «채널 이름»으로 갈라서지 않는가 ───────────────────────────
   「칸이 없으면 공통」은 화면이 채널 키를 안 볼 때만 참이다. `wl.key === 'eancar'` 한 줄이
   들어가는 순간 그 화면은 채널마다 다른 물건이 되고, 표를 읽어도 무엇이 다른지 알 수 없다.
   ⇒ 다르고 싶으면 «칸»을 만든다. 그래야 표 한 줄만 보고도 그 채널이 무엇이 다른지 안다.
   ★`key` 자체를 쓰는 것(로그·미리보기 꼬리표·저장 열쇠)은 막지 않는다 — 막는 것은 «비교»다. */
const SCREENS = ['app/(shop)', 'components/shop', 'components/WhitelabelFrame.tsx'];
const KEYS = [FREEPASS.key, ...WHITELABELS.map((w) => w.key)];
const branchy: string[] = [];
for (const dir of SCREENS) {
  for (const file of walk(dir)) {
    const text = readFileSync(file, 'utf8');
    /* 빈칸을 걷고 본다 — `=== 'eancar'` 와 `==='eancar'` 는 같은 말이다(따옴표 세 가지 다). */
    const flat = text.replace(/\s+/g, '');
    for (const k of KEYS) {
      const hit = ['===', '!=='].some((op) => ["'", '"', '`'].some((q) => flat.includes(op + q + k + q)));
      if (hit) branchy.push(file + ' — 채널 «' + k + '» 로 갈라섬');
    }
  }
}
must(branchy.length === 0, '화면이 채널 이름으로 안 갈라선다',
  branchy.length
    ? `${branchy.join('\n      ')}\n      → 화면에서 분기하지 말고 «표에 칸»을 만든다(${DOC} §5).`
    : `손님 화면 ${SCREENS.length}곳에 채널 키 비교가 없다`);

/* ── ④ 지금 «누가 무엇을» 맞춤판으로 쓰나 ───────────────────────────────
   검사가 아니라 «현황»이다. 어긋난 게 없어도 찍는다 — 물으면 여기서 답한다.
   ★채널이 통째로 갈리지 않는다. 칸마다 갈린다(문서 §0). 그래서 칸 이름을 나열한다. */
console.log('\n지금 현황 — 표준판(안 적음) · 맞춤판(적음)\n');
const OPTIONAL = fields.filter((f) => body.includes(`  ${f}?:`) && f !== 'key');
for (const w of [FREEPASS, ...WHITELABELS]) {
  const rec = w as unknown as Record<string, unknown>;
  const custom = OPTIONAL.filter((f) => rec[f] !== undefined);
  console.log(`  ${w.key.padEnd(18)} ${custom.length ? `맞춤판 ${custom.join(' · ')}` : '전부 표준판'}`);
}

console.log('');
console.log(bad ? `✗ 어긋난 것 ${bad}건 — ${DOC} 을 고친다(검사를 고쳐 통과시키지 마라).\n`
                : '✓ 채널이 바꿀 수 있는 것과 문서가 일치합니다.\n');
process.exit(bad ? 1 : 0);
