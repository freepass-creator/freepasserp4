/**
 * **하허호 F86 감사 판정 반례 시험** — `lib/server/f86-audit-checks.ts`. 시트·API 없이 돈다.
 *
 * ★2026-09-18 — 신선도 검사가 확정 탭명 규격을 못 따라가 정시 회차가 매번 빨간불이었다
 *   (run 35235961510 · 35304903901: 칸 44,462개 어긋남 0 인데 「탭 이름에 발행 시각이 없다」 19건).
 *   고치면서 «느슨해지지» 않았는지를 반례로 잡는다 — 옛 꼴·묵은 시각·시각 없는 종합·종합 없음·칸 어긋남은 여전히 실패.
 *
 *   npx tsx --require ./scripts/lib/server-only-shim.cjs scripts/sim-f86-audit-checks.mts
 */
import assert from 'node:assert/strict';
import { f86TabTitle } from '../lib/server/channel-f86-plan';
import { salesPublishTabMark } from '../lib/server/sales-publish-snapshot';
import { checkF86TabFreshness, compareF86Cells, compareF86TabTitles, f86MarkEpochMs, parseF86TabName } from '../lib/server/f86-audit-checks';

/** KST 벽시계 → epoch ms */
const kst = (y: number, mo: number, d: number, h: number, mi: number, s = 0) => Date.UTC(y, mo - 1, d, h - 9, mi, s);
const NOW = kst(2026, 9, 18, 13, 10);
const fresh = (titles: string[], now = NOW, retro = true, maxAgeMin = 120) => checkF86TabFreshness({ titles, retro, now, maxAgeMin });
const has = (fails: string[], re: RegExp) => fails.some((f) => re.test(f));
let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${name}`); };

/** 운영 회차 35304903901 의 탭 모양 그대로 — 종합만 시각, 회사 18장은 「회사 · N대」. */
const COMPANIES: [string, number][] = [
  ['손오공', 234], ['이안카', 164], ['아이카', 40], ['오토플러스', 60], ['빌린카', 30], ['아이언', 25], ['우리캐피탈', 12], ['케이에이치', 9],
  ['에스에이', 20], ['스타스카이', 11], ['제이앤제이', 8], ['웰릭스', 7], ['에코', 6], ['경진', 5], ['리더스', 4], ['마음카', 3], ['센트로', 2], ['렌트존', 1],
];
const PROD_TITLES = ['종합 09.18 13:03 · 389대', ...COMPANIES.map(([c, k]) => `${c} · ${k}대`)];

console.log('\n■ F86 감사 판정 반례');

ok('확정 규격(종합만 시각·초 없음 · 회사 「회사 · N대」)은 통과한다 — 운영 회차 탭 이름 그대로', () => {
  const r = fresh(PROD_TITLES);
  assert.deepEqual(r.fails, []);
  assert.equal(r.markedTabs, 1);
  assert.equal(r.oldestTitle, '종합 09.18 13:03 · 389대');
  assert.equal(r.oldestMin, 7);
});

ok('발행기(f86TabTitle + salesPublishTabMark)가 짓는 이름을 감사기가 그대로 알아본다 — 두 벌 계약 금지', () => {
  const mark = salesPublishTabMark({ capturedAt: new Date(kst(2026, 9, 18, 13, 3, 41)).toISOString() });
  assert.equal(mark, '09.18 13:03');
  const titles = [f86TabTitle('종합', 389, mark, true), ...COMPANIES.map(([c, k]) => f86TabTitle(c, k, mark, true))];
  assert.deepEqual(titles, PROD_TITLES);
  assert.deepEqual(fresh(titles).fails, []);
  // 하허호 밖 채널은 전 탭 시각 — 역시 통과
  const other = COMPANIES.slice(0, 3).map(([c, k]) => f86TabTitle(c, k, mark, false));
  assert.deepEqual(fresh(other, NOW, false).fails, []);
});

ok('회사 탭은 시각이 없어도 통과한다(시각 문패는 종합 하나)', () => {
  const r = fresh(['종합 09.18 13:03 · 3대', '손오공 · 2대', '이안카 · 1대']);
  assert.deepEqual(r.fails, []);
});

ok('옛 꼴(초 있음) + 묵은 종합 시각은 실패한다', () => {
  const r = fresh(['종합 09.17 10:05:11 · 391대', '손오공 · 234대']);
  assert.ok(has(r.fails, /F86 규격.*밖이다 — 「종합 09\.17 10:05:11/), J(r.fails));
  assert.equal(r.markedTabs, 0);
});

ok('옛 꼴(초 있음)은 시각이 «갓» 찍혔어도 실패한다 — 콜론 둘은 A1 파싱을 깬다(9bef7bf0)', () => {
  const r = fresh(['종합 09.18 13:03:11 · 389대', '손오공 · 234대']);
  assert.ok(has(r.fails, /F86 규격.*밖이다/), J(r.fails));
  assert.ok(!has(r.fails, /「종합」 탭이 없다/), '꼴이 틀린 종합을 «없다»로 오판하지 않는다');
});

ok('새 꼴이라도 종합 시각이 묵었으면 실패한다(허용 120분)', () => {
  const r = fresh(['종합 09.17 10:05 · 391대', '손오공 · 234대']);
  assert.ok(has(r.fails, /F86 이 \d+분째 멈춰 있다\(허용 120분\)/), J(r.fails));
  assert.equal(r.oldestMin, 27 * 60 + 5);
});

ok('허용 경계 — 정확히 120분은 통과, 121분은 실패', () => {
  assert.deepEqual(fresh(['종합 09.18 11:10 · 1대']).fails, []);
  assert.ok(has(fresh(['종합 09.18 11:09 · 1대']).fails, /121분째 멈춰 있다/));
});

ok('종합에 시각이 없으면 실패한다', () => {
  const r = fresh(['종합 · 389대', '손오공 · 234대']);
  assert.ok(has(r.fails, /탭 이름에 발행 시각이 없다 — 「종합 · 389대」/), J(r.fails));
});

ok('종합 탭이 아예 없으면 실패한다(회사 탭만으로는 신선도를 못 댄다)', () => {
  const r = fresh(COMPANIES.map(([c, k]) => `${c} · ${k}대`));
  assert.ok(has(r.fails, /「종합」 탭이 없다/), J(r.fails));
  assert.ok(has(fresh([]).fails, /「종합」 탭이 없다/));
});

ok('회사 탭에 시각이 붙어 있으면(옛 「전 탭 시각」 규격) 실패한다', () => {
  const r = fresh(['종합 09.18 13:03 · 389대', '손오공 09.18 13:03 · 234대']);
  assert.ok(has(r.fails, /회사 탭에 발행 시각이 붙어 있다.*「손오공 · 234대」/), J(r.fails));
});

ok('미래 시각은 «갓 찍힘»으로 통과하지 못한다 — 작년 시각으로 읽혀 묵은 것이 된다', () => {
  const r = fresh(['종합 09.18 14:30 · 1대']);
  assert.ok(has(r.fails, /분째 멈춰 있다/), J(r.fails));
  assert.equal(f86MarkEpochMs('09.18 13:14', NOW), kst(2026, 9, 18, 13, 14), '시계 5분 어긋남까지는 이번 해');
});

ok('해 넘김 — 1월 1일 00:30 에 본 12.31 23:50 은 40분 전', () => {
  const now = kst(2027, 1, 1, 0, 30);
  const r = fresh(['종합 12.31 23:50 · 1대'], now);
  assert.deepEqual(r.fails, []);
  assert.equal(r.oldestMin, 40);
});

ok('없는 날짜·틀린 시각은 읽지 않는다', () => {
  assert.equal(f86MarkEpochMs('02.30 10:00', NOW), null);
  assert.equal(f86MarkEpochMs('09.18 24:00', NOW), null);
  assert.ok(has(fresh(['종합 13.01 10:00 · 1대']).fails, /읽을 수 없다/));
});

ok('하허호 밖 채널은 전 탭에 시각이 있어야 한다', () => {
  const r = fresh(['손오공 09.18 13:03 · 2대', '이안카 · 1대'], NOW, false);
  assert.ok(has(r.fails, /탭 이름에 발행 시각이 없다 — 「이안카 · 1대」/), J(r.fails));
});

ok('탭 이름 해석', () => {
  assert.deepEqual(parseF86TabName('종합 09.18 13:03 · 389대'), { company: '종합', mark: '09.18 13:03', count: 389 });
  assert.deepEqual(parseF86TabName('손오공 · 234대'), { company: '손오공', mark: null, count: 234 });
  assert.equal(parseF86TabName('종합 09.18 13:03:11 · 389대'), null);
  assert.equal(parseF86TabName('종합 09.18 13:03'), null);
});

ok('① 탭 이름·차례 — 같으면 통과, 다르거나 차례만 달라도 실패', () => {
  assert.deepEqual(compareF86TabTitles(PROD_TITLES, PROD_TITLES), []);
  assert.ok(has(compareF86TabTitles(PROD_TITLES.slice(1), PROD_TITLES), /없는 탭 종합/));
  const swapped = [PROD_TITLES[1], PROD_TITLES[0], ...PROD_TITLES.slice(2)];
  assert.ok(has(compareF86TabTitles(swapped, PROD_TITLES), /차례만 다름/));
});

/* ── ③ 칸 대조 — 신선도를 고치면서 칸 검사가 약해지지 않았나 ── */
const COLS = ['공급사명', '차량번호', '36개월', '최초등록'];
const TAB = { company: '손오공', cols: COLS, values: [['손오공', '12가3456', 1050000, 45292], ['손오공', '34나5678', 990000, '22-03']] as (string | number)[][] };
const GRID = (): unknown[][] => [COLS, ['손오공', '12가3456', 1050000, 45292], ['손오공', '34나5678', 990000, '22-03']];

ok('③ 칸이 전부 같으면 통과', () => {
  const r = compareF86Cells([TAB], [GRID()]);
  assert.deepEqual(r.fails, []);
  assert.equal(r.칸수, 8);
  assert.equal(r.차수, 2);
});

ok('③ 칸 값 하나라도 다르면 실패한다(시각을 고쳐도 칸 대조는 그대로)', () => {
  const g = GRID(); g[2][2] = 1000000;
  const r = compareF86Cells([TAB], [g]);
  assert.equal(r.어긋난칸수, 1);
  assert.ok(has(r.fails, /F86 칸 값이 원자 계획과 다르다 1칸/), J(r.fails));
  assert.match(r.칸어긋남.get('손오공·36개월')!.표본[0], /34나5678 시트「1000000」↔ 계획「990000」/);
});

ok('③ 머리글·줄 수·차번 차례가 다르면 실패한다', () => {
  const h = GRID(); h[0] = ['공급사명', '차량번호', '48개월', '최초등록'];
  assert.ok(has(compareF86Cells([TAB], [h]).fails, /머리글이 계획과 다르다/));
  const short = GRID().slice(0, 2);
  assert.ok(has(compareF86Cells([TAB], [short]).fails, /줄 수 — 실제 1 ↔ 기대 2/));
  const g = GRID(); [g[1], g[2]] = [g[2], g[1]];
  assert.ok(has(compareF86Cells([TAB], [g]).fails, /줄 차례가 계획과 다르다/));
  assert.ok(has(compareF86Cells([TAB], [[]]).fails, /머리글이 계획과 다르다/), '빈 탭');
});

function J(v: unknown) { return JSON.stringify(v); }
console.log(`\n✓ F86 감사 판정 반례 ${n}건 통과\n`);
