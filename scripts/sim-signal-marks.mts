/**
 * 차량 신호는 **상자(뱃지)가 아니라 아이콘 + 글자**
 * (사장님 2026-08-28 「박스 뱃지 쓰지 말고 아이콘 텍스트 형태의 뱃지를 쓰자 · 모든 곳에서 그렇게 하자」).
 *
 * 한 카드 안에서 위는 상자, 아래(우대조건)는 아이콘+글자면 같은 성질의 값이 두 문법으로 선다.
 * 되돌아가지 않게 «상자를 다시 쓰지 않는지»를 검사한다.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

// ① 상세 머리·목록 행이 상자 뱃지를 안 쓴다
for (const f of ['components/ProductDetail.tsx', 'components/product-card-badge-view.tsx']) {
  const src = read(f);
  assert.doesNotMatch(src, /<Badge\b/, `${f} 가 차량 신호에 상자 뱃지를 다시 씁니다.`);
  assert.match(src, /SignalMarks/, `${f} 가 아이콘+글자 신호를 안 씁니다.`);
}

// ② 아이콘+글자 렌더러는 우대조건과 **같은 것**을 쓴다 — 두 벌 만들면 또 갈린다
const view = read('components/product-card-badge-view.tsx');
assert.match(view, /import \{ MetaIcon \} from '@\/components\/product-card-perks'/,
  '신호가 우대조건과 다른 렌더러를 씁니다(문법이 갈립니다).');

// ③ 색은 아이콘에만 — 기존 톤 SSOT 를 쓴다
assert.match(view, /iconColor=\{toneText\(spec\.tone\)\}/, '신호 색이 톤 SSOT 를 안 씁니다.');

// ④ 죽은 상자 뱃지 컴포넌트가 되살아나지 않는다
assert.doesNotMatch(view, /export function CardKind/, 'CardKind(상자 뱃지)가 되살아났습니다.');

console.log('통과 — 차량 신호는 아이콘 + 글자, 상자 없음');
