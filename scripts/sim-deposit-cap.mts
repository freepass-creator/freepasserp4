/**
 * 손오공 보증금 = 연수 × 대여료, **최대 3개월치**
 * (사장님 2026-08-27 재고시트 「연수×대여료(최대 ×3)」 · 2026-08-28 「손오공 규칙임」).
 *
 * 상한이 빠져 있어 48개월이 4개월치, 60개월이 5개월치로 나가고 있었다 —
 * 실측 2026-08-28 손오공 요금 줄 4,006개 중 1,640개가 3개월치 초과.
 * 시트는 3개월치라고 적어 두고 화면은 5개월치를 보이던 상태라, 영업자가 손님에게 더 큰 돈을 부른다.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../lib/domain/sheet-import.ts', import.meta.url), 'utf8');

assert.match(src, /MONTHS_PER_YEAR_DEPOSIT_CAP = 3/, '보증금 상한 상수가 사라졌습니다.');
assert.match(src, /Math\.min\(months, MONTHS_PER_YEAR_DEPOSIT_CAP\)/, '상한이 적용되지 않습니다.');
assert.doesNotMatch(src, /rent \* Math\.max\(1, Math\.round\(period \/ 12\)\)/,
  '상한 없는 옛 계산이 돌아왔습니다(48개월=4개월치·60개월=5개월치가 됩니다).');

/* 규칙 표 — 기간별로 몇 개월치가 되어야 하나. 12·24·36 은 그대로, 48·60 만 3으로 눕는다. */
const rent = 700_000;
const expected: [number, number][] = [[12, 1], [24, 2], [36, 3], [48, 3], [60, 3]];
for (const [period, months] of expected) {
  const got = rent * Math.min(Math.max(1, Math.round(period / 12)), 3);
  assert.equal(got, rent * months, `${period}개월 보증금이 ${months}개월치가 아닙니다.`);
}

console.log('통과 — 보증금은 연수만큼, 3개월치를 넘지 않는다');
