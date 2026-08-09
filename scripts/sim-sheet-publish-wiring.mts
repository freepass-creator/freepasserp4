/**
 * 영업자 시트 반영이 **한 곳으로 모이는가** — 배선 검증.
 * 실행: npx tsx scripts/sim-sheet-publish-wiring.mts
 *
 * 2026-08-09 실측: 「공급사시트 → ERP」는 크론으로 자동인데
 * 「ERP → 영업자시트」는 사람이 버튼 누를 때만이었다. 그래서 밤에 재고가 들어와도
 * 아침에 영업자가 보는 표는 어제 것이었다 — 없는 차를 팔거나 새 차를 못 팔았다.
 *
 * 여기서 지키는 것 셋
 *   ① 관리자 버튼과 일일 동기화가 **같은 함수**를 부른다(두 경로가 갈리면 표가 갈린다)
 *   ② 일일 동기화가 재고 저장 **뒤에** 시트를 올린다
 *   ③ 시트 반영이 실패해도 재고 동기화는 성공으로 둔다(재고가 시트보다 중요하다)
 */
import { readFileSync } from 'node:fs';

let pass = 0; let fail = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.error(`✗ ${name}`, String(detail ?? '')); }
};
const read = (p: string) => readFileSync(p, 'utf8');

const publish = read('lib/server/inventory-sheet-publish.ts');
const route = read('app/api/inventory/sheet-export/route.ts');
const daily = read('lib/server/sheet-daily-sync.ts');

// ── ① 한 곳으로 모이는가 ──────────────────────────────────
check('관리자 버튼이 공용 반영 함수를 쓴다', route.includes('publishInventorySheet'));
check('일일 동기화도 같은 함수를 쓴다', daily.includes('publishInventorySheet'));
// 버튼 쪽에 표 만드는 코드가 남아 있으면 언젠가 두 표가 갈린다.
check('버튼 쪽에 표 조립 코드가 남아 있지 않다',
  !route.includes('buildInventorySheet') && !route.includes('dedupeForSales'),
  'route 가 아직 직접 표를 만든다');
check('공용 함수만 표를 조립한다', publish.includes('buildInventorySheet'));

// ── ② 순서 ────────────────────────────────────────────────
const applyAt = daily.indexOf('await applyPlan(');
const publishAt = daily.indexOf('publishInventorySheet(db');
check('재고 저장 뒤에 시트를 올린다', applyAt > 0 && publishAt > applyAt, `applyPlan@${applyAt} publish@${publishAt}`);

// ── ③ 시트 실패가 재고를 되돌리지 않는가 ──────────────────
const tail = daily.slice(publishAt - 400, publishAt + 400);
check('시트 반영을 try 로 감싼다', /try\s*\{[\s\S]*publishInventorySheet/.test(tail));
check('실패해도 실행기록에 남긴다', /catch[\s\S]*notes\.push/.test(tail));

// ── 안전장치가 공용 함수에 남아 있는가 ────────────────────
check('★공급사 원본 시트에 덮어쓰지 않는다', publish.includes('공급사 원본 시트'));
check('차종마스터가 비면 중단한다', publish.includes('차종마스터가 비어'));
check('목록 대상만 올린다', publish.includes('isListableProduct'));
check('중복을 접고 올린다', publish.includes('dedupeForSales'));
check('올리기 직전 차종을 다시 맞춘다', publish.includes('resnapForSales'));
check('고정 탭에 덮어쓴다(탭이 쌓이지 않는다)', publish.includes('openOrCreateTab'));

console.log(`\n━━ 결과: ${pass}/${pass + fail} 통과`);
if (fail) process.exit(1);
