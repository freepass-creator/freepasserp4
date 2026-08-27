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
// 조건 칸 = 주행 약정 · 보험 포함 여부(사장님 2026-08-28). 인수형도 같은 조건을 적는다 —
//  「만기인수」는 이제 갈래 줄이 말하므로 조건에 또 적으면 같은 말이 두 번 나온다.
assert.ok(plans.every((x) => !/만기인수/.test(x.condition)), '조건 칸에 「만기인수」가 남아 있습니다.');
const withPol = pricePlanList({
  price: { '24': { rent: 700000, deposit: 0 } },
  _policy: { annual_mileage: '연 20,000km', insurance_included: '포함(회사 가입)' },
} as unknown as EntityRecord);
assert.equal(withPol[0].condition, '연 20,000km · 보험 포함', `조건 칸이 틀렸습니다: ${withPol[0].condition}`);
const sep = pricePlanList({
  price: { '24': { rent: 700000, deposit: 0 } },
  _policy: { annual_mileage: '연 20,000km', insurance_included: '고객 개인보험 별도' },
} as unknown as EntityRecord);
assert.equal(sep[0].condition, '연 20,000km · 보험 별도', `보험 별도 판정이 틀렸습니다: ${sep[0].condition}`);
// 갈래는 «글자»가 아니라 플래그로 판정한다 — 표기가 바뀌어도 안 무너진다.
assert.equal(plans.filter((x) => x.acquisition).length, 2, '인수형 플래그가 안 섭니다.');
assert.equal(plans.filter((x) => !x.acquisition).length, 2, '반납형 플래그가 안 섭니다.');
for (const x of plans.filter((y) => y.acquisition)) assert.equal(x.standard, false, '인수형이 표준으로 잡혔습니다.');

// 인수형이 없는 차는 갈래 줄을 세우지 않는다(하나뿐인 갈래에 이름표는 군더더기).
const only = pricePlanList({ price: { '36': { rent: 900000, deposit: 0 } } } as unknown as EntityRecord);
assert.equal(only.every((x) => !x.acquisition), true);

const src = readFileSync(new URL('../components/ProductPriceTable.tsx', import.meta.url), 'utf8');
assert.match(src, /const split = ret\.length > 0 && acq\.length > 0/, '갈래 분기가 사라졌습니다.');
// 반납형은 이름표를 안 붙인다(기본이라 필요 없다) — 인수형만 세운다.
assert.doesNotMatch(src, /groupHead/, '갈래 이름표를 반납형에도 붙이는 옛 구조가 돌아왔습니다.');
assert.match(src, /<tr key="g-acq">/, '인수형 갈래 줄이 없습니다.');
/* 주석에는 옛 문구가 «왜 바꿨는지»로 남아 있다 — 화면에 나가는 글자만 본다. */
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
assert.doesNotMatch(code, /인수한다|반납한다/, '이름표가 서술문입니다 — 명사로 적습니다.');
assert.doesNotMatch(src, /condition === '만기인수'/, '갈래를 조건 글자로 판정하고 있습니다(플래그를 쓰세요).');

console.log('통과 — 반납형·인수형이 갈려 선다');
