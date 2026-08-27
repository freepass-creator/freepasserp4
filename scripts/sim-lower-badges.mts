/**
 * 하단 뱃지 차례 — **심사조건이 맨 앞**, 모바일은 심사 하나만.
 *
 * 사장님 2026-08-07 「내가 분명히 하단 뱃지에 심사조건 맨 앞에 넣으라고 했는데」 /
 * 「상품구분 뱃지와 차량상태 뱃지를 모바일에서는 빼는 게 낫겠어 · 상세페이지에서 뱃지 확인하게끔」.
 *
 * 이 파일이 있는 이유 — 같은 차례를 목록 카드·상세 머리·요약줄 세 곳이 각각 적던 시절
 * 한 곳만 고치면 나머지가 그대로 남았다. 차례를 한 곳에서만 정하는지 검사한다.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { badgeSpecs, LOWER_BADGE_KEYS, LOWER_BADGE_KEYS_MOBILE } from '../components/product-card-badges';
import type { EntityRecord } from '../lib/intake/entities';

assert.deepEqual([...LOWER_BADGE_KEYS], ['cd', 'st', 'pt'], '하단 뱃지 맨 앞은 심사(cd)여야 합니다.');
assert.deepEqual([...LOWER_BADGE_KEYS_MOBILE], ['cd'], '모바일 하단 뱃지는 심사 하나만이어야 합니다.');

// 심사 뱃지가 실제로 만들어지나 — hideCredit 을 켜면 아예 안 생긴다(이것 때문에 카드에서 사라졌었다).
const p = { vehicle_status: '출고가능', product_type: '중고렌트', _policy: { screening_criteria: '무심사' } } as unknown as EntityRecord;
const keys = badgeSpecs(p, false, false, 'agent').map((s) => s.key);
assert.ok(keys.includes('cd'), `심사 뱃지가 안 만들어집니다(hideCredit 확인): ${keys.join(',')}`);
assert.ok(badgeSpecs(p, true, false, 'agent').every((s) => s.key !== 'cd'), 'hideCredit=true 인데 심사가 남았습니다.');

// 쓰는 쪽이 상수를 읽는지 — 차례를 직접 적으면 또 갈린다.
for (const f of ['components/product-card-atoms.tsx', 'components/product-card-badge-view.tsx']) {
  const src = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
  assert.match(src, /LOWER_BADGE_KEYS_MOBILE/, `${f} 가 모바일 차례 상수를 안 읽습니다.`);
  assert.doesNotMatch(src, /\[\s*'st'\s*,\s*'pt'\s*\]/, `${f} 가 뱃지 차례를 직접 적고 있습니다.`);
}

console.log('통과 — 하단 뱃지는 심사가 맨 앞, 모바일은 심사만');
