/** 정산 주기 검사 — 종이와 알림이 같은 날짜를 보는지. */
import { BILL_DAY, DUE_DAY, billDate, dueDate, cyclePhase } from '../lib/domain/settlement-cycle';

let bad = 0;
const ok = (t: string, v: boolean) => { console.log(`  ${v ? '○' : '✕'} ${t}`); if (!v) bad++; };
const ymd = (d: Date | null) => d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '';

console.log('\n■ 정산 주기\n');
ok('청구는 다음 달 3일', BILL_DAY === 3 && ymd(billDate('2026-08')) === '2026-09-03');
ok('입금은 다음 달 10일', DUE_DAY === 10 && ymd(dueDate('2026-08')) === '2026-09-10');
ok('12월분은 이듬해 1월로 넘어간다', ymd(dueDate('2026-12')) === '2027-01-10');
ok('청구가 입금보다 앞선다', billDate('2026-08')! < dueDate('2026-08')!);
ok('빈 달은 null', billDate('') === null && dueDate('엉뚱') === null);

console.log('');
ok('8월 27일 — 아직 8월이라 마감전', cyclePhase('2026-08', new Date(2026, 7, 27)) === '마감전');
ok('9월 1일 — 마감은 끝, 청구전', cyclePhase('2026-08', new Date(2026, 8, 1)) === '청구전');
ok('9월 3일 — 청구일, 입금전', cyclePhase('2026-08', new Date(2026, 8, 3)) === '입금전');
ok('9월 10일 — 기한 당일은 아직 입금전', cyclePhase('2026-08', new Date(2026, 8, 10)) === '입금전');
ok('9월 11일 — 지났다', cyclePhase('2026-08', new Date(2026, 8, 11)) === '지남');

console.log(bad ? `\n✕ ${bad}건 어긋남\n` : '\n○ 다 맞음\n');
process.exit(bad ? 1 : 0);
