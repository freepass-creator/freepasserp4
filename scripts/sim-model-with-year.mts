/**
 * 영업자용 시트 모델 칸 — 「아반떼 2026」 표기 검증.
 * 실행: npx tsx scripts/sim-model-with-year.mts
 */
import { modelWithYear } from '../lib/domain/inventory-sheet-export';

let pass = 0; let fail = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.error(`✗ ${name}`, JSON.stringify(detail ?? '')); }
};

check('모델 뒤에 연식을 붙인다', modelWithYear('아반떼', '2026') === '아반떼 2026');
check('숫자 연식도 된다', modelWithYear('쏘나타', 2021) === '쏘나타 2021');
check('「25년식」 꼴에서도 뽑는다 — 4자리만 인정',
  modelWithYear('K5', '25년식') === 'K5', modelWithYear('K5', '25년식'));

// ★없는 연식을 지어내 붙이면 영업자가 그 숫자를 믿고 손님에게 말한다.
check('연식이 없으면 모델만', modelWithYear('아반떼', '') === '아반떼');
check('연식이 이상하면 모델만 — 배기량이 들어온 경우',
  modelWithYear('쏘나타', '2000') === '쏘나타 2000');   // 2000년식은 실제로 있을 수 있다
check('미래 연식은 붙이지 않는다', modelWithYear('아반떼', '2099') === '아반떼');
check('너무 옛 연식도 붙이지 않는다', modelWithYear('포니', '1900') === '포니');
check('모델이 없으면 빈칸', modelWithYear('', '2026') === '');

// 두 번 붙이지 않는다 — 이미 연식이 든 이름이 들어올 수 있다.
check('이미 붙어 있으면 그대로', modelWithYear('아반떼 2026', '2026') === '아반떼 2026');

console.log(`\n━━ 결과: ${pass}/${pass + fail} 통과`);
if (fail) process.exit(1);
