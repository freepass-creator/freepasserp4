import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  billingMonthFromDay,
  deliveryTransitionPatch,
  intakeTermMonths,
  isValidBillingMonth,
  isValidSettlementDay,
  hasDeliveryContradiction,
  sameSettlementCar,
  withDeliveryInvariant,
} from '../lib/domain/settlement-intake';

const pass: string[] = [];
const check = (name: string, fn: () => void) => { fn(); pass.push(name); };

check('기간 키 정규화', () => {
  assert.equal(intakeTermMonths('24_2만'), 24);
  assert.equal(intakeTermMonths('60개월'), 60);
  assert.equal(intakeTermMonths('0'), 0);
  assert.equal(intakeTermMonths('121'), 0);
});

check('청구월 실제 범위', () => {
  assert.equal(isValidBillingMonth('2026-09'), true);
  assert.equal(isValidBillingMonth('2026-00'), false);
  assert.equal(isValidBillingMonth('2026-99'), false);
});

check('인도일 실제 날짜', () => {
  assert.equal(isValidSettlementDay('2028-02-29'), true);
  assert.equal(isValidSettlementDay('2026-02-29'), false);
  assert.equal(billingMonthFromDay('2026-09-10'), '2026-09');
});

check('인도완료 전이', () => {
  assert.deepEqual(deliveryTransitionPatch(true, {}, '2026-09-10'), {
    delivered: true, deliveredAt: '2026-09-10', billMonth: '2026-09',
  });
  assert.deepEqual(deliveryTransitionPatch(true, { deliveredAt: '2026-08-31', billMonth: '2026-10' }, '2026-09-10'), {
    delivered: true, deliveredAt: '2026-08-31', billMonth: '2026-10',
  });
  assert.deepEqual(deliveryTransitionPatch(false, { deliveredAt: '2026-08-31', billMonth: '2026-10' }, '2026-09-10'), {
    delivered: false, deliveredAt: '', billMonth: '',
  });
  assert.deepEqual(withDeliveryInvariant(
    { billMonth: '' },
    { delivered: true, deliveredAt: '2026-08-31', billMonth: '2026-08' },
    '2026-09-10',
  ), { delivered: true, deliveredAt: '2026-08-31', billMonth: '2026-08' });
  assert.deepEqual(withDeliveryInvariant(
    { deliveredAt: '' },
    { delivered: false, deliveredAt: '', billMonth: '' },
    '2026-09-10',
  ), { delivered: false, deliveredAt: '', billMonth: '' });
  assert.equal(hasDeliveryContradiction({ billMonth: '2026-09' }), true);
  assert.equal(hasDeliveryContradiction({ deliveredAt: '2026-09-10', delivered: true }), false);
  assert.equal(hasDeliveryContradiction({ billMonth: '2026-09' }, { delivered: true }), false);
});

check('차량 응답 귀속', () => {
  assert.equal(sameSettlementCar('12가 3456', '12가3456'), true);
  assert.equal(sameSettlementCar('12가3456', '99나9999'), false);
  assert.equal(sameSettlementCar('', ''), false);
});

check('실제 화면과 API에 불변식 연결', () => {
  const intake = readFileSync('components/settlement/IntakeStation.tsx', 'utf8');
  const board = readFileSync('components/settlement/SettlementBoard.tsx', 'utf8');
  const route = readFileSync('app/api/settlement/board/route.ts', 'utf8');
  assert.match(intake, /intakeTermMonths\(picked\.term\)/);
  assert.match(intake, /sameSettlementCar\(c\.plate, got\.plate\)/);
  assert.match(intake, /deliveryTransitionPatch\(on, r, today\)/);
  assert.match(board, /deliveryTransitionPatch\(on, r, today\)/);
  assert.match(board, /term: intakeTermMonths\(f\.term\)/);
  assert.match(board, /delivered: !!S\(f\.deliveredAt\)/);
  assert.match(board, /if \(dead\) return/);
  assert.match(route, /isValidBillingMonth\(patch\.billMonth\)/);
  assert.match(route, /isValidBillingMonth\(patch\.carryMonth\)/);
  assert.match(route, /withDeliveryInvariant\(patch, current/);
  assert.match(route, /hasDeliveryContradiction\(patch, current\)/);
  assert.match(route, /Object\.entries\(writePatch\)/);
  assert.match(route, /createHash\('sha256'\)/);
  assert.match(route, /const sameReceipt =/);
  assert.match(route, /await ref\.create\(atom\)/);
});

console.log('\n■ 정산 워크스테이션 기능 불변식\n');
for (const name of pass) console.log(`  ✓ ${name}`);
console.log(`\n✓ ${pass.length}묶음 통과\n`);
