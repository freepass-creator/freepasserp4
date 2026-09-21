/** 하허호 F86 고정 탭·신선도·칸 대조 반례 시험. */
import assert from 'node:assert/strict';
import { F86_BASE_TABS, f86BaseTabOf, f86TabTitle } from '../lib/server/channel-f86-plan';
import { checkF86TabFreshness, compareF86Cells, compareF86TabTitles, parseF86TabName } from '../lib/server/f86-audit-checks';

const NOW = Date.UTC(2026, 8, 21, 4, 10);
const TITLES = F86_BASE_TABS.map((t) => f86TabTitle(t, 99, '09.21 13:03', true)).concat('이안카 12대', '아이카 3대');
const fresh = (titles: string[], ageMin = 7) => checkF86TabFreshness({
  titles, retro: true, now: NOW, maxAgeMin: 120,
  modifiedAt: new Date(NOW - ageMin * 60000).toISOString(),
});
const has = (fails: string[], re: RegExp) => fails.some((f) => re.test(f));
let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${name}`); };

console.log('\n■ F86 감사 판정 반례');

ok('기본 네 탭 이름·차례와 문패 규칙이 고정이다', () => {
  assert.deepEqual(F86_BASE_TABS, ['상품리스트', '손오공상품', '픽업구독', '오플구독']);
  assert.deepEqual(F86_BASE_TABS.map((t) => f86TabTitle(t, 99, '09.21 13:03', true)), [
    '09.21 13:03 상품리스트 99대', '손오공상품 99대', '픽업구독 99대', '오플구독 99대',
  ]);
  assert.equal(f86TabTitle('이안카', 12, '09.21 13:03', true), '이안카 12대');
});

ok('손오공상품은 저신용 렌트+저신용 구독, 픽업은 별도다', () => {
  assert.equal(f86BaseTabOf({ provider_company_code: 'RP012', product_type: '중고렌트' }), '손오공상품');
  assert.equal(f86BaseTabOf({ provider_company_code: 'RP012', product_type: '오공구독' }), '손오공상품');
  assert.equal(f86BaseTabOf({ provider_company_code: 'RP012', product_type: '픽업구독' }), '픽업구독');
  assert.equal(f86BaseTabOf({ provider_company_code: 'RP023', product_type: '오플구독' }), '오플구독');
});

ok('상품리스트 시각+나머지 대수 문패는 통과한다', () => {
  const r = fresh(TITLES);
  assert.deepEqual(r.fails, []);
  assert.equal(r.oldestMin, 7);
  assert.equal(r.oldestTitle, '09.21 13:03 상품리스트 99대');
});

ok('고정 탭 누락·접미사·공급사 시각은 실패한다', () => {
  assert.ok(has(fresh(TITLES.filter((t) => !t.startsWith('손오공상품 '))).fails, /고정 기본 탭이 없다.*손오공상품/));
  assert.ok(has(fresh(['상품리스트 99대', ...TITLES.slice(1)]).fails, /발행 시각이 없다/));
  assert.ok(has(fresh([...TITLES.slice(0, 4), '이안카 09.21 13:03 · 12대']).fails, /회사 탭에 발행 시각/));
});

ok('상품리스트 시각 누락·노후는 실패한다', () => {
  assert.ok(has(fresh(['상품리스트 99대', ...TITLES.slice(1)]).fails, /발행 시각이 없다/));
  const stale = TITLES.map((t) => t.replace('09.21 13:03', '09.21 11:00'));
  assert.ok(has(fresh(stale).fails, /130분째 멈춰 있다/));
});

ok('탭 이름 해석과 차례 대조', () => {
  assert.deepEqual(parseF86TabName('이안카 12대'), { company: '이안카', mark: null, count: 12 });
  assert.deepEqual(parseF86TabName('09.21 13:03 상품리스트 99대'), { company: '상품리스트', mark: '09.21 13:03', count: 99 });
  assert.deepEqual(compareF86TabTitles(TITLES, TITLES), []);
  assert.ok(has(compareF86TabTitles([TITLES[1], TITLES[0], ...TITLES.slice(2)], TITLES), /차례만 다름/));
});

const COLS = ['공급사명', '차량번호', '36개월'];
const TAB = { company: '이안카', cols: COLS, values: [['이안카', '12가3456', 1050000]] as (string | number)[][] };
ok('칸이 같으면 통과하고 하나라도 다르면 실패한다', () => {
  assert.deepEqual(compareF86Cells([TAB], [[COLS, ['이안카', '12가3456', 1050000]]]).fails, []);
  const bad = compareF86Cells([TAB], [[COLS, ['이안카', '12가3456', 990000]]]);
  assert.equal(bad.어긋난칸수, 1);
  assert.ok(has(bad.fails, /1칸/));
});

console.log(`\n✓ F86 감사 판정 반례 ${n}건 통과\n`);
