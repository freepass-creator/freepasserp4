/**
 * 대여료표 — **반납형과 인수형을 갈라 세운다**
 * (사장님 2026-08-28 「반납형 기본하고 인수형 정보가 있으면 구분해서 써주기로 했잖아 · 구분되게」).
 *
 * 손오공 구독은 403대 중 386대가 인수형을 들고 있다. 기간 오름차순으로 섞이면
 * 36개월 반납형 바로 밑에 36개월 인수형이 붙어, 조건 칸 넉 자를 못 보면 같은 상품의 다른 줄로 읽힌다.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pricePlanList } from '../lib/domain/product';
import type { EntityRecord } from '../lib/intake/entities';

const p = {
  price: {
    '36': { rent: 900000, deposit: 3000000 },
    '48': { rent: 850000, deposit: 3000000 },
    '36_인수형': { rent: 1200000, deposit: 3600000 },
    '48_인수형': { rent: 1100000, deposit: 4400000 },
  },
} as unknown as EntityRecord;

const plans = pricePlanList(p);
assert.equal(plans.length, 4);
// 갈래는 «글자»가 아니라 플래그로 판정한다 — 표기가 바뀌어도 안 무너진다.
assert.equal(plans.filter((x) => x.acquisition).length, 2, '인수형 플래그가 안 섭니다.');
assert.equal(plans.filter((x) => !x.acquisition).length, 2, '반납형 플래그가 안 섭니다.');
for (const x of plans.filter((y) => y.acquisition)) assert.equal(x.standard, false, '인수형이 표준으로 잡혔습니다.');

// 인수형이 없는 차는 갈래 줄을 세우지 않는다(하나뿐인 갈래에 이름표는 군더더기).
const only = pricePlanList({ price: { '36': { rent: 900000, deposit: 0 } } } as unknown as EntityRecord);
assert.equal(only.every((x) => !x.acquisition), true);

const src = readFileSync(new URL('../components/ProductPriceTable.tsx', import.meta.url), 'utf8');
assert.match(src, /const split = ret\.length > 0 && acq\.length > 0/, '갈래 분기가 사라졌습니다.');
assert.match(src, /groupHead\('반납형'/, '반납형 갈래 줄이 없습니다.');
assert.match(src, /groupHead\('인수형'/, '인수형 갈래 줄이 없습니다.');
assert.doesNotMatch(src, /condition === '만기인수'/, '갈래를 조건 글자로 판정하고 있습니다(플래그를 쓰세요).');

console.log('통과 — 반납형·인수형이 갈려 선다');
