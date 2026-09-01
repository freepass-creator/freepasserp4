/** 정산 청구 확인 관문 — 화면·서버가 공용 순수함수를 같은 기준으로 쓰는지 검증한다. */
import { providerBillGate, type Confirmation } from '../lib/domain/settlement-confirm';

const confirmation = (who: string, lines: number, state: '확인' | '이의' = '확인'): Confirmation => ({
  key: `2026-08_${who}`, month: '2026-08', who, role: 'agent', state, lines,
  disputed: [], note: '', at: 0, by: 'test',
});

const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? '✓' : '⛔'} ${label}`);
  if (!ok) {
    console.log('  actual  ', JSON.stringify(actual));
    console.log('  expected', JSON.stringify(expected));
    process.exitCode = 1;
  }
};

// 같은 채널의 두 담당자는 채널 확인 한 번이면 한 청구서의 2건을 확인한 것이다.
check('채널 단위로 묶어 확인', providerBillGate([
  { channel: '하허호무심사', agent: '김영업' }, { channel: '하허호무심사', agent: '이영업' },
], [confirmation('하허호', 2)]), []);

check('확인 뒤 건 증가면 재확인 필요', providerBillGate([
  { channel: '하허호무심사' }, { channel: '하허호무심사' },
], [confirmation('하허호', 1)]).map((x) => ({ channel: x.channel, lines: x.lines, why: x.why })), [
  { channel: '하허호무심사', lines: 2, why: '확인받은 뒤 1건이 늘었습니다. 다시 확인을 받아야 합니다.' },
]);

check('영업채널 미기재는 담당자 이름으로 우회하지 않고 차단', providerBillGate([
  { agent: '김영업' },
], [confirmation('김영업', 1)]).map((x) => x.channel), ['(영업채널 미기재)']);

if (!process.exitCode) console.log('PASS — 공급사 청구 확인 관문');
