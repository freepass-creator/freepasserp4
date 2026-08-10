import { isForbiddenAsTrim } from '../lib/domain/vehicle-field-guards';
const cases: [string, boolean][] = [
  ['가솔린 2.5 터보', true],
  ['가솔린 2.0 4MATIC', true],
  ['전기 롱레인지 AWD', true],
  ['가솔린 2.5 5인승 2WD', true],
  ['디젤 2.2', true],
  // ★진짜 트림은 살아야 한다
  ['프레스티지', false],
  ['가솔린 2.0 프리미엄', false],
  ['인스퍼레이션', false],
  ['E-Value Plus', false],
  ['GT라인', false],
  ['(세부등급 없음)', false],
];
let bad = 0;
for (const [s, want] of cases) {
  const got = isForbiddenAsTrim(s);
  const ok = got === want;
  if (!ok) bad++;
  console.log(`  ${ok ? '✓' : '✗'} ${s.padEnd(22)} 금지=${got} (기대 ${want})`);
}
console.log(bad ? `\n✗ ${bad}건 어긋남` : '\n✓ 전부 맞음');
