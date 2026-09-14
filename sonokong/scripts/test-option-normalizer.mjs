import assert from 'node:assert/strict';
import { tcarPaidOptionNames as pick } from '../lib/option-normalizer.mjs';

assert.equal(pick([{ name: '파노라마 선루프', amount: 1_200_000 }]), '파노라마 선루프');
assert.equal(
  pick([{ name: '드라이브 와이즈 (750,000원)' }, { name: '스노우화이트펄', amount: 80_000 }]),
  '드라이브 와이즈, 스노우화이트펄',
);
assert.equal(pick([{ PAID_OPT_NM: '컴포트', PAID_OPT_AMT: 600_000 }]), '컴포트');
assert.equal(pick(null), '');
assert.equal(pick('차량 설명문\n파노라마 선루프'), '');

console.log('티카 유료옵션 규격화: 5/5 PASS');
