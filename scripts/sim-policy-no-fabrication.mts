/**
 * 정책이 안 붙은 매물에 **조건을 지어내지 않는다**(사장님 2026-08-07
 * 「없으면 없다 · 미입력이면 미입력이다 · 차라리 대여료만 맞게 보여주는 게 낫지」).
 *
 * 이게 왜 규칙이 됐나 — erp3 절연 뒤 매물이 든 옛 policy_code(pol_xxx)가 새 정책 키
 * (FP-RP0xx-RENT)와 안 맞아 **816대 전부 미연결**이었는데, 화면은 전부 같은
 * 「무심사 · 연 30,000km · 만 26세 이상 · 위약 잔여 대여료의 30%」를 보이고 있었다.
 * 그 공급사가 주지도 않은 조건이다. 영업자가 손님에게 그대로 말하면 없는 약속이 된다.
 * 빈칸보다 나쁘다 — 빈칸은 물어보게 만들지만 지어낸 값은 안 물어보게 만든다.
 */
import assert from 'node:assert/strict';
import { toV4Record } from '../lib/firebase/rtdb-records';
import { publicPolicy } from '../lib/domain/public-catalog';

const base = {
  car_number: '12가3456', maker: '현대', model: '아반떼',
  price: { '36': { rent: 500000, deposit: 1000000 } },
};

// ① 정책 미연결 — 조인 맵에 그 코드가 없다(절연 뒤 실제 상태 그대로)
const orphan = toV4Record('product', 'veh_orphan', { ...base, policy_code: 'pol_freepassstd' }, 'co', {}) as Record<string, unknown>;
const pol = (orphan._policy || {}) as Record<string, unknown>;
assert.deepEqual(pol, {}, `정책 미연결 매물에 값이 지어졌습니다: ${JSON.stringify(pol).slice(0, 200)}`);

// ② 정책 연결됨 — 공급사 명시값은 그대로, 빈칸은 표준으로 보충(기존 약속 유지)
const joined = toV4Record('product', 'veh_linked', { ...base, policy_code: 'FP-RP012-RENT' }, 'co',
  { 'FP-RP012-RENT': { policy_code: 'FP-RP012-RENT', annual_mileage: '연 40,000km' } }) as Record<string, unknown>;
const jp = (joined._policy || {}) as Record<string, unknown>;
assert.equal(jp.annual_mileage, '연 40,000km', '공급사 명시값이 기본값에 덮였습니다.');
assert.ok(Object.keys(jp).length > 5, '연결된 정책에는 기본값 보충이 살아 있어야 합니다.');

// ③ 손님 화면도 같은 규칙 — 정책이 없으면 null(줄이 아예 안 선다)
assert.equal(publicPolicy(null), null, '손님 화면에 정책 없이 조건이 지어졌습니다.');
assert.equal(publicPolicy({}), null, '빈 정책에서 조건이 지어졌습니다.');
assert.ok(publicPolicy({ annual_mileage: '연 40,000km' }), '연결된 정책은 손님 화면에 나가야 합니다.');

console.log('통과 — 정책 미연결 매물에 조건을 지어내지 않는다');
