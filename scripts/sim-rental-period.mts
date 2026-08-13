import { rentalPeriodEnd, rentalPeriodText } from '../lib/domain/rental-period';

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { pass += 1; console.log(`✓ ${name}`); }
  else { fail += 1; console.error(`✗ ${name}`, detail ?? ''); }
};

check('36개월은 차량 인도일 기준으로 표시', rentalPeriodText(36) === '차량 인도일로부터 36개월');
check('일반일 36개월 종료일은 대응일 전일', rentalPeriodEnd('2026-08-15', 36) === '2029-08-14');
check('최종 월에 대응일이 없으면 그 월 말일', rentalPeriodEnd('2026-01-31', 1) === '2026-02-28');
check('윤일 12개월도 최종 월 말일', rentalPeriodEnd('2024-02-29', 12) === '2025-02-28');
check('잘못된 날짜는 계산하지 않음', rentalPeriodEnd('2026-02-30', 36) === '');

console.log(`\n━━ 결과: ${pass}/${pass + fail} 통과`);
if (fail) process.exit(1);
