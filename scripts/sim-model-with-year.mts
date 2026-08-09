/**
 * 영업자용 시트 모델 칸 — **연식을 붙이지 않는다.**
 * 실행: npx tsx scripts/sim-model-with-year.mts
 *
 * 한때 「아반떼 2026」으로 붙였다가 되돌렸다(2026-08-09 사장님 지적).
 * 읽기는 편해지지만 **거를 수가 없다** — 모델 드롭다운에 「아반떼 2021」·「아반떼 2026」이
 * 따로 서서 「아반떼만」도 「2026년식만」도 못 고른다. 필터는 한 칸에 한 값일 때만 산다.
 */
import { modelWithYear, HEADERS } from '../lib/domain/inventory-sheet-export';

let pass = 0; let fail = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.error(`✗ ${name}`, JSON.stringify(detail ?? '')); }
};

check('모델 칸에 연식을 붙이지 않는다', modelWithYear('아반떼', '2026') === '아반떼', modelWithYear('아반떼', '2026'));
check('숫자 연식이 와도 마찬가지', modelWithYear('쏘나타', 2021) === '쏘나타');
check('연식이 없어도 모델은 그대로', modelWithYear('아반떼', '') === '아반떼');
check('모델이 없으면 빈칸', modelWithYear('', '2026') === '');
check('앞뒤 공백은 다듬는다', modelWithYear('  카니발  ', '2024') === '카니발');

// 연식은 «따로 선다» — 그래야 두 축으로 각각 거른다.
check('모델 칸이 따로 있다', HEADERS.includes('모델'));
check('연식 칸이 따로 있다', HEADERS.includes('연식'));

console.log(`\n━━ 결과: ${pass}/${pass + fail} 통과`);
if (fail) process.exit(1);
